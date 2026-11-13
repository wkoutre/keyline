// Minimal MV3 service worker. The heavy lifting is in the content script; this
// just relays popup actions to the active Gmail tab. Defaults live in
// storage.js DEFAULTS (enabled and hotkeysEnabled default on), so nothing is
// seeded here.
importScripts("dev-reload.js");
const devReload = self.KeylineDevReload.create(chrome, (...a) => fetch(...a));
chrome.runtime.onInstalled.addListener((details) => {
  devReload.onInstalled(details).catch(() => {});
});
// Baseline the dev stamp as soon as this load starts (no-op unless dev mode).
devReload.check().catch(() => {});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "inboxkeys:dev-check") {
    devReload.check().then(sendResponse, () => sendResponse({ dev: false }));
    return true;
  }
  if (msg && msg.type === "inboxkeys:relay") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab && /mail\.google\.com/.test(tab.url || "")) {
        chrome.tabs.sendMessage(tab.id, msg.payload);
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, reason: "not-gmail" });
      }
    });
    return true; // async response
  }
});
