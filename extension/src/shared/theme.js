// Keyline themes: the catalog plus the one function that applies a theme.
//
// Every Keyline surface (Cmd+K palette, "?" sheet, toasts, pickers, the tab
// bar, the in-Gmail settings modal, the Calendar overlay, the options page and
// the popup) is styled only through --ik-* CSS custom properties. themes.css
// defines those tokens once per theme, keyed off a data-inboxkeys-theme
// attribute on <html>. Choosing a theme is therefore one attribute write; no
// stylesheet swaps, no per-surface code.
//
// Each theme is our own palette that borrows a mood (colors, type, corner
// radii) from a design system Nick likes. No logos, brand assets or brand
// fonts are copied; fonts fall back to what the system already has.
//
// Loaded as a content script (after storage.js) on Gmail and Calendar, and as a
// plain script by the options page and popup.
window.InboxKeys = window.InboxKeys || {};

(function () {
  const THEMES = [
    {
      id: "keyline",
      name: "Keyline",
      note: "Indigo and slate. The default.",
      swatch: ["#ffffff", "#0f172a", "#4f46e5"],
    },
    {
      id: "clay",
      name: "Clay",
      inspired: "Claude",
      note: "Warm ivory, ink and terracotta, serif headings.",
      swatch: ["#faf9f5", "#1f1e1d", "#c96442"],
    },
    {
      id: "mono",
      name: "Mono",
      inspired: "Codex",
      note: "Black and white, tight corners, monospace input.",
      swatch: ["#ffffff", "#0d0d0d", "#5d5d5d"],
    },
    {
      id: "aurora",
      name: "Aurora",
      inspired: "Gemini",
      note: "Airy, very round, blue to violet gradient.",
      swatch: ["#f0f4f9", "#1f1f1f", "#7b6fe0"],
    },
    {
      id: "plush",
      name: "Plush",
      inspired: "family.co",
      note: "Soft, rounded and chunky, black pill buttons.",
      swatch: ["#f6f7f9", "#141414", "#1a88f8"],
    },
  ];
  const DEFAULT = "keyline";
  const ATTR = "data-inboxkeys-theme";

  function normalize(id) {
    const v = String(id || "").trim().toLowerCase();
    return THEMES.some((t) => t.id === v) ? v : DEFAULT;
  }

  function byId(id) {
    return THEMES.find((t) => t.id === normalize(id));
  }

  // "Clay (Claude-inspired)" for pickers and palette rows.
  function label(id) {
    const t = byId(id);
    return t.inspired ? `${t.name} (${t.inspired}-inspired)` : t.name;
  }

  function apply(id, doc) {
    const d = doc || (typeof document !== "undefined" ? document : null);
    const v = normalize(id);
    if (d && d.documentElement) d.documentElement.setAttribute(ATTR, v);
    return v;
  }

  function current(doc) {
    const d = doc || (typeof document !== "undefined" ? document : null);
    return normalize(d && d.documentElement && d.documentElement.getAttribute(ATTR));
  }

  // Apply the stored theme now and follow changes from any tab, the options
  // page, or another computer (the theme syncs like every other preference).
  // Call after storage.load().
  function init(storage) {
    const s = storage || InboxKeys.storage;
    apply(s && s.get ? s.get("theme") : DEFAULT);
    if (s && typeof s.onChange === "function") {
      s.onChange((cache, changes) => {
        if (changes && changes.theme) apply(cache.theme);
      });
    }
  }

  // Persist (and apply right away, so the change is visible before the storage
  // round trip finishes).
  function set(id, storage) {
    const s = storage || InboxKeys.storage;
    const v = apply(id);
    if (s && typeof s.set === "function") return Promise.resolve(s.set({ theme: v })).then(() => v);
    return Promise.resolve(v);
  }

  InboxKeys.theme = { THEMES, DEFAULT, ATTR, normalize, byId, label, apply, current, init, set };
})();
