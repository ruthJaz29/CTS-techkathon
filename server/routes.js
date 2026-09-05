/**
 * routes.js
 * ------------------------------------------------------------------
 * All REST API endpoints live here. This is the "BACKEND: Node.js +
 * Express.js" box from the architecture diagram — it's the only
 * thing the frontend ever talks to. It's responsible for:
 *   - Authentication            (very simplified for the MVP - see note below)
 *   - Patient Management        (list / view patients)
 *   - Consultation Management   (create, run AI pipeline, edit, approve)
 *   - AI Service                (delegates to geminiService.js)
 *   - Database Service          (delegates to db.js)
 *
 * AUTH NOTE FOR YOUR DEMO: real products hash passwords (bcrypt) and
 * use signed JWTs. For a hackathon MVP we compare plaintext passwords
 * from db.json and hand back a base64 token that just encodes who
 * logged in. It's enough to demonstrate doctor vs patient views and
 * protect routes, but say out loud in your demo that this is a
 * simplification, not production auth.
 * ------------------------------------------------------------------
 */

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { readDb, writeDb, newId } = require("./db");
const { runAgentPipeline } = require("./geminiService");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { transcribeAudio } = require("./assemblyAIService");

const router = express.Router();

// ---- File upload setup (consultation audio) ----------------------
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = file.mimetype.includes("webm") ? "webm" : "audio";
      cb(null, `${req.params.id}_${Date.now()}.${ext}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB is plenty for a consult
});

// ---- Tiny auth helpers --------------------------------------------
function makeToken(user, role) {
  return Buffer.from(`${role}:${user.id}:${Date.now()}`).toString("base64");
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "Not authenticated" });
  try {
    const [role, id] = Buffer.from(header.replace("Bearer ", ""), "base64")
      .toString()
      .split(":");
    req.user = { role, id };
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

// =====================================================================
// AUTH
// =====================================================================
router.post("/auth/login", (req, res) => {
  const { role, email, password } = req.body;
  const db = readDb();
  const pool = role === "doctor" ? db.doctors : db.patients;
  const user = pool.find((u) => u.email === email && u.password === password);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const { password: _pw, ...safeUser } = user;
  res.json({ token: makeToken(user, role), role, user: safeUser });
});

// =====================================================================
// PATIENTS
// =====================================================================
router.get("/patients", requireAuth, (req, res) => {
  const db = readDb();
  const patients = db.patients.map(({ password, ...p }) => p);
  res.json(patients);
});

router.get("/patients/:id", requireAuth, (req, res) => {
  const db = readDb();
  const patient = db.patients.find((p) => p.id === req.params.id);
  if (!patient) return res.status(404).json({ error: "Patient not found" });
  const { password, ...safe } = patient;
  res.json(safe);
});

// =====================================================================
// DOCTORS (used to show doctor name/specialty on patient side)
// =====================================================================
router.get("/doctors/:id", requireAuth, (req, res) => {
  const db = readDb();
  const doctor = db.doctors.find((d) => d.id === req.params.id);
  if (!doctor) return res.status(404).json({ error: "Doctor not found" });
  const { password, ...safe } = doctor;
  res.json(safe);
});

// =====================================================================
// APPOINTMENTS
// =====================================================================
router.get("/appointments", requireAuth, (req, res) => {
  const db = readDb();
  const { patientId, doctorId } = req.query;
  let list = db.appointments;
  if (patientId) list = list.filter((a) => a.patientId === patientId);
  if (doctorId) list = list.filter((a) => a.doctorId === doctorId);
  res.json(list);
});

// =====================================================================
// CONSULTATIONS
// =====================================================================

// List consultations, filterable by doctorId or patientId + status
router.get("/consultations", requireAuth, (req, res) => {
  const db = readDb();
  const { doctorId, patientId, status } = req.query;
  let list = db.consultations;
  if (doctorId) list = list.filter((c) => c.doctorId === doctorId);
  if (patientId) list = list.filter((c) => c.patientId === patientId);
  if (status) list = list.filter((c) => c.status === status);
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(list);
});

router.get("/consultations/:id", requireAuth, (req, res) => {
  const db = readDb();
  const consult = db.consultations.find((c) => c.id === req.params.id);
  if (!consult) return res.status(404).json({ error: "Not found" });
  res.json(consult);
});

// Step 1: doctor picks a patient + names the recording -> creates a
// consultation shell in "recording" state. Returns the id the browser
// will attach the audio upload to once recording stops.
router.post("/consultations", requireAuth, (req, res) => {
  const { patientId, doctorId, name } = req.body;
  if (!patientId || !doctorId || !name) {
    return res.status(400).json({ error: "patientId, doctorId and name are required" });
  }
  const db = readDb();
  const patient = db.patients.find((p) => p.id === patientId);
  if (!patient) return res.status(404).json({ error: "Patient not found" });

  const consult = {
    id: newId("cons"),
    name,
    patientId,
    doctorId,
    status: "recording", // recording -> processing -> pending_review -> approved
    createdAt: new Date().toISOString(),
    transcript: null,
    soap: null,
    prescriptionDraft: [],
    relevantHistory: [],
    contextNote: "",
    safetyAlerts: [],
    approvedAt: null,
  };
  db.consultations.push(consult);
  writeDb(db);
  res.status(201).json(consult);
});

// Step 2: browser uploads the recorded audio blob for this consultation.
// This is where the full 3-agent Gemini pipeline runs.
router.post("/consultations/:id/audio", requireAuth, upload.single("audio"), async (req, res) => {
  const db = readDb();
  const consult = db.consultations.find((c) => c.id === req.params.id);
  if (!consult) return res.status(404).json({ error: "Consultation not found" });
  if (!req.file) return res.status(400).json({ error: "No audio file uploaded" });

  const patient = db.patients.find((p) => p.id === consult.patientId);

  consult.status = "processing";
  consult.audioFile = req.file.filename;
  writeDb(db);

    try {

    // --------------------------------------------------
    // STEP 1: Speech-to-Text using AssemblyAI
    // --------------------------------------------------

    console.log("🎙️ Sending consultation audio to AssemblyAI...");

    const assemblyTranscript =
      await transcribeAudio(req.file.path);

    console.log("✅ AssemblyAI transcription completed");

    console.log(
      "Original transcript:",
      assemblyTranscript.text
    );


    // --------------------------------------------------
    // STEP 2: Gemini Documentation Agent
    // --------------------------------------------------

    console.log("🤖 Sending transcript to Gemini...");

    const result =
      await runAgentPipeline({
        transcript: assemblyTranscript.text,
        patient,
      });

    console.log("✅ Gemini pipeline completed");


    // --------------------------------------------------
    // STEP 3: Save results
    // --------------------------------------------------

    const db2 = readDb();

    const c2 =
      db2.consultations.find(
        (c) => c.id === req.params.id
      );

    Object.assign(
      c2,
      result,
      {
        status: "pending_review"
      }
    );

    writeDb(db2);

    res.json(c2);

  } catch (err) {

    console.error(
      "❌ AI pipeline failed:",
      err.message
    );

    const db3 = readDb();

    const c3 =
      db3.consultations.find(
        (c) => c.id === req.params.id
      );

    c3.status = "failed";
    c3.error = err.message;

    writeDb(db3);

    res.status(500).json({
      error: err.message
    });
  }
});


// Step 3: doctor edits the AI draft before approving (SOAP note text
// and/or the prescription table).
router.put("/consultations/:id", requireAuth, (req, res) => {
  const db = readDb();
  const consult = db.consultations.find((c) => c.id === req.params.id);
  if (!consult) return res.status(404).json({ error: "Not found" });

  const { soap, prescriptionDraft } = req.body;
  if (soap) consult.soap = soap;
  if (prescriptionDraft) consult.prescriptionDraft = prescriptionDraft;
  writeDb(db);
  res.json(consult);
});

// Step 4: "Doctor Verification" — approving writes the final note into
// the patient's permanent record. Nothing reaches the patient portal
// before this happens.
router.post("/consultations/:id/approve", requireAuth, (req, res) => {
  const db = readDb();
  const consult = db.consultations.find((c) => c.id === req.params.id);
  if (!consult) return res.status(404).json({ error: "Not found" });

  consult.status = "approved";
  consult.approvedAt = new Date().toISOString();

  const patient = db.patients.find((p) => p.id === consult.patientId);
  if (patient) {
    patient.medicalHistory.unshift({
      date: consult.approvedAt.slice(0, 10),
      note: consult.soap?.assessment || "Consultation note",
      consultationId: consult.id,
    });
    if (consult.prescriptionDraft?.length) {
      patient.currentMedications = [
        ...consult.prescriptionDraft.map((p) => ({
          medicine: p.medicine,
          dosage: p.dosage,
          frequency: p.frequency,
        })),
        ...patient.currentMedications,
      ];
    }
  }

  writeDb(db);
  res.json(consult);
});
// =====================================================================
// ASSEMBLYAI TEST
// =====================================================================

router.post(
  "/test-transcribe",
  requireAuth,
  upload.single("audio"),
  async (req, res) => {

    console.log("📥 /test-transcribe called");

    if (!req.file) {
      console.log("❌ No file received");

      return res.status(400).json({
        error: "No audio file uploaded"
      });
    }

    console.log("📁 File received:");
    console.log("   path:", req.file.path);
    console.log("   name:", req.file.originalname);
    console.log("   type:", req.file.mimetype);
    console.log("   size:", req.file.size);

    try {

      console.log("🎙️ Sending to AssemblyAI...");

      const transcript =
        await transcribeAudio(req.file.path);

      console.log("✅ AssemblyAI finished");

      console.log("Transcript:");
      console.log(transcript.text);

      res.json({
        success: true,
        transcript: transcript.text,
        utterances: transcript.utterances || []
      });

    } catch (error) {

      console.error("❌ AssemblyAI failed:");
      console.error(error);

        res.status(500).json({
    error: err.message
  });
}
});
module.exports = router;
