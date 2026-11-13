// Dev-only self-reload for an UNPACKED Keyline, so a live test only needs a
// branch switch (`git checkout`) in the folder Chrome loads, never a click on
// chrome://extensions.
//
// Active only when BOTH hold:
//   1. chrome.management.getSelf() says installType "development" (unpacked;
//      never true for the Web Store build), and
//   2. the opt-in marker file `dev-autoreload.flag` exists at the extension
//      root. It is gitignored and never packaged (release.sh zips only
//      manifest.json, icons and src), so a checkout only auto-reloads where
//      someone created the flag on purpose (the Chrome test copy, not the
//      main checkout Nick's everyday browser runs).
//
// Mechanism: a Gmail tab's content script asks "inboxkeys:dev-check" every few
// seconds once the worker has said dev mode is on. The worker hashes every file
// the manifest loads (read fresh from disk via fetch of the extension URL),
// keeps the first hash for this load in chrome.storage.session (cleared by a
// reload), and calls chrome.runtime.reload() when the hash changes. After a
// reload (onInstalled, reason "update") it reloads open Gmail and Calendar
// tabs, whose old content scripts are orphaned by then. No new permission:
// getSelf needs none, storage.session is covered by "storage", and tab
// queries by URL ride on the existing host permissions.
(function (root) {
  const FLAG = "dev-autoreload.flag";
  const TAB_URLS = ["https://mail.google.com/*", "https://calendar.google.com/*"];

  function create(chromeApi, fetchFn) {
    const c = chromeApi;
    let enabled = null; // cached per worker lifetime

    async function isEnabled() {
      if (enabled !== null) return enabled;
      let dev = false;
      try {
        const self = await c.management.getSelf();
        dev = !!self && self.installType === "development";
      } catch (_) {
        dev = false;
      }
      if (dev) {
        try {
          const r = await fetchFn(c.runtime.getURL(FLAG), { cache: "no-store" });
          dev = !!(r && r.ok);
        } catch (_) {
          dev = false;
        }
      }
      enabled = dev;
      return enabled;
    }

    function watchedFiles() {
      const m = c.runtime.getManifest() || {};
      const files = new Set(["manifest.json"]);
      for (const cs of m.content_scripts || []) {
        for (const f of [...(cs.js || []), ...(cs.css || [])]) files.add(f);
      }
      if (m.background && m.background.service_worker) files.add(m.background.service_worker);
      files.add("src/background/dev-reload.js");
      return [...files];
    }

    // FNV-1a over every watched file's text: cheap and order-stable.
    async function stamp() {
      let h = 0x811c9dc5;
      for (const f of watchedFiles()) {
        let text = "";
        try {
          const r = await fetchFn(c.runtime.getURL(f), { cache: "no-store" });
          text = r && r.ok ? await r.text() : "<missing>";
        } catch (_) {
          text = "<error>";
        }
        const s = f + "\n" + text;
        for (let i = 0; i < s.length; i++) {
          h ^= s.charCodeAt(i);
          h = Math.imul(h, 0x01000193) >>> 0;
        }
      }
      return h.toString(16);
    }

    // Returns { dev } and reloads the extension when the files changed.
    async function check() {
      if (!(await isEnabled())) return { dev: false };
      const now = await stamp();
      const got = await c.storage.session.get("devStamp");
      const base = got && got.devStamp;
      if (!base) {
        await c.storage.session.set({ devStamp: now });
        return { dev: true, changed: false };
      }
      if (base !== now) {
        c.runtime.reload();
        return { dev: true, changed: true };
      }
      return { dev: true, changed: false };
    }

    async function onInstalled(details) {
      if (!details || details.reason !== "update") return false;
      if (!(await isEnabled())) return false;
      const tabs = await c.tabs.query({ url: TAB_URLS });
      for (const t of tabs || []) {
        try {
          c.tabs.reload(t.id);
        } catch (_) {}
      }
      return true;
    }

    return { isEnabled, stamp, check, onInstalled, watchedFiles };
  }

  root.KeylineDevReload = { create, FLAG };
  if (typeof module !== "undefined" && module.exports) module.exports = { create, FLAG };
})(typeof self !== "undefined" ? self : globalThis);
