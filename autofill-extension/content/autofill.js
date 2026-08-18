(() => {
  if (window.top !== window) return;

  const ROOT_ID = "applystronger-autofill-root";
  const MAX_PACKET_AGE_MS = 4 * 60 * 60 * 1000;

  const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const sensitivePatterns = [
    /social security|ssn/, /date of birth|birth date|dob/, /race|ethnicity/, /gender|sex\b/,
    /disability/, /veteran/, /criminal|conviction|felony/, /religion/, /sexual orientation/,
    /salary expectation|desired salary|compensation expectation/, /sponsorship|visa|work authorization|authorized to work/,
    /security clearance/, /license|licence|certification|credential/
  ];
  const fieldRules = [
    { keys: [/^first name$/, /^given name$/, /^firstname$/], path: ["profile", "first_name"] },
    { keys: [/^last name$/, /^family name$/, /^surname$/, /^lastname$/], path: ["profile", "last_name"] },
    { keys: [/^full name$/, /^name$/], path: ["profile", "full_name"] },
    { keys: [/^email$/, /email address/], path: ["profile", "email"] },
    { keys: [/^phone$/, /phone number/, /mobile phone/, /mobile number/], path: ["profile", "phone"] },
    { keys: [/^city$/, /^town$/], path: ["profile", "city"] },
    { keys: [/^state$/, /^province$/, /state province/], path: ["profile", "state"] },
    { keys: [/postal code/, /zip code/, /^zip$/], path: ["profile", "postal_code"] },
    { keys: [/^country$/], path: ["profile", "country"] },
    { keys: [/linkedin/], path: ["profile", "linkedin_url"] },
    { keys: [/portfolio/, /personal website/, /website url/], path: ["profile", "portfolio_url"] }
  ];

  function get(obj, path) { return path.reduce((v, key) => (v && typeof v === "object" ? v[key] : null), obj); }
  function labelText(el) {
    const bits = [];
    if (el.labels) for (const label of el.labels) bits.push(label.innerText || label.textContent || "");
    for (const attr of ["aria-label", "placeholder"]) if (el.getAttribute(attr)) bits.push(el.getAttribute(attr));
    if (el.name) bits.push(el.name);
    if (el.id) bits.push(el.id);
    const parentText = el.closest("label, [role='group'], .field, .application-question")?.innerText;
    if (parentText) bits.push(parentText.slice(0, 240));
    return normalize(bits.join(" "));
  }
  function nativeSetValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value); else el.value = value;
    for (const type of ["input", "change", "blur"]) el.dispatchEvent(new Event(type, { bubbles: true }));
  }
  function explicitAnswerFor(packet, label) {
    const answers = packet.answers && typeof packet.answers === "object" ? packet.answers : {};
    return Object.entries(answers).find(([q]) => normalize(q) === label) || null;
  }
  function fillTextFields(packet) {
    let filled = 0, skippedSensitive = 0;
    for (const el of Array.from(document.querySelectorAll("input, textarea"))) {
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) continue;
      if (el instanceof HTMLInputElement && ["file","hidden","password","checkbox","radio","submit","button"].includes(el.type)) continue;
      if (el.disabled || el.readOnly || String(el.value || "").trim()) continue;
      const label = labelText(el); if (!label) continue;
      const explicit = explicitAnswerFor(packet, label);
      if (explicit && explicit[1] != null && String(explicit[1]).trim()) { nativeSetValue(el, String(explicit[1])); filled++; continue; }
      if (sensitivePatterns.some((p) => p.test(label))) { skippedSensitive++; continue; }
      const rule = fieldRules.find((r) => r.keys.some((p) => p.test(label)));
      if (!rule) continue;
      const value = get(packet, rule.path);
      if (value != null && String(value).trim()) { nativeSetValue(el, String(value)); filled++; }
    }
    return { filled, skippedSensitive };
  }
  async function attachResume(packet) {
    if (!packet.resume?.url) return { attached: false, reason: "No approved resume is available." };
    const inputs = Array.from(document.querySelectorAll("input[type='file']"));
    const input = inputs.find((i) => /resume|cv|curriculum vitae/.test(labelText(i)) || /pdf|doc|docx/.test(normalize(i.getAttribute("accept")))) || inputs[0];
    if (!(input instanceof HTMLInputElement)) return { attached: false, reason: "No resume upload field is visible on this page yet." };
    try {
      const response = await fetch(packet.resume.url, { credentials: "omit", cache: "no-store" });
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      const file = new File([blob], packet.resume.filename || "ApplyStronger-Tailored-Resume.pdf", { type: blob.type || "application/pdf" });
      const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files;
      input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }));
      return { attached: true, reason: null };
    } catch { return { attached: false, reason: "Resume is ready, but this site requires you to choose the file manually." }; }
  }
  function providerName() {
    const host = location.hostname.toLowerCase();
    if (host.includes("myworkdayjobs.com") || host.endsWith("workday.com")) return "Workday";
    if (host.includes("greenhouse.io")) return "Greenhouse";
    if (host.includes("lever.co")) return "Lever";
    return "this employer site";
  }
  async function runFill(packet, root) {
    const button = root?.querySelector(".as-primary"); const result = root?.querySelector(".as-result");
    if (button) { button.disabled = true; button.textContent = "Filling…"; }
    const fields = fillTextFields(packet); const resume = await attachResume(packet);
    if (result) {
      const parts = [`Filled ${fields.filled} field${fields.filled === 1 ? "" : "s"}.`];
      parts.push(resume.attached ? "Approved resume attached." : (resume.reason || "Resume not attached yet."));
      if (fields.skippedSensitive) parts.push("Sensitive questions were left for you.");
      result.textContent = parts.join(" "); result.className = `as-result as-status ${resume.attached ? "as-success" : "as-warning"}`;
    }
    if (button) { button.disabled = false; button.textContent = "Fill this page again"; }
  }
  function render(packet) {
    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement("div"); root.id = ROOT_ID;
      root.innerHTML = `<div class="as-card"><div class="as-head"><span>ApplyStronger Autofill</span><button class="as-close" type="button" aria-label="Close ApplyStronger Autofill">×</button></div><div class="as-body"><p><strong>Your application is ready.</strong></p><p>ApplyStronger can fill common fields on ${providerName()} and attach your approved resume when the site allows it.</p><p class="as-status">Review everything before you submit. Sensitive questions are left for you unless you explicitly saved an answer.</p><button class="as-primary" type="button">Fill this page</button><p class="as-result as-status" aria-live="polite"></p></div></div>`;
      document.documentElement.appendChild(root);
      root.querySelector(".as-close")?.addEventListener("click", () => root.remove());
      root.querySelector(".as-primary")?.addEventListener("click", () => void runFill(packet, root));
    }
    return root;
  }
  function validPacket(packet) {
    if (!packet) return false;
    if (packet.savedAt && Date.now() - packet.savedAt > MAX_PACKET_AGE_MS) return false;
    if (packet.expiresAt && Date.parse(packet.expiresAt) < Date.now()) return false;
    if (packet.targetHost && location.hostname !== packet.targetHost && !location.hostname.endsWith(`.${packet.targetHost}`)) return false;
    return true;
  }
  let currentPacket = null;
  chrome.runtime.sendMessage({ type: "APPLYSTRONGER_GET_PACKET" }, (response) => {
    const packet = response?.packet;
    if (!validPacket(packet)) return;
    currentPacket = packet; render(packet);
  });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "APPLYSTRONGER_FILL_PAGE") return;
    if (!validPacket(currentPacket)) { sendResponse({ ok: false }); return; }
    const root = render(currentPacket);
    void runFill(currentPacket, root).then(() => sendResponse({ ok: true }));
    return true;
  });
})();
