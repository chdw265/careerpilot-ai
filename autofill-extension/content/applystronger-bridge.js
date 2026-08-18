(() => {
  if (window.top !== window) return;

  const ORIGIN = "https://applystronger.com";
  const marker = document.documentElement;
  marker.dataset.applystrongerAutofill = "ready";

  window.postMessage(
    { source: "applystronger-autofill", type: "READY" },
    ORIGIN,
  );

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== ORIGIN) return;
    const message = event.data;
    if (!message || message.source !== "applystronger-web") return;

    if (message.type === "SAVE_APPLICATION_PACKET") {
      chrome.runtime.sendMessage(
        {
          type: "APPLYSTRONGER_SAVE_PACKET",
          packet: message.packet,
        },
        (response) => {
          window.postMessage(
            {
              source: "applystronger-autofill",
              type: "SAVE_APPLICATION_PACKET_RESULT",
              requestId: message.requestId,
              ok: Boolean(response?.ok),
              error: response?.error || null,
            },
            ORIGIN,
          );
        },
      );
    }
  });
})();
