/**
 * geminiService.js
 * ------------------------------------------------------------------
 * This file is the "Gemini API - Agent Orchestration" box from our
 * architecture diagram. It implements THREE separate agents, called
 * one after another (an "agent pipeline"). Each agent is just one
 * Gemini API call with a narrow, single-purpose prompt — this is
 * what "Agentic AI" means in practice for this MVP: not one giant
 * prompt, but several small, reviewable, single-responsibility ones.
 *
 *   1. Documentation Agent  -> transcribes the consultation audio AND
 *                              drafts a structured SOAP note + a
 *                              prescription draft, in one call, using
 *                              Gemini's native audio understanding
 *                              (this replaces the separate
 *                              Deepgram/AssemblyAI speech-to-text
 *                              step from the original architecture
 *                              slide — one less moving part for the
 *                              MVP).
 *   2. History Agent        -> reads the patient's stored medical
 *                              history and cross-references it
 *                              against the new SOAP note, surfacing
 *                              anything the doctor should know
 *                              (e.g. a past condition relevant to the
 *                              current complaint).
 *   3. Safety Agent         -> checks the drafted prescription and
 *                              note against the patient's known
 *                              allergies, current medications, and
 *                              for missing/inconsistent information.
 *
 * The Documentation Agent's draft is NEVER shown to the patient and
 * NEVER auto-saved as final — routes.js always requires an explicit
 * doctor "approve" action before anything becomes part of the
 * patient's record. That's the "Doctor Verification" box in the
 * diagram, implemented in routes.js.
 * ------------------------------------------------------------------
 */

const fs = require("fs");
const { GoogleGenerativeAI } = require("@google/generative-ai");

function getModel() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your_gemini_api_key_here") {
    throw new Error(
      "GEMINI_API_KEY is not set. Copy .env.example to .env and add your key from https://aistudio.google.com/apikey"
    );
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
  });
}

/** Strips accidental markdown fences and parses the model's JSON reply. */
function parseJson(text) {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  return JSON.parse(cleaned);
}

// ---------------------------------------------------------------
// Agent 1: Documentation Agent
// ---------------------------------------------------------------
async function documentationAgent(audioFilePath, mimeType) {
  const model = getModel();

  const audioBase64 = fs.readFileSync(audioFilePath).toString("base64");

  const prompt = `
You are the "Documentation Agent" inside a clinical scribe system.
You will receive an audio recording of a real doctor-patient consultation.

Do the following:
1. Transcribe the audio as accurately as possible, labelling speaker turns
   as "Doctor:" and "Patient:" where you can tell them apart.
2. From the transcript, draft a structured SOAP note (Subjective,
   Objective, Assessment, Plan) using standard clinical documentation
   style.
3. If the doctor mentions prescribing any medication, draft a
   prescription list (this is a DRAFT ONLY, to be reviewed by the
   doctor before it is ever sent to a patient).

Respond with ONLY valid JSON, no markdown, matching exactly this shape:
{
  "transcript": "Doctor: ... \\nPatient: ... \\n...",
  "soap": {
    "subjective": "string",
    "objective": "string",
    "assessment": "string",
    "plan": "string"
  },
  "prescriptionDraft": [
    { "medicine": "string", "dosage": "string", "frequency": "string", "duration": "string", "quantity": "string", "instructions": "string" }
  ]
}
If no medication was discussed, return an empty array for prescriptionDraft.
If audio is unclear or silent, say so honestly inside the relevant fields
instead of inventing clinical content.
`;

  const result = await model.generateContent([
    { inlineData: { mimeType, data: audioBase64 } },
    { text: prompt },
  ]);

  return parseJson(result.response.text());
}

// ---------------------------------------------------------------
// Agent 2: History Agent
// ---------------------------------------------------------------
async function historyAgent(patient, soapNote) {
  const model = getModel();

  const prompt = `
You are the "History Agent" inside a clinical scribe system.
Your job is ONLY to connect today's consultation to the patient's
existing record — you do not diagnose or treat.

Patient's stored medical history (most relevant fields only):
${JSON.stringify(
  {
    allergies: patient.allergies,
    currentMedications: patient.currentMedications,
    medicalHistory: patient.medicalHistory,
  },
  null,
  2
)}

Today's draft SOAP note:
${JSON.stringify(soapNote, null, 2)}

Identify:
1. Any past history entries relevant to today's complaint (quote which
   ones and why, briefly).
2. A short one or two sentence "context note" a busy doctor could
   read in 5 seconds before seeing the patient.

Respond with ONLY valid JSON, no markdown, matching exactly this shape:
{
  "relevantHistory": ["short string", "short string"],
  "contextNote": "string"
}
If nothing in the history is relevant, return an empty array and a
contextNote saying no notable history was found.
`;

  const result = await model.generateContent(prompt);
  return parseJson(result.response.text());
}

// ---------------------------------------------------------------
// Agent 3: Safety Agent
// ---------------------------------------------------------------
async function safetyAgent(patient, soapNote, prescriptionDraft) {
  const model = getModel();

  const prompt = `
You are the "Safety Agent" inside a clinical scribe system. You are a
final safety net BEFORE a doctor reviews a consultation. You do not
make clinical decisions — you only flag things a doctor should double
check.

Patient's known allergies: ${JSON.stringify(patient.allergies)}
Patient's current medications: ${JSON.stringify(patient.currentMedications)}

Today's SOAP note:
${JSON.stringify(soapNote, null, 2)}

Today's draft prescription:
${JSON.stringify(prescriptionDraft, null, 2)}

Check for and flag, if present:
- Any drafted medication that conflicts with a known allergy.
- Any obvious interaction risk with a current medication.
- Missing information in the note that is normally expected (e.g. no
  vital signs recorded, no dosage specified for a drafted medication).
- Any internal inconsistency between the Subjective/Objective/
  Assessment/Plan sections.

Respond with ONLY valid JSON, no markdown, matching exactly this shape:
{
  "alerts": [
    { "severity": "high" | "medium" | "low", "type": "string", "message": "string" }
  ]
}
If nothing needs flagging, return an empty array. Do not invent risks
that aren't supported by the data given.
`;

  const result = await model.generateContent(prompt);
  return parseJson(result.response.text());
}

// ---------------------------------------------------------------
// Orchestrator: runs the 3 agents in sequence, exactly matching the
// left-to-right flow of the architecture diagram's Gemini box.
// ---------------------------------------------------------------
async function runAgentPipeline({ audioFilePath, mimeType, patient }) {
  const docResult = await documentationAgent(audioFilePath, mimeType);
  const historyResult = await historyAgent(patient, docResult.soap);
  const safetyResult = await safetyAgent(
    patient,
    docResult.soap,
    docResult.prescriptionDraft
  );

  return {
    transcript: docResult.transcript,
    soap: docResult.soap,
    prescriptionDraft: docResult.prescriptionDraft || [],
    relevantHistory: historyResult.relevantHistory || [],
    contextNote: historyResult.contextNote || "",
    safetyAlerts: safetyResult.alerts || [],
  };
}

module.exports = { runAgentPipeline };
