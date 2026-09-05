/**
 * geminiService.js
 *
 * Gemini 3.x agent pipeline.
 *
 * AssemblyAI handles:
 *   Audio → Speech-to-Text
 *
 * Gemini handles:
 *   Transcript → Documentation
 *   Documentation → History analysis
 *   Documentation → Safety analysis
 */

const { GoogleGenAI } = require("@google/genai");


// ---------------------------------------------------------------
// Gemini client
// ---------------------------------------------------------------

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  return new GoogleGenAI({
    apiKey,
  });
}


// ---------------------------------------------------------------
// Parse Gemini JSON response
// ---------------------------------------------------------------

function parseJson(text) {

  const cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {

    console.error("❌ Gemini returned invalid JSON:");
    console.error(text);

    throw new Error(
      "Gemini returned invalid JSON"
    );
  }
}


// ---------------------------------------------------------------
// Helper: Gemini interaction
// ---------------------------------------------------------------

async function askGemini(prompt) {

  const ai = getClient();

  const interaction = await ai.interactions.create({

    model:
      process.env.GEMINI_MODEL ||
      "gemini-3.6-flash",

    input: prompt,
  });

  return interaction.output_text;
}


// ===============================================================
// AGENT 1 — DOCUMENTATION AGENT
// ===============================================================

async function documentationAgent(transcript) {

  console.log("🤖 Documentation Agent running...");

  const prompt = `
You are the Documentation Agent inside a clinical medical scribe system.

You will receive a transcript of a doctor-patient consultation.

The transcript may contain English, Tamil, or a mixture of both.

Your responsibilities:

1. Convert the entire transcript into clear English.
2. Preserve the meaning of what was actually said.
3. Identify Doctor and Patient speaker turns where possible.
4. Do NOT invent information.
5. Create a structured SOAP note.
6. Create a prescription DRAFT only when medication was actually
   mentioned in the consultation.

IMPORTANT:

- This is documentation assistance, NOT autonomous diagnosis.
- Do not invent symptoms, diagnoses, medicines, dosages or test results.
- If something is unclear, explicitly state that it is unclear.
- Medication suggestions must only come from what the doctor actually
  mentioned.

Return ONLY valid JSON.

Required format:

{
  "transcript": "Doctor: ...\\nPatient: ...",
  "soap": {
    "subjective": "...",
    "objective": "...",
    "assessment": "...",
    "plan": "..."
  },
  "prescriptionDraft": [
    {
      "medicine": "...",
      "dosage": "...",
      "frequency": "...",
      "duration": "...",
      "quantity": "...",
      "instructions": "..."
    }
  ]
}

If no medication was discussed:

"prescriptionDraft": []

Here is the AssemblyAI transcript:

${transcript}
`;

  const text = await askGemini(prompt);

  return parseJson(text);
}


// ===============================================================
// AGENT 2 — HISTORY AGENT
// ===============================================================

async function historyAgent(patient, soapNote) {

  console.log("📚 History Agent running...");

  const prompt = `
You are the History Agent inside a clinical medical scribe system.

Your ONLY responsibility is to compare today's consultation
with the patient's existing medical history.

Do NOT diagnose.
Do NOT prescribe.
Do NOT invent information.

Patient history:

${JSON.stringify(
  {
    allergies: patient.allergies || [],
    currentMedications:
      patient.currentMedications || [],
    medicalHistory:
      patient.medicalHistory || [],
  },
  null,
  2
)}

Today's SOAP note:

${JSON.stringify(
  soapNote,
  null,
  2
)}

Identify:

1. Relevant previous medical history.
2. Relevant allergies or medications.
3. A very short context note that helps the doctor understand
   the patient's background.

Return ONLY valid JSON:

{
  "relevantHistory": [
    "short explanation"
  ],
  "contextNote": "short summary"
}

If nothing relevant exists:

{
  "relevantHistory": [],
  "contextNote": "No notable relevant history found."
}
`;

  const text = await askGemini(prompt);

  return parseJson(text);
}


// ===============================================================
// AGENT 3 — SAFETY AGENT
// ===============================================================

async function safetyAgent(
  patient,
  soapNote,
  prescriptionDraft
) {

  console.log("🛡️ Safety Agent running...");

  const prompt = `
You are the Safety Agent inside a clinical medical scribe system.

You are a SAFETY CHECKER.

You do NOT make clinical decisions.

Your job is ONLY to identify things that the doctor should
double-check before approving the consultation.

Known allergies:

${JSON.stringify(
  patient.allergies || [],
  null,
  2
)}

Current medications:

${JSON.stringify(
  patient.currentMedications || [],
  null,
  2
)}

Today's SOAP note:

${JSON.stringify(
  soapNote,
  null,
  2
)}

Draft prescription:

${JSON.stringify(
  prescriptionDraft,
  null,
  2
)}

Check for:

- Possible allergy conflicts
- Obvious medication conflicts
- Missing dosage information
- Missing duration
- Missing important documentation
- Internal inconsistencies
- Information that should be verified by the doctor

IMPORTANT:

Do NOT invent risks.

Only flag something when the supplied information
actually supports the concern.

Return ONLY valid JSON:

{
  "alerts": [
    {
      "severity": "high",
      "type": "string",
      "message": "string"
    }
  ]
}

severity must be one of:

high
medium
low

If there are no concerns:

{
  "alerts": []
}
`;

  const text = await askGemini(prompt);

  return parseJson(text);
}


// ===============================================================
// ORCHESTRATOR
// ===============================================================

async function runAgentPipeline({
  transcript,
  patient,
}) {

  console.log("\n================================");
  console.log("🚀 GEMINI AGENT PIPELINE START");
  console.log("================================\n");


  // -------------------------------------------------------------
  // Agent 1
  // -------------------------------------------------------------

  const documentation =
    await documentationAgent(transcript);


  console.log("✅ Documentation Agent completed");


  // -------------------------------------------------------------
  // Agent 2
  // -------------------------------------------------------------

  const history =
    await historyAgent(
      patient,
      documentation.soap
    );


  console.log("✅ History Agent completed");


  // -------------------------------------------------------------
  // Agent 3
  // -------------------------------------------------------------

  const safety =
    await safetyAgent(
      patient,
      documentation.soap,
      documentation.prescriptionDraft
    );


  console.log("✅ Safety Agent completed");


  console.log("\n================================");
  console.log("🎉 GEMINI AGENT PIPELINE COMPLETE");
  console.log("================================\n");


  return {

    transcript:
      documentation.transcript,

    soap:
      documentation.soap,

    prescriptionDraft:
      documentation.prescriptionDraft || [],

    relevantHistory:
      history.relevantHistory || [],

    contextNote:
      history.contextNote || "",

    safetyAlerts:
      safety.alerts || [],
  };
}


module.exports = {
  runAgentPipeline,
};