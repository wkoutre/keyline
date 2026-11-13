// Shared keybinding catalog: the single source of truth for default keys, the
// contexts each command fires in, and which bindings are "fixed" (engine
// special-cases them; settings UI shows them read-only).
// Plain data only — no chrome APIs, no window.InboxKeys dependency. Loaded as the
// FIRST content script AND by options.html via <script src="../shared/keymap.js">.
(function () {
  const DEFAULT_CONTEXTS = ["inboxList", "threadView", "unknown"];

  // contexts: where the binding is live. fixed: engine handles it specially and
  // the settings UI renders it read-only.
  const commands = [
    // Compose / messaging
    { id: "compose", title: "Compose new email", group: "Compose", defaultKeys: ["c"], contexts: ["inboxList", "threadView"], fixed: false },
    // reply / reply-all / forward also fire from the list: they open the cursor
    // conversation and start the draft in one keystroke (listnav.openThen).
    // Enter stays "open" in the list (the engine special-cases it there).
    { id: "reply", title: "Reply", group: "Compose", defaultKeys: ["r"], contexts: ["inboxList", "threadView"], fixed: false },
    { id: "reply-all", title: "Reply all", group: "Compose", defaultKeys: ["Enter", "a"], contexts: ["inboxList", "threadView"], fixed: false },
    { id: "forward", title: "Forward", group: "Compose", defaultKeys: ["f"], contexts: ["inboxList", "threadView"], fixed: false },
    { id: "open-link-or-attachment", title: "Open link or attachment", group: "Compose", defaultKeys: ["Mod+O"], contexts: ["threadView"], fixed: true },
    { id: "attach-file", title: "Attach file", group: "Compose", defaultKeys: ["Mod+U"], contexts: ["compose"], fixed: true },
    { id: "schedule-send", title: "Schedule send…", group: "Compose", defaultKeys: ["Mod+Shift+Enter"], contexts: ["compose", "threadView"], fixed: true },
    { id: "undo-send", title: "Undo send", group: "Compose", defaultKeys: ["Mod+Z"], contexts: ["inboxList", "threadView", "compose", "unknown"], fixed: true },
    { id: "discard-draft", title: "Discard draft", group: "Compose", defaultKeys: ["Mod+Shift+D"], contexts: ["compose", "threadView"], fixed: true },

    // Triage
    { id: "archive", title: "Archive", group: "Triage", defaultKeys: ["e"], contexts: ["inboxList", "threadView"], fixed: false },
    { id: "mark-not-done", title: "Mark not done", group: "Triage", defaultKeys: ["Shift+E"], contexts: ["inboxList", "threadView"], fixed: true },
    { id: "delete", title: "Delete", group: "Triage", defaultKeys: ["#"], contexts: ["inboxList", "threadView"], fixed: false },
    { id: "undo", title: "Undo", group: "Triage", defaultKeys: ["z"], contexts: DEFAULT_CONTEXTS, fixed: false },
    { id: "mark-read-unread", title: "Mark read or unread", group: "Triage", defaultKeys: ["u"], contexts: ["inboxList", "threadView"], fixed: false },
    { id: "mark-read", title: "Mark as read", group: "Triage", defaultKeys: [], contexts: ["inboxList", "threadView"], fixed: false },
    { id: "mark-unread", title: "Mark as unread", group: "Triage", defaultKeys: [], contexts: ["inboxList", "threadView"], fixed: false },
    { id: "snooze", title: "Snooze…", group: "Triage", defaultKeys: ["h"], contexts: ["inboxList", "threadView"], fixed: false },
    { id: "remind-no-reply", title: "Remind me if no reply…", group: "Triage", defaultKeys: ["Shift+H"], contexts: ["inboxList", "threadView"], fixed: false },
    { id: "report-spam", title: "Report spam", group: "Triage", defaultKeys: ["!"], contexts: ["inboxList", "threadView"], fixed: false },
    { id: "star", title: "Star / toggle star", group: "Triage", defaultKeys: ["s"], contexts: ["inboxList", "threadView"], fixed: false },
    { id: "mute", title: "Mute", group: "Triage", defaultKeys: ["Shift+M"], contexts: ["inboxList", "threadView"], fixed: true },
    { id: "unsubscribe", title: "Unsubscribe", group: "Triage", defaultKeys: ["Mod+U"], contexts: ["threadView"], fixed: true },
    { id: "label", title: "Add or remove label", group: "Labels", defaultKeys: ["l"], contexts: ["inboxList", "threadView"], fixed: false },
    { id: "remove-label", title: "Remove label", group: "Labels", defaultKeys: ["y"], contexts: ["inboxList", "threadView"], fixed: false },
    { id: "remove-all-labels", title: "Remove all labels", group: "Labels", defaultKeys: ["Shift+Y"], contexts: ["inboxList", "threadView"], fixed: true },
    { id: "move", title: "Move", group: "Labels", defaultKeys: ["v"], contexts: ["inboxList", "threadView"], fixed: false },

    // Navigation (chords mirror Gmail's "g" prefix)
    { id: "go-inbox", title: "Go to Inbox", group: "Go to", defaultKeys: ["g i"], contexts: DEFAULT_CONTEXTS, fixed: false },
    { id: "go-sent", title: "Go to Sent", group: "Go to", defaultKeys: ["g t"], contexts: DEFAULT_CONTEXTS, fixed: false },
    { id: "go-drafts", title: "Go to Drafts", group: "Go to", defaultKeys: ["g d"], contexts: DEFAULT_CONTEXTS, fixed: false },
    { id: "go-starred", title: "Go to Starred", group: "Go to", defaultKeys: ["g s"], contexts: DEFAULT_CONTEXTS, fixed: false },
    { id: "go-snoozed", title: "Go to Snoozed", group: "Go to", defaultKeys: ["g h"], contexts: DEFAULT_CONTEXTS, fixed: false },
    { id: "go-important", title: "Go to Important", group: "Go to", defaultKeys: [], contexts: DEFAULT_CONTEXTS, fixed: false },
    { id: "go-all", title: "Go to All Mail", group: "Go to", defaultKeys: ["g a"], contexts: DEFAULT_CONTEXTS, fixed: false },
    { id: "go-spam", title: "Go to Spam", group: "Go to", defaultKeys: [], contexts: DEFAULT_CONTEXTS, fixed: false },
    { id: "go-trash", title: "Go to Trash", group: "Go to", defaultKeys: [], contexts: DEFAULT_CONTEXTS, fixed: false },
    { id: "go-settings", title: "Open Settings", group: "Go to", defaultKeys: [], contexts: DEFAULT_CONTEXTS, fixed: false },

    // List scrolling + paging
    { id: "go-top", title: "Go to top of list", group: "Navigation", defaultKeys: ["g g"], contexts: ["inboxList"], fixed: false },
    { id: "go-bottom", title: "Go to bottom of list", group: "Navigation", defaultKeys: ["Shift+G"], contexts: ["inboxList"], fixed: true },
    { id: "next-page", title: "Next page (older)", group: "Navigation", defaultKeys: ["Shift+N"], contexts: ["inboxList"], fixed: true },
    { id: "prev-page", title: "Previous page (newer)", group: "Navigation", defaultKeys: ["Shift+P"], contexts: ["inboxList"], fixed: true },
    { id: "expand-message", title: "Expand / collapse focused message", group: "Navigation", defaultKeys: ["o"], contexts: ["threadView"], fixed: false },
    { id: "expand-all", title: "Expand / collapse all messages", group: "Navigation", defaultKeys: ["Shift+O"], contexts: ["threadView"], fixed: true },

    // Split-inbox tabs (engine special-cases Tab / Shift+Tab)
    { id: "next-tab", title: "Next tab", group: "Tabs", defaultKeys: ["Tab"], contexts: ["inboxList"], fixed: true },
    { id: "prev-tab", title: "Previous tab", group: "Tabs", defaultKeys: ["Shift+Tab"], contexts: ["inboxList"], fixed: true },

    // Thread navigation (engine special-cases Escape)
    { id: "back-to-list", title: "Back to list", group: "Navigation", defaultKeys: ["Escape"], contexts: ["threadView"], fixed: true },

    // Calendar (engine special-cases the 0 / 0 0 keys)
    { id: "calendar-half", title: "Open calendar (side panel)", group: "Calendar", defaultKeys: ["0"], contexts: ["inboxList", "unknown"], fixed: true },
    { id: "calendar-tab", title: "Open calendar (new tab)", group: "Calendar", defaultKeys: ["0 0"], contexts: ["inboxList", "unknown"], fixed: true },

    // Search
    { id: "search", title: "Search mail…", group: "Search", defaultKeys: ["/"], contexts: ["inboxList", "threadView"], fixed: false },
    { id: "mail-from-sender", title: "All mail from this sender", group: "Search", defaultKeys: ["g f"], contexts: ["inboxList", "threadView"], fixed: false },
    { id: "contact-sidebar", title: "Toggle contact sidebar", group: "Search", defaultKeys: ["i"], contexts: ["inboxList", "threadView"], fixed: false },
    { id: "mail-from-domain", title: "All mail from this sender's domain", group: "Search", defaultKeys: [], contexts: ["inboxList", "threadView"], fixed: false },

    // View
    { id: "focus-mode", title: "Toggle focus mode (hide Gmail sidebars)", group: "View", defaultKeys: ["Shift+Z"], contexts: DEFAULT_CONTEXTS, fixed: false },

    // Help
    { id: "shortcuts-help", title: "Show keyboard shortcuts", group: "Help", defaultKeys: ["?"], contexts: DEFAULT_CONTEXTS, fixed: false },
  ];

  function keysFor(id, overrides) {
    const ov = overrides || {};
    if (Object.prototype.hasOwnProperty.call(ov, id)) return ov[id] || [];
    const entry = commands.find((c) => c.id === id);
    return entry ? entry.defaultKeys.slice() : [];
  }

  function modLabel() {
    const nav = typeof navigator !== "undefined" ? navigator : null;
    const platform = String(
      (nav && nav.userAgentData && nav.userAgentData.platform) ||
        (nav && nav.platform) ||
        (nav && nav.userAgent) ||
        ""
    );
    return /mac|iphone|ipad|ipod/i.test(platform) ? "Cmd" : "Ctrl";
  }

  function displayKeyPart(part) {
    if (part === "Mod") return modLabel();
    if (part === "Escape") return "Esc";
    return part;
  }

  function displayBinding(binding) {
    return String(binding || "")
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part.split("+").map(displayKeyPart).join("+"))
      .join(" ");
  }

  // ---- Command palette hotkey ---------------------------------------------
  // Stored as storage.paletteHotkey in catalog token style ("Mod+K",
  // "Mod+Shift+P", "Alt+K"). Older builds stored lowercase "mod+k" / "mod+j" /
  // "mod+/"; normalizePaletteHotkey upgrades those on read. "Mod" matches Cmd
  // or Ctrl (as it always has), so the same setting works on Mac and Windows.
  const PALETTE_DEFAULT = "Mod+K";
  const MOD_ORDER = ["Mod", "Ctrl", "Alt", "Shift"];

  function normalizePaletteHotkey(value) {
    const raw = String(value || "").trim();
    if (!raw) return PALETTE_DEFAULT;
    // Split on "+" but keep a literal "+" key ("Mod++").
    const parts = raw.endsWith("++") ? raw.slice(0, -2).split("+").concat("+") : raw.split("+");
    const mods = new Set();
    let key = "";
    for (const p of parts) {
      const lower = p.toLowerCase();
      if (lower === "mod" || lower === "cmd" || lower === "meta") mods.add("Mod");
      else if (lower === "ctrl" || lower === "control") mods.add("Ctrl");
      else if (lower === "alt" || lower === "option") mods.add("Alt");
      else if (lower === "shift") mods.add("Shift");
      else key = p.length === 1 ? p.toUpperCase() : p;
    }
    if (!key) return PALETTE_DEFAULT;
    // Shift only counts for letters (a symbol already encodes it: "?" not "Shift+/").
    if (!/^[A-Z]$/.test(key)) mods.delete("Shift");
    return MOD_ORDER.filter((m) => mods.has(m)).concat(key).join("+");
  }

  // The physical key of a keydown, layout-stable: Option+K on a Mac reports
  // e.key "˚", so letters and digits come from e.code when it is present.
  function eventKey(e) {
    const code = String(e.code || "");
    let m = code.match(/^Key([A-Z])$/);
    if (m) return m[1];
    m = code.match(/^Digit(\d)$/);
    if (m) return m[1];
    const k = String(e.key || "");
    if (k === " ") return "Space";
    return k.length === 1 ? k.toUpperCase() : k;
  }

  // The binding a keydown would record as ("Mod+Shift+P"), or "" for a lone
  // modifier press. Used by the options recorder.
  function paletteBindingFromEvent(e) {
    const k = String(e.key || "");
    if (!k || k === "Shift" || k === "Control" || k === "Alt" || k === "Meta") return "";
    const mods = [];
    if (e.metaKey) mods.push("Mod");
    if (e.ctrlKey) mods.push(e.metaKey ? "Ctrl" : "Mod");
    if (e.altKey) mods.push("Alt");
    if (e.shiftKey) mods.push("Shift");
    return normalizePaletteHotkey(mods.concat(eventKey(e)).join("+"));
  }

  function matchesPaletteHotkey(e, binding) {
    const want = normalizePaletteHotkey(binding).split("+");
    const key = want.pop();
    if (eventKey(e) !== key) return false;
    const has = (m) => want.includes(m);
    const letter = /^[A-Z]$/.test(key);
    if (has("Mod")) {
      if (!(e.metaKey || e.ctrlKey)) return false;
    } else if (has("Ctrl")) {
      if (!e.ctrlKey || e.metaKey) return false;
    } else if (e.metaKey || e.ctrlKey) return false;
    if (has("Mod") && has("Ctrl") && !(e.metaKey && e.ctrlKey)) return false;
    if (!!e.altKey !== has("Alt")) return false;
    if (letter && !!e.shiftKey !== has("Shift")) return false;
    return true;
  }

  // Why a palette binding can't be used, or "" when it is fine. The palette
  // opens even while typing, so a bare key (or Shift+key) would eat text; the
  // editing and browser-owned keys would break typing or never reach the page.
  const RESERVED_PALETTE_KEYS = new Set([
    "Mod+A", "Mod+C", "Mod+V", "Mod+X", "Mod+Z", "Mod+Shift+Z", "Mod+Y",
    "Mod+T", "Mod+W", "Mod+N", "Mod+Q", "Mod+R", "Mod+L", "Mod+F", "Mod+P", "Mod+S",
    "Mod+Shift+T", "Mod+Shift+N", "Mod+Shift+W",
  ]);
  function paletteHotkeyProblem(binding, overrides) {
    const b = normalizePaletteHotkey(binding);
    const parts = b.split("+");
    if (!parts.some((p) => p === "Mod" || p === "Ctrl" || p === "Alt")) {
      return "Use Cmd, Ctrl or Option/Alt with a key, so typing never opens the palette.";
    }
    if (parts[parts.length - 1].length > 1 && !/^F\d+$/.test(parts[parts.length - 1]) && parts[parts.length - 1] !== "Space") {
      return "Pick a letter, number or symbol key.";
    }
    if (RESERVED_PALETTE_KEYS.has(b)) return displayBinding(b) + " is a browser or editing shortcut.";
    for (const cmd of commands) {
      if (keysFor(cmd.id, overrides).some((k) => normalizePaletteHotkey(k) === b)) {
        return displayBinding(b) + " is already used by " + cmd.title + ".";
      }
    }
    return "";
  }

  // True when the keydown is Cmd/Ctrl+K inside a rich-text editor that has
  // text selected: that is Gmail's (and Calendar's) "insert link" shortcut, so
  // the palette leaves it alone and the editor gets the real keystroke.
  function isEditorLinkShortcut(e, doc) {
    if (eventKey(e) !== "K" || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return false;
    const t = e.target;
    if (!t || t.nodeType !== 1 || typeof t.closest !== "function") return false;
    const editor = t.closest('[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]');
    if (!editor) return false;
    const d = doc || t.ownerDocument;
    const sel = d && d.getSelection ? d.getSelection() : null;
    if (!sel || sel.isCollapsed || !sel.rangeCount || !String(sel.toString()).trim()) return false;
    return editor.contains(sel.anchorNode) && editor.contains(sel.focusNode);
  }

  window.InboxKeys_KEYMAP = {
    DEFAULT_CONTEXTS, commands, keysFor, displayBinding, displayKeyPart, modLabel,
    PALETTE_DEFAULT, normalizePaletteHotkey, paletteBindingFromEvent, matchesPaletteHotkey,
    paletteHotkeyProblem, isEditorLinkShortcut,
  };
})();
