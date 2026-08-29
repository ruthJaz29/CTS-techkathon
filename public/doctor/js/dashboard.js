/**
 * dashboard.js
 * ------------------------------------------------------------------
 * Drives the whole "New Consultation" flow end to end:
 *   1. Doctor picks a patient + names the recording.
 *   2. Tap mic -> browser MediaRecorder captures audio.
 *   3. Tap again -> stop, create a consultation record on the server,
 *      then upload the audio blob. The server runs all 3 Gemini
 *      agents and returns the finished draft in one response.
 *   4. Doctor reviews/edits the SOAP note + prescription table.
 *   5. Doctor clicks Approve -> record becomes final & visible to
 *      the patient portal.
 * ------------------------------------------------------------------
 */

Session.requireRole("doctor");

let mediaRecorder = null;
let audioChunks = [];
let recordingSeconds = 0;
let timerInterval = null;
let currentConsultId = null;
let currentConsult = null;
let patients = [];

// ---------------- Init ----------------
(async function init() {
  const user = Session.user();
  document.getElementById("doctorName").textContent = user.name;
  document.getElementById("doctorInitials").textContent = initials(user.name);

  patients = await Api.get("/patients");
  const select = document.getElementById("patientSelect");
  select.innerHTML = patients.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");
  select.addEventListener("change", renderPatientSnapshot);
  renderPatientSnapshot();
})();

function logout() { Session.clear(); window.location.href = "/login.html"; }

function renderPatientSnapshot() {
  const patient = patients.find((p) => p.id === document.getElementById("patientSelect").value);
  const box = document.getElementById("patientSnapshot");
  if (!patient) { box.textContent = "Select a patient."; return; }

  box.innerHTML = `
    <div style="margin-bottom:8px;"><b>${patient.name}</b> · ${patient.gender}, DOB ${patient.dob}</div>
    <div style="margin-bottom:6px;"><span class="soap-label">Allergies</span><br>
      ${patient.allergies.length ? patient.allergies.map(a => `<span class="badge badge-red">${a}</span>`).join(" ") : '<span class="text-muted">None recorded</span>'}
    </div>
    <div><span class="soap-label">Current Medications</span><br>
      ${patient.currentMedications.length ? patient.currentMedications.map(m => `${m.medicine} ${m.dosage} (${m.frequency})`).join("<br>") : '<span class="text-muted">None recorded</span>'}
    </div>
  `;
}

// ---------------- Recording ----------------
async function toggleRecording() {
  if (!mediaRecorder || mediaRecorder.state === "inactive") {
    await startRecording();
  } else {
    stopRecording();
  }
}

async function startRecording() {
  const patientId = document.getElementById("patientSelect").value;
  const name = document.getElementById("consultName").value.trim();
  if (!patientId || !name) {
    alert("Please select a patient and name the consultation before recording.");
    return;
  }

  // Create the consultation shell on the server first so we have an id.
  currentConsult = await Api.post("/consultations", {
    patientId,
    doctorId: Session.user().id,
    name,
  });
  currentConsultId = currentConsult.id;

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioChunks = [];
  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
  mediaRecorder.onstop = handleRecordingStopped;
  mediaRecorder.start();

  document.getElementById("micBtn").classList.add("recording");
  document.getElementById("recStatusBadge").textContent = "Recording";
  document.getElementById("recStatusBadge").className = "badge badge-red";
  document.getElementById("recStatus").innerHTML = '<span class="live-dot"></span>Recording — tap again to stop';
  document.getElementById("resultsArea").style.display = "none";
  document.getElementById("audioPreview").style.display = "none";

  recordingSeconds = 0;
  timerInterval = setInterval(() => {
    recordingSeconds++;
    const m = String(Math.floor(recordingSeconds / 60)).padStart(2, "0");
    const s = String(recordingSeconds % 60).padStart(2, "0");
    document.getElementById("recTimer").textContent = `${m}:${s}`;
  }, 1000);
}

function stopRecording() {
  mediaRecorder.stop();
  mediaRecorder.stream.getTracks().forEach((t) => t.stop());
  clearInterval(timerInterval);
  document.getElementById("micBtn").classList.remove("recording");
}

async function handleRecordingStopped() {
  const blob = new Blob(audioChunks, { type: "audio/webm" });
  const url = URL.createObjectURL(blob);
  document.getElementById("audioPreview").src = url;
  document.getElementById("audioPreview").style.display = "block";

  document.getElementById("recStatusBadge").textContent = "Processing";
  document.getElementById("recStatusBadge").className = "badge badge-amber";
  document.getElementById("recStatus").textContent = "Recording captured. Running AI pipeline...";
  document.getElementById("processingCard").style.display = "block";

  const steps = [
    "Documentation Agent — transcribing & drafting SOAP note",
    "History Agent — cross-checking patient history",
    "Safety Agent — checking allergies & interactions",
  ];
  let stepIdx = 0;
  const stepInterval = setInterval(() => {
    stepIdx = (stepIdx + 1) % steps.length;
    document.getElementById("processingStep").textContent = steps[stepIdx];
  }, 2200);

  try {
    const formData = new FormData();
    formData.append("audio", blob, "consultation.webm");
    const result = await Api.postForm(`/consultations/${currentConsultId}/audio`, formData);
    currentConsult = result;
    renderResults(result);
    document.getElementById("recStatusBadge").textContent = "Ready for Review";
    document.getElementById("recStatusBadge").className = "badge badge-green";
    document.getElementById("recStatus").textContent = "Draft ready below — review before approving.";
  } catch (err) {
    document.getElementById("recStatusBadge").textContent = "Failed";
    document.getElementById("recStatusBadge").className = "badge badge-red";
    document.getElementById("recStatus").textContent = "AI pipeline failed: " + err.message;
  } finally {
    clearInterval(stepInterval);
    document.getElementById("processingCard").style.display = "none";
  }
}

// ---------------- Rendering AI results ----------------
function renderResults(c) {
  document.getElementById("resultsArea").style.display = "block";

  document.getElementById("transcriptBox").textContent = c.transcript || "(no transcript)";

  const soap = c.soap || {};
  document.getElementById("soapBox").innerHTML = ["subjective", "objective", "assessment", "plan"].map((key) => `
    <div class="soap-section">
      <div class="soap-label">${key}</div>
      <div class="soap-text editable" contenteditable="true" data-field="${key}">${soap[key] || ""}</div>
    </div>
  `).join("");

  const hist = c.relevantHistory || [];
  document.getElementById("historyContent").innerHTML = `
    <div style="font-size:13px; margin-bottom:8px;">${c.contextNote || "No context note."}</div>
    ${hist.length ? "<ul style='margin:0; padding-left:18px; font-size:13px;'>" + hist.map(h => `<li>${h}</li>`).join("") + "</ul>" : '<div class="text-muted" style="font-size:13px;">No specific history items flagged.</div>'}
  `;

  const alerts = c.safetyAlerts || [];
  document.getElementById("safetyContent").innerHTML = alerts.length
    ? alerts.map((a) => `
        <div class="alert alert-${a.severity}">
          <span class="alert-icon">${a.severity === "high" ? "🚨" : a.severity === "medium" ? "⚠️" : "ℹ️"}</span>
          <div><b>${a.type}:</b> ${a.message}</div>
        </div>
      `).join("")
    : `<div class="alert alert-low"><span class="alert-icon">✅</span><div>No safety concerns flagged by the AI. Please still confirm manually.</div></div>`;

  const rx = c.prescriptionDraft || [];
  document.getElementById("rxEmpty").style.display = rx.length ? "none" : "block";
  document.getElementById("rxBody").innerHTML = rx.map((r, i) => `
    <tr data-idx="${i}">
      <td contenteditable="true" data-field="medicine">${r.medicine || ""}</td>
      <td contenteditable="true" data-field="dosage">${r.dosage || ""}</td>
      <td contenteditable="true" data-field="frequency">${r.frequency || ""}</td>
      <td contenteditable="true" data-field="duration">${r.duration || ""}</td>
      <td contenteditable="true" data-field="quantity">${r.quantity || ""}</td>
      <td contenteditable="true" data-field="instructions">${r.instructions || ""}</td>
    </tr>
  `).join("");
}

function collectEditedSoap() {
  const soap = {};
  document.querySelectorAll("#soapBox [data-field]").forEach((el) => {
    soap[el.dataset.field] = el.textContent.trim();
  });
  return soap;
}

function collectEditedRx() {
  return Array.from(document.querySelectorAll("#rxBody tr")).map((row) => {
    const rx = {};
    row.querySelectorAll("[data-field]").forEach((cell) => { rx[cell.dataset.field] = cell.textContent.trim(); });
    return rx;
  });
}

async function saveEdits() {
  const soap = collectEditedSoap();
  const prescriptionDraft = collectEditedRx();
  currentConsult = await Api.put(`/consultations/${currentConsultId}`, { soap, prescriptionDraft });
  alert("Edits saved.");
}

async function approveConsultation() {
  const btn = document.getElementById("approveBtn");
  btn.disabled = true;
  btn.textContent = "Approving...";
  try {
    // Persist any last-second edits before approving.
    const soap = collectEditedSoap();
    const prescriptionDraft = collectEditedRx();
    await Api.put(`/consultations/${currentConsultId}`, { soap, prescriptionDraft });
    await Api.post(`/consultations/${currentConsultId}/approve`);
    alert("Consultation approved. The patient can now see this in their portal.");
    window.location.href = "/doctor/consultations.html";
  } catch (err) {
    alert("Failed to approve: " + err.message);
    btn.disabled = false;
    btn.textContent = "✓ Approve Consultation & Send Notes";
  }
}
