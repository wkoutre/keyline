// The "?" keyboard shortcut cheat sheet: a read-only overlay listing every key
// grouped by section. Shared by Gmail and Google Calendar; each surface passes
// its own sections (Gmail builds them from the command registry, Calendar from
// its curated key map).
//
// The overlay owns the keyboard while open through a WINDOW capture listener,
// which runs before the engines' document capture listeners: Escape or "?"
// closes it and every other key is swallowed, so a stray "e" can't archive
// mail hidden behind the sheet. No synthetic input is ever sent to the page.
window.InboxKeys = window.InboxKeys || {};

(function () {
  let root = null;

  function keyLabel(binding) {
    if (window.InboxKeys_KEYMAP && typeof InboxKeys_KEYMAP.displayBinding === "function") {
      return InboxKeys_KEYMAP.displayBinding(binding);
    }
    return String(binding || "");
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function isCloseKey(e) {
    return e.key === "Escape" || (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey);
  }

  function onKey(e) {
    if (!root) return;
    // Let browser/OS chords (Cmd+R, Cmd+L, Cmd+C) through; only plain keys are ours.
    if ((e.metaKey || e.ctrlKey) && !isCloseKey(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (isCloseKey(e)) hide();
  }

  // spec: { title, sections: [{ title, rows: [{ label, keys: [binding…] }] }], footer }
  function show(spec) {
    hide();
    const s = spec || {};
    root = el("div", "inboxkeys-cheatsheet");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", s.title || "Keyboard shortcuts");
    const panel = el("div", "inboxkeys-cheatsheet-panel");
    const head = el("div", "inboxkeys-cheatsheet-head");
    head.appendChild(el("span", "inboxkeys-cheatsheet-title", s.title || "Keyboard shortcuts"));
    const close = el("span", "inboxkeys-cheatsheet-close");
    close.appendChild(el("kbd", null, "?"));
    close.appendChild(document.createTextNode(" or "));
    close.appendChild(el("kbd", null, "Esc"));
    close.appendChild(document.createTextNode(" to close"));
    head.appendChild(close);
    panel.appendChild(head);

    const grid = el("div", "inboxkeys-cheatsheet-grid");
    for (const section of s.sections || []) {
      const rows = (section.rows || []).filter((r) => r && r.keys && r.keys.length);
      if (!rows.length) continue;
      const box = el("section", "inboxkeys-cheatsheet-section");
      box.appendChild(el("h3", null, section.title));
      for (const r of rows) {
        const row = el("div", "inboxkeys-cheatsheet-row");
        row.appendChild(el("span", "inboxkeys-cheatsheet-label", r.label));
        const keys = el("span", "inboxkeys-cheatsheet-keys");
        r.keys.forEach((k, i) => {
          if (i) keys.appendChild(el("span", "inboxkeys-cheatsheet-or", "or"));
          for (const part of String(k).split(/\s+/).filter(Boolean)) keys.appendChild(el("kbd", null, keyLabel(part)));
        });
        row.appendChild(keys);
        box.appendChild(row);
      }
      grid.appendChild(box);
    }
    panel.appendChild(grid);
    if (s.footer) panel.appendChild(el("div", "inboxkeys-cheatsheet-footer", s.footer));
    root.appendChild(panel);
    root.addEventListener("mousedown", (e) => {
      if (e.target === root) hide();
    });
    (document.body || document.documentElement).appendChild(root);
    window.addEventListener("keydown", onKey, true);
    return true;
  }

  function hide() {
    window.removeEventListener("keydown", onKey, true);
    if (root) root.remove();
    root = null;
  }

  function isOpen() {
    return !!root;
  }

  function toggle(spec) {
    if (root) {
      hide();
      return false;
    }
    return show(typeof spec === "function" ? spec() : spec);
  }

  InboxKeys.cheatsheet = { show, hide, toggle, isOpen };
})();
