const status = document.getElementById("status");
const clear = document.getElementById("clear");
const fill = document.getElementById("fill");
const open = document.getElementById("open");
let currentPacket = null;

function render(packet) {
  currentPacket = packet || null;
  if (!packet) {
    status.innerHTML = `
      <p><strong>No application selected yet.</strong></p>
      <p class="muted">Choose a job in ApplyStronger, approve the tailored resume, then click “Apply with this resume.”</p>
    `;
    fill.disabled = true;
    return;
  }

  const job = packet.job || {};
  const resume = packet.resume || {};
  const label = [job.title, job.company].filter(Boolean).join(" at ");
  status.innerHTML = `
    <p class="ready">Ready for this application.</p>
    <p>${label || "Your selected job"}</p>
    <p class="muted">Approved resume: ${resume.filename || "Tailored resume"}</p>
  `;
  fill.disabled = false;
}

chrome.runtime.sendMessage({ type: "APPLYSTRONGER_GET_PACKET" }, (response) => {
  render(response?.packet || null);
});

fill.addEventListener("click", async () => {
  if (!currentPacket) return;
  fill.disabled = true;
  fill.textContent = "Filling…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active page");
    await chrome.tabs.sendMessage(tab.id, { type: "APPLYSTRONGER_FILL_PAGE" });
    fill.textContent = "Fill this page again";
  } catch {
    status.insertAdjacentHTML(
      "beforeend",
      '<p class="muted">Open the employer application page, then press “Fill this page.”</p>',
    );
    fill.textContent = "Fill this page";
  } finally {
    fill.disabled = false;
  }
});

clear.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "APPLYSTRONGER_CLEAR_PACKET" }, () => render(null));
});
