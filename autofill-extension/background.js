const PACKET_KEY = "applystrongerCurrentApplication";

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.remove(PACKET_KEY).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "APPLYSTRONGER_SAVE_PACKET") {
    const packet = message.packet;
    if (!packet || typeof packet !== "object") {
      sendResponse({ ok: false, error: "Invalid application packet." });
      return;
    }

    const stored = {
      ...packet,
      savedAt: Date.now(),
    };

    chrome.storage.local
      .set({ [PACKET_KEY]: stored })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "APPLYSTRONGER_GET_PACKET") {
    chrome.storage.local
      .get(PACKET_KEY)
      .then((result) => sendResponse({ ok: true, packet: result[PACKET_KEY] || null }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "APPLYSTRONGER_CLEAR_PACKET") {
    chrome.storage.local
      .remove(PACKET_KEY)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
});
