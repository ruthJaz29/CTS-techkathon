/**
 * dashboard.js
 * ------------------------------------------------------------------
 * MedScribe AI - New Consultation
 *
 * Flow:
 * Patient selection
 *      ↓
 * Create consultation
 *      ↓
 * Silero VAD microphone
 *      ↓
 * Detect speech segments
 *      ↓
 * Accumulate all speech
 *      ↓
 * Doctor presses Stop
 *      ↓
 * Combine segments into WAV
 *      ↓
 * Upload once
 *      ↓
 * AssemblyAI transcription
 *      ↓
 * Gemini Documentation + History + Safety Agents
 *      ↓
 * Doctor reviews results
 * ------------------------------------------------------------------
 */

Session.requireRole("doctor");


// ================================================================
// STATE
// ================================================================

let vad = null;

let speechSegments = [];
let totalSpeechSamples = 0;

let recordingSeconds = 0;
let timerInterval = null;

let currentConsultId = null;
let currentConsult = null;

let patients = [];

let isRecording = false;
let isProcessing = false;


// ================================================================
// INITIALIZATION
// ================================================================

(async function init() {
  try {
    const user = Session.user();

    document.getElementById("doctorName").textContent = user.name;
    document.getElementById("doctorInitials").textContent = initials(user.name);

    patients = await Api.get("/patients");

    const select = document.getElementById("patientSelect");

    select.innerHTML = patients
      .map((p) => `<option value="${p.id}">${p.name}</option>`)
      .join("");

    select.addEventListener("change", renderPatientSnapshot);

    renderPatientSnapshot();

    console.log("✅ Dashboard initialized");
  } catch (err) {
    console.error("Dashboard initialization failed:", err);
    alert("Failed to load doctor dashboard: " + err.message);
  }
})();


// ================================================================
// LOGOUT
// ================================================================

function logout() {
  Session.clear();
  window.location.href = "/login.html";
}


// ================================================================
// PATIENT SNAPSHOT
// ================================================================

function renderPatientSnapshot() {
  const select = document.getElementById("patientSelect");

  const patient = patients.find(
    (p) => p.id === select.value
  );

  const box = document.getElementById("patientSnapshot");

  if (!patient) {
    box.textContent = "Select a patient.";
    return;
  }

  box.innerHTML = `
    <div style="margin-bottom:8px;">
      <b>${patient.name}</b>
      · ${patient.gender}
      · DOB ${patient.dob}
    </div>

    <div style="margin-bottom:6px;">
      <span class="soap-label">Allergies</span><br>

      ${patient.allergies && patient.allergies.length
      ? patient.allergies
        .map(
          (a) =>
            `<span class="badge badge-red">${a}</span>`
        )
        .join(" ")
      : '<span class="text-muted">None recorded</span>'
    }
    </div>

    <div>
      <span class="soap-label">Current Medications</span><br>

      ${patient.currentMedications &&
      patient.currentMedications.length
      ? patient.currentMedications
        .map(
          (m) =>
            `${m.medicine} ${m.dosage} (${m.frequency})`
        )
        .join("<br>")
      : '<span class="text-muted">None recorded</span>'
    }
    </div>
  `;
}


// ================================================================
// RECORDING TOGGLE
// ================================================================

async function toggleRecording() {
  if (isProcessing) {
    return;
  }

  if (!isRecording) {
    await startRecording();
  } else {
    await stopRecording();
  }
}


// ================================================================
// START RECORDING
// ================================================================

async function startRecording() {

  const patientId =
    document.getElementById("patientSelect").value;

  const name =
    document.getElementById("consultName").value.trim();


  // ------------------------------------------------------------
  // Validation
  // ------------------------------------------------------------

  if (!patientId || !name) {
    alert(
      "Please select a patient and name the consultation before recording."
    );

    return;
  }


  // ------------------------------------------------------------
  // Reset state
  // ------------------------------------------------------------

  speechSegments = [];
  totalSpeechSamples = 0;

  currentConsult = null;
  currentConsultId = null;


  // ------------------------------------------------------------
  // Create consultation on server
  // ------------------------------------------------------------

  try {

    document.getElementById("recStatus").textContent =
      "Creating consultation...";

    currentConsult = await Api.post("/consultations", {
      patientId,
      doctorId: Session.user().id,
      name
    });

    currentConsultId = currentConsult.id;

    console.log(
      "✅ Consultation created:",
      currentConsultId
    );

  } catch (err) {

    console.error(
      "Failed to create consultation:",
      err
    );

    alert(
      "Could not create consultation: " +
      err.message
    );

    return;
  }


  // ------------------------------------------------------------
  // Start Silero VAD
  // ------------------------------------------------------------

  try {

    document.getElementById("recStatus").textContent =
      "Starting microphone...";


    vad = await window.vad.MicVAD.new({
      onnxWASMBasePath:
        "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/",

      baseAssetPath:
        "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.30/dist/",

      // --------------------------------------------------------
      // Speech started
      // --------------------------------------------------------

      onSpeechStart: () => {

        console.log("🗣️ Speech started");

        document.getElementById("recStatus").innerHTML =
          '<span class="live-dot"></span>Listening — speech detected';
      },


      // --------------------------------------------------------
      // Speech ended
      // --------------------------------------------------------

      onSpeechEnd: (audio) => {

        console.log(
          "🔊 Speech segment received:",
          audio.length,
          "samples"
        );


        if (!audio || audio.length === 0) {
          return;
        }


        // Store segment
        speechSegments.push(audio);

        totalSpeechSamples += audio.length;


        const seconds =
          totalSpeechSamples / 16000;


        console.log(
          `📦 Total speech: ${seconds.toFixed(2)} sec`
        );


        document.getElementById("recStatus").innerHTML =
          `<span class="live-dot"></span>
           Listening — ${seconds.toFixed(1)} sec of speech captured`;
      }

    });


    await vad.start();


    // ----------------------------------------------------------
    // UI state
    // ----------------------------------------------------------

    isRecording = true;

    const micBtn =
      document.getElementById("micBtn");

    micBtn.classList.add("recording");


    document.getElementById("recStatusBadge").textContent =
      "Recording";

    document.getElementById("recStatusBadge").className =
      "badge badge-red";


    document.getElementById("recStatus").innerHTML =
      '<span class="live-dot"></span>Listening — speak naturally, tap again to stop';


    document.getElementById("resultsArea").style.display =
      "none";


    document.getElementById("audioPreview").style.display =
      "none";


    document.getElementById("processingCard").style.display =
      "none";


    // ----------------------------------------------------------
    // Timer
    // ----------------------------------------------------------

    recordingSeconds = 0;

    document.getElementById("recTimer").textContent =
      "00:00";


    timerInterval = setInterval(() => {

      recordingSeconds++;

      const minutes =
        String(
          Math.floor(recordingSeconds / 60)
        ).padStart(2, "0");

      const seconds =
        String(
          recordingSeconds % 60
        ).padStart(2, "0");


      document.getElementById("recTimer").textContent =
        `${minutes}:${seconds}`;

    }, 1000);


    console.log("🎙️ Silero VAD recording started");

  } catch (err) {

    console.error(
      "Failed to start VAD:",
      err
    );


    if (vad) {
      try {
        vad.pause();
      } catch { }
    }


    isRecording = false;

    document.getElementById("recStatusBadge").textContent =
      "Failed";

    document.getElementById("recStatusBadge").className =
      "badge badge-red";


    document.getElementById("recStatus").textContent =
      "Microphone/VAD failed: " + err.message;


    alert(
      "Could not start microphone:\n\n" +
      err.message
    );
  }
}


// ================================================================
// STOP RECORDING
// ================================================================

async function stopRecording() {

  if (!isRecording) {
    return;
  }


  console.log("🛑 Stopping recording...");


  isRecording = false;


  clearInterval(timerInterval);
  timerInterval = null;


  // ------------------------------------------------------------
  // Stop VAD
  // ------------------------------------------------------------

  if (vad) {

    try {

      await vad.pause();

      console.log("⏸️ VAD paused");

    } catch (err) {

      console.warn(
        "Could not pause VAD:",
        err
      );
    }
  }


  // ------------------------------------------------------------
  // Update UI
  // ------------------------------------------------------------

  document
    .getElementById("micBtn")
    .classList.remove("recording");


  document.getElementById("recStatusBadge").textContent =
    "Processing";

  document.getElementById("recStatusBadge").className =
    "badge badge-amber";


  document.getElementById("recStatus").textContent =
    "Recording stopped. Preparing consultation audio...";


  // ------------------------------------------------------------
  // Process accumulated speech
  // ------------------------------------------------------------

  await processAccumulatedAudio();
}


// ================================================================
// PROCESS ACCUMULATED SPEECH
// ================================================================

async function processAccumulatedAudio() {

  if (isProcessing) {
    console.log("⏳ Already processing.");
    return;
  }


  if (!currentConsultId) {
    console.error(
      "No consultation ID available."
    );

    return;
  }


  if (speechSegments.length === 0) {

    document.getElementById("recStatusBadge").textContent =
      "No Speech";

    document.getElementById("recStatusBadge").className =
      "badge badge-amber";


    document.getElementById("recStatus").textContent =
      "No speech was detected. Please record again.";

    return;
  }


  isProcessing = true;


  // ------------------------------------------------------------
  // Processing UI
  // ------------------------------------------------------------

  document.getElementById("processingCard").style.display =
    "block";


  const steps = [
    "Preparing consultation audio...",
    "AssemblyAI — transcribing consultation",
    "Documentation Agent — drafting SOAP note",
    "History Agent — cross-checking patient history",
    "Safety Agent — checking allergies & interactions"
  ];


  let stepIdx = 0;


  document.getElementById("processingStep").textContent =
    steps[stepIdx];


  const stepInterval = setInterval(() => {

    stepIdx++;

    if (stepIdx >= steps.length) {
      stepIdx = steps.length - 1;
    }

    document.getElementById("processingStep").textContent =
      steps[stepIdx];

  }, 3000);


  try {

    // ----------------------------------------------------------
    // Combine VAD segments
    // ----------------------------------------------------------

    console.log(
      "🧠 Combining",
      speechSegments.length,
      "speech segments..."
    );


    const combinedAudio =
      combineSegments();


    console.log(
      "📦 Combined samples:",
      combinedAudio.length
    );


    const duration =
      combinedAudio.length / 16000;


    console.log(
      `⏱️ Speech duration: ${duration.toFixed(2)} sec`
    );


    // ----------------------------------------------------------
    // Convert Float32 → WAV
    // ----------------------------------------------------------

    const wavBlob =
      float32ToWav(
        combinedAudio,
        16000
      );


    console.log(
      `🎵 WAV created: ${(wavBlob.size / 1024).toFixed(1)} KB`
    );


    // ----------------------------------------------------------
    // Preview
    // ----------------------------------------------------------

    const audioUrl =
      URL.createObjectURL(wavBlob);


    const preview =
      document.getElementById("audioPreview");


    preview.src = audioUrl;
    preview.style.display = "block";


    // ----------------------------------------------------------
    // Upload to backend
    // ----------------------------------------------------------

    const formData =
      new FormData();


    formData.append(
      "audio",
      wavBlob,
      "consultation.wav"
    );


    console.log(
      "📤 Uploading audio to consultation:",
      currentConsultId
    );


    const result =
      await Api.postForm(
        `/consultations/${currentConsultId}/audio`,
        formData
      );


    console.log(
      "✅ AI pipeline completed"
    );


    currentConsult = result;


    // ----------------------------------------------------------
    // Render results
    // ----------------------------------------------------------

    renderResults(result);


    document.getElementById("recStatusBadge").textContent =
      "Ready for Review";

    document.getElementById("recStatusBadge").className =
      "badge badge-green";


    document.getElementById("recStatus").textContent =
      "Draft ready below — review before approving.";


  } catch (err) {

    console.error(
      "❌ AI pipeline failed:",
      err
    );


    document.getElementById("recStatusBadge").textContent =
      "Failed";

    document.getElementById("recStatusBadge").className =
      "badge badge-red";


    document.getElementById("recStatus").textContent =
      "AI pipeline failed: " +
      err.message;


    alert(
      "AI processing failed:\n\n" +
      err.message
    );


  } finally {

    clearInterval(stepInterval);

    document.getElementById("processingCard").style.display =
      "none";

    isProcessing = false;
  }
}


// ================================================================
// COMBINE VAD SEGMENTS
// ================================================================

function combineSegments() {

  const combined =
    new Float32Array(totalSpeechSamples);


  let offset = 0;


  for (const segment of speechSegments) {

    combined.set(
      segment,
      offset
    );

    offset += segment.length;
  }


  return combined;
}


// ================================================================
// FLOAT32 AUDIO → WAV
// ================================================================

function float32ToWav(
  samples,
  sampleRate
) {

  const buffer =
    new ArrayBuffer(
      44 + samples.length * 2
    );


  const view =
    new DataView(buffer);


  // ------------------------------------------------------------
  // WAV header
  // ------------------------------------------------------------

  writeString(
    view,
    0,
    "RIFF"
  );


  view.setUint32(
    4,
    36 + samples.length * 2,
    true
  );


  writeString(
    view,
    8,
    "WAVE"
  );


  writeString(
    view,
    12,
    "fmt "
  );


  view.setUint32(
    16,
    16,
    true
  );


  // PCM
  view.setUint16(
    20,
    1,
    true
  );


  // Mono
  view.setUint16(
    22,
    1,
    true
  );


  // Sample rate
  view.setUint32(
    24,
    sampleRate,
    true
  );


  // Byte rate
  view.setUint32(
    28,
    sampleRate * 2,
    true
  );


  // Block align
  view.setUint16(
    32,
    2,
    true
  );


  // Bits per sample
  view.setUint16(
    34,
    16,
    true
  );


  writeString(
    view,
    36,
    "data"
  );


  view.setUint32(
    40,
    samples.length * 2,
    true
  );


  // ------------------------------------------------------------
  // PCM samples
  // ------------------------------------------------------------

  let offset = 44;


  for (let i = 0; i < samples.length; i++) {

    let sample =
      Math.max(
        -1,
        Math.min(
          1,
          samples[i]
        )
      );


    sample =
      sample < 0
        ? sample * 0x8000
        : sample * 0x7fff;


    view.setInt16(
      offset,
      sample,
      true
    );


    offset += 2;
  }


  return new Blob(
    [view],
    {
      type: "audio/wav"
    }
  );
}


// ================================================================
// WRITE STRING HELPER
// ================================================================

function writeString(
  view,
  offset,
  string
) {

  for (
    let i = 0;
    i < string.length;
    i++
  ) {

    view.setUint8(
      offset + i,
      string.charCodeAt(i)
    );
  }
}


// ================================================================
// RENDER AI RESULTS
// ================================================================

function renderResults(c) {

  document.getElementById("resultsArea").style.display =
    "block";


  // ------------------------------------------------------------
  // Transcript
  // ------------------------------------------------------------

  document.getElementById("transcriptBox").textContent =
    c.transcript || "(no transcript)";


  // ------------------------------------------------------------
  // SOAP
  // ------------------------------------------------------------

  const soap =
    c.soap || {};


  document.getElementById("soapBox").innerHTML =

    [
      "subjective",
      "objective",
      "assessment",
      "plan"
    ]

      .map(
        (key) => `

          <div class="soap-section">

            <div class="soap-label">
              ${key}
            </div>

            <div
              class="soap-text editable"
              contenteditable="true"
              data-field="${key}"
            >
              ${soap[key] || ""}
            </div>

          </div>

        `
      )

      .join("");


  // ------------------------------------------------------------
  // History
  // ------------------------------------------------------------

  const hist =
    c.relevantHistory || [];


  document.getElementById(
    "historyContent"
  ).innerHTML = `

    <div
      style="
        font-size:13px;
        margin-bottom:8px;
      "
    >
      ${c.contextNote || "No context note."}
    </div>

    ${hist.length

      ? `
          <ul
            style="
              margin:0;
              padding-left:18px;
              font-size:13px;
            "
          >

            ${hist
        .map(
          (h) =>
            `<li>${h}</li>`
        )
        .join("")}

          </ul>
        `

      : `
          <div
            class="text-muted"
            style="font-size:13px;"
          >
            No specific history items flagged.
          </div>
        `
    }

  `;


  // ------------------------------------------------------------
  // Safety alerts
  // ------------------------------------------------------------

  const alerts =
    c.safetyAlerts || [];


  document.getElementById(
    "safetyContent"
  ).innerHTML = alerts.length

      ? alerts
        .map(
          (a) => `

            <div
              class="alert alert-${a.severity}"
            >

              <span class="alert-icon">

                ${a.severity === "high"
              ? "🚨"
              : a.severity === "medium"
                ? "⚠️"
                : "ℹ️"
            }

              </span>

              <div>

                <b>${a.type}:</b>
                ${a.message}

              </div>

            </div>

          `
        )
        .join("")

      : `

      <div class="alert alert-low">

        <span class="alert-icon">
          ✅
        </span>

        <div>
          No safety concerns flagged by the AI.
          Please still confirm manually.
        </div>

      </div>

    `;


  // ------------------------------------------------------------
  // Prescription
  // ------------------------------------------------------------

  const rx =
    c.prescriptionDraft || [];


  document.getElementById("rxEmpty").style.display =
    rx.length
      ? "none"
      : "block";


  document.getElementById("rxBody").innerHTML =

    rx

      .map(
        (r, i) => `

          <tr data-idx="${i}">

            <td
              contenteditable="true"
              data-field="medicine"
            >
              ${r.medicine || ""}
            </td>

            <td
              contenteditable="true"
              data-field="dosage"
            >
              ${r.dosage || ""}
            </td>

            <td
              contenteditable="true"
              data-field="frequency"
            >
              ${r.frequency || ""}
            </td>

            <td
              contenteditable="true"
              data-field="duration"
            >
              ${r.duration || ""}
            </td>

            <td
              contenteditable="true"
              data-field="quantity"
            >
              ${r.quantity || ""}
            </td>

            <td
              contenteditable="true"
              data-field="instructions"
            >
              ${r.instructions || ""}
            </td>

          </tr>

        `
      )

      .join("");
}


// ================================================================
// COLLECT EDITED SOAP
// ================================================================

function collectEditedSoap() {

  const soap = {};


  document
    .querySelectorAll(
      "#soapBox [data-field]"
    )
    .forEach((el) => {

      soap[el.dataset.field] =
        el.textContent.trim();

    });


  return soap;
}


// ================================================================
// COLLECT EDITED PRESCRIPTION
// ================================================================

function collectEditedRx() {

  return Array.from(
    document.querySelectorAll(
      "#rxBody tr"
    )
  )

    .map((row) => {

      const rx = {};


      row
        .querySelectorAll(
          "[data-field]"
        )
        .forEach((cell) => {

          rx[cell.dataset.field] =
            cell.textContent.trim();

        });


      return rx;
    });
}


// ================================================================
// SAVE EDITS
// ================================================================

async function saveEdits() {

  try {

    const soap =
      collectEditedSoap();


    const prescriptionDraft =
      collectEditedRx();


    currentConsult =
      await Api.put(
        `/consultations/${currentConsultId}`,
        {
          soap,
          prescriptionDraft
        }
      );


    alert("Edits saved.");

  } catch (err) {

    console.error(
      "Failed to save edits:",
      err
    );


    alert(
      "Failed to save edits: " +
      err.message
    );
  }
}


// ================================================================
// APPROVE CONSULTATION
// ================================================================

async function approveConsultation() {

  const btn =
    document.getElementById(
      "approveBtn"
    );


  btn.disabled = true;

  btn.textContent =
    "Approving...";


  try {

    // ----------------------------------------------------------
    // Save latest edits
    // ----------------------------------------------------------

    const soap =
      collectEditedSoap();


    const prescriptionDraft =
      collectEditedRx();


    await Api.put(
      `/consultations/${currentConsultId}`,
      {
        soap,
        prescriptionDraft
      }
    );


    // ----------------------------------------------------------
    // Approve
    // ----------------------------------------------------------

    await Api.post(
      `/consultations/${currentConsultId}/approve`
    );


    alert(
      "Consultation approved. The patient can now see this in their portal."
    );


    window.location.href =
      "/doctor/consultations.html";


  } catch (err) {

    console.error(
      "Approval failed:",
      err
    );


    alert(
      "Failed to approve: " +
      err.message
    );


    btn.disabled = false;

    btn.textContent =
      "✓ Approve Consultation & Send Notes";
  }
}