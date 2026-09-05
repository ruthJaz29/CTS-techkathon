# MedScribe AI

**AI-powered medical scribe for faster, safer clinical documentation.**

MedScribe AI converts doctor–patient conversations into structured clinical notes using speech detection, medical transcription, and specialized AI agents.

## ✨ Features

- Speech detection with Silero VAD
- Medical transcription using AssemblyAI
- AI-generated SOAP notes
- Relevant patient history analysis
- Allergy, medication & safety checks
- Prescription draft generation
- Doctor review, editing & approval
- HTTPS-based secure communication

## 🔄 Workflow

```text
Doctor–Patient Conversation
          ↓
      Silero VAD
          ↓
   Speech Segmentation
          ↓
    AssemblyAI Medical
     Transcription
          ↓
      Gemini AI Agents
          ↓
 ┌────────┬────────┬────────┐
 │  SOAP  │ History│ Safety │
 └────────┴────────┴────────┘
          ↓
     Prescription
          ↓
     Doctor Review
          ↓
       Approval
```

## 🛠️ Tech Stack

**Frontend:** HTML, CSS, JavaScript, Silero VAD, ONNX Runtime Web

**Backend:** Node.js, Express.js, Multer

**AI:** AssemblyAI Medical Transcription, Gemini

**Database:** JSON-based MVP database

**Security:** HTTPS, environment variables, authentication

## 📁 File Structure

```text
MedScribe-AI/
├── public/
│   ├── css/
│   ├── js/
│   └── doctor/
│       ├── dashboard.html
│       ├── consultations.html
│       └── js/
├── server/
│   ├── index.js
│   ├── routes.js
│   ├── db.js
│   ├── geminiService.js
│   └── assemblyAIService.js
├── data/
│   └── db.json
├── cert/
├── uploads/
├── package.json
├── .env
├── .gitignore
└── README.md
```

## 🚀 Run Locally

```bash
git clone <YOUR_REPOSITORY_URL>
cd MedScribe-AI
npm install
```

Create a `.env` file:

```env
PORT=3000
GEMINI_API_KEY=your_gemini_api_key
ASSEMBLYAI_API_KEY=your_assemblyai_api_key
```

Start the application:

```bash
npm run dev
```

Open:

```text
https://localhost:3000/login.html
```

## 📸 Screenshots

### Doctor Dashboard

<img width="1920" height="1080" alt="Doctor Dashboard" src="https://github.com/user-attachments/assets/0c723de1-31fe-492f-9904-9ec1621d5d8b" />

### Patient Dashboard

<img width="1920" height="1080" alt="Patient Dashboard" src="https://github.com/user-attachments/assets/0ab7b4ff-0cd7-4944-ac55-5cee03a2cc38" />

## ⚠️ Disclaimer

This is a **hackathon MVP** and is not a medical device. AI-generated information must be reviewed by a qualified healthcare professional before use.

## 👥 Team Catalyst Minds

**MedScribe AI — Cognizant Techathon 2026**
