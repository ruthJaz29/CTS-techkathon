# MedScribe AI — MVP

**AI Medical Scribe** · Cognizant Techathon 2026 · Team Catalyst Minds

This is a working MVP of the solution described in the pitch deck: it records a
doctor-patient consultation, runs it through a 3-agent AI pipeline (Gemini),
drafts a structured SOAP note + prescription, flags safety issues, and only
publishes anything to the patient after the doctor explicitly approves it.

---

## 1. Tech stack (and why)

| Layer | Choice | Why |
|---|---|---|
| Frontend | Plain HTML + CSS + JavaScript (no framework) | Keeps the MVP simple to build, run, and **explain line by line** — no build step, no bundler. |
| Backend | Node.js + Express | Matches the architecture diagram's "Backend: Node.js + Express.js" box. One small REST API. |
| Database | A single JSON file (`data/db.json`), read/written with `fs` | Stands in for MongoDB from the diagram. Same data shape (patients, doctors, consultations) — swapping in real MongoDB later means changing `server/db.js` only, nothing else. |
| AI | Google Gemini API (`@google/generative-ai`) | Gemini can take **audio directly as input**, so one Gemini call does what "Deepgram speech-to-text" did in the original diagram, removing a separate service for the MVP. |
| Audio capture | Browser `MediaRecorder` API | No native app needed — the mic button on the doctor dashboard records straight from the browser. |

## 2. How this maps to the architecture diagram

```
FRONTEND (HTML/CSS/JS)  →  BACKEND (Node/Express)  →  GEMINI API (3 agents)  →  DOCTOR VERIFICATION  →  db.json
```

The **Gemini API - Agent Orchestration** box becomes `server/geminiService.js`,
with three functions called in sequence for every consultation:

1. **Documentation Agent** (`documentationAgent`) — takes the raw audio,
   transcribes it, and drafts a SOAP note + prescription draft in one Gemini
   call (using Gemini's native audio understanding).
2. **History Agent** (`historyAgent`) — takes the patient's stored history and
   the new SOAP note, and returns what's relevant + a one-line context note.
3. **Safety Agent** (`safetyAgent`) — cross-checks the draft against known
   allergies, current medications, and missing/inconsistent information, and
   returns a list of severity-tagged alerts.

`runAgentPipeline()` at the bottom of that file runs all three in order — this
is the whole "Agentic AI" part of the pitch, made concrete as three small,
single-purpose prompts instead of one giant one, so each step is easy to
demo and explain independently.

**Doctor Verification** happens in `server/routes.js`, `POST
/consultations/:id/approve` — nothing reaches `patient.currentMedications` or
`patient.medicalHistory` until this endpoint is called from the dashboard's
"Approve Consultation & Send Notes" button.

## 3. Project structure

```
medscribe-mvp/
├── server/
│   ├── index.js          # Express app entry point
│   ├── routes.js         # All /api endpoints (auth, patients, consultations)
│   ├── geminiService.js  # The 3 AI agents + pipeline orchestrator
│   └── db.js             # Reads/writes data/db.json
├── data/
│   └── db.json           # "Database" — seeded with 1 doctor + 2 patients
├── uploads/               # Recorded consultation audio files land here
├── public/                # Frontend — plain HTML/CSS/JS, no build step
│   ├── login.html
│   ├── css/style.css
│   ├── js/api.js          # Shared fetch() wrapper + session helpers
│   ├── doctor/
│   │   ├── dashboard.html + js/dashboard.js   # Record → AI review → approve
│   │   ├── patients.html                      # Patient list & history
│   │   └── consultations.html                 # Past consultations
│   └── patient/
│       ├── home.html                          # Matches the deck's patient mockup
│       ├── consultations.html                 # Approved summaries only
│       └── prescriptions.html                 # Approved prescriptions only
├── package.json
└── .env.example
```

## 4. Setup & run

```bash
cd medscribe-mvp
npm install
cp .env.example .env
```

Open `.env` and paste in a Gemini API key (free tier is fine for a demo):
https://aistudio.google.com/apikey

```bash
npm start
```

Then open **http://localhost:3000/login.html**

### Demo accounts (seeded in `data/db.json`)
- **Doctor:** `eleanor.vance@medscribe.ai` / `doctor123`
- **Patient:** `sarah.thompson@example.com` / `patient123`

## 5. Demo flow to walk through with judges

1. Log in as the **doctor**.
2. On the dashboard, pick patient **Sarah J. Thompson**, name the consultation
   (e.g. "Chest pain follow-up"), tap the mic, say a few sentences describing
   a consultation out loud (symptoms, a diagnosis, maybe a medicine), tap the
   mic again to stop.
3. Watch the "Running AI agent pipeline" indicator — this is the three Gemini
   calls happening in sequence.
4. Review the transcript, the AI-drafted SOAP note, the **Relevant History**
   panel (History Agent), and the **Safety Review Alerts** panel (Safety
   Agent) — note Sarah's Aspirin allergy will get flagged if you mention
   Aspirin in the recording.
5. Edit any field directly in the browser (everything is `contenteditable`),
   click **Save Edits**, then **Approve Consultation & Send Notes**.
6. Log out, log back in as the **patient**, and see the same approved note +
   prescription now on their home page / consultations / prescriptions pages.

## 6. Known MVP simplifications (say these out loud if asked)

- **Auth is intentionally minimal** — plaintext password check + a token that
  just encodes who logged in, no bcrypt/JWT signing. Fine for a demo, called
  out here so it's clear this isn't production-ready auth.
- **Database is a JSON file**, not MongoDB — same data shape, so it's a
  drop-in swap later, not a redesign.
- **No real patient search box, notifications, or calendar** — the deck's
  mockups show these; the MVP focuses on the core AI scribe loop (record →
  draft → verify → publish) since that's the actual problem statement.
- **Speech-to-text is done by Gemini directly** instead of a separate
  Deepgram/AssemblyAI call, to reduce moving parts — the "Documentation
  Agent" comment in `geminiService.js` explains this trade-off.

## 7. Where to make changes if you want to extend it

- **New agent?** Add a function to `server/geminiService.js`, call it from
  `runAgentPipeline()`, and add its output to the object it returns.
- **New field on a patient?** Just add it to `data/db.json` and reference it
  in the relevant `.html`/`.js` files — no schema/migration needed.
- **Swap in real MongoDB?** Rewrite `server/db.js`'s four exported functions
  (`readDb`, `writeDb`, `newId`) to talk to MongoDB/Mongoose — nothing in
  `routes.js` needs to change since it only calls those functions.
- **Real auth?** Replace the `makeToken`/`requireAuth` functions at the top
  of `server/routes.js` with bcrypt password hashing + signed JWTs.
