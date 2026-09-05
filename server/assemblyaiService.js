const { AssemblyAI } = require("assemblyai");

const client = new AssemblyAI({
  apiKey: process.env.ASSEMBLYAI_API_KEY,
});

async function transcribeAudio(audioFilePath) {

  console.log("🎙️ Sending audio to AssemblyAI...");

  const transcript = await client.transcripts.transcribe({

    audio: audioFilePath,

    // AssemblyAI speech-to-text model
    speech_models: ["universal-3-5-pro"],

    // Medical terminology/context
    domain: "medical-v1",

    // Identify different speakers
    speaker_labels: true,

    prompt: `
      This is a doctor-patient medical consultation.

      The conversation may contain:
      - patient symptoms
      - duration and severity of symptoms
      - medical history
      - allergies
      - diagnoses
      - medication names
      - medication dosage and frequency
      - laboratory investigations
      - clinical observations
      - treatment plans

      The conversation may contain medical terminology,
      abbreviations and medication names.
    `,

    keyterms_prompt: [
      "paracetamol",
      "Metacin",
      "metformin",
      "ramipril",
      "hypertension",
      "diabetes mellitus",
      "blood pressure",
      "ECG",
      "CBC"
    ]
  });

  if (transcript.status === "error") {
    throw new Error(
      transcript.error || "AssemblyAI transcription failed"
    );
  }

  console.log("✅ AssemblyAI transcription completed");

  return transcript;
}

module.exports = {
  transcribeAudio,
};