const status = document.getElementById("status");
const clear = document.getElementById("clear");

function render(packet) {
  if (!packet) {
    status.innerHTML = `
      <p><strong>No application selected yet.</strong></p>
      <p class="muted">Choose a job in ApplyStronger and click “Apply with this resume.”</p>
    `;
    return;
  }

  const job = packet.job || {};
  const resume = packet.resume || {};
  const label = [job.title, job.company].filter(Boolean).join(" at ");
  status.innerHTML = `
    <p class="ready">Ready to help with your application.</p>
    <p>${label || "Your selected job"}</p>
    <p class="muted">Approved resume: ${resume.filename || "Tailored resume"}</p>
  `;
}

chrome.runtime.sendMessage({ type: "APPLYSTRONGER_GET_PACKET" }, (response) => {
  render(response?.packet || null);
});

clear.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "APPLYSTRONGER_CLEAR_PACKET" }, () => render(null));
});
