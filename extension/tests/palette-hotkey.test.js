// The command palette hotkey: remappable in settings, and Cmd+K over selected
// text in the email editor stays Gmail's insert-link shortcut. Pure checks of
// the shared matcher (keymap.js), then the real content scripts in jsdom
// (Gmail and Calendar), then the real options page recorder.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { tryLoadContentScripts, tryLoadGcalUi } = require("./helpers.js");

// ---- keymap.js helpers (no DOM needed) -------------------------------------
const vm = require("node:vm");
const sandbox = { window: {}, navigator: { platform: "MacIntel" } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/shared/keymap.js"), "utf8"), sandbox);
const KM = sandbox.window.InboxKeys_KEYMAP;
const ev = (o) => Object.assign({ key: "", code: "", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }, o);

// Legacy lowercase values from older builds upgrade cleanly.
assert.equal(KM.normalizePaletteHotkey("mod+k"), "Mod+K");
assert.equal(KM.normalizePaletteHotkey("mod+j"), "Mod+J");
assert.equal(KM.normalizePaletteHotkey("mod+/"), "Mod+/");
assert.equal(KM.normalizePaletteHotkey(""), "Mod+K");
assert.equal(KM.normalizePaletteHotkey(undefined), "Mod+K");
assert.equal(KM.normalizePaletteHotkey("shift+mod+p"), "Mod+Shift+P", "modifier order is canonical");
assert.equal(KM.normalizePaletteHotkey("Mod+Shift+/"), "Mod+/", "Shift is dropped for symbols");

// Matching.
assert.equal(KM.matchesPaletteHotkey(ev({ key: "k", code: "KeyK", metaKey: true }), "Mod+K"), true, "Cmd+K");
assert.equal(KM.matchesPaletteHotkey(ev({ key: "k", code: "KeyK", ctrlKey: true }), "Mod+K"), true, "Ctrl+K counts as Mod+K");
assert.equal(KM.matchesPaletteHotkey(ev({ key: "K", code: "KeyK", metaKey: true, shiftKey: true }), "Mod+K"), false, "Cmd+Shift+K is not Cmd+K");
assert.equal(KM.matchesPaletteHotkey(ev({ key: "k", code: "KeyK" }), "Mod+K"), false, "bare k never opens it");
assert.equal(KM.matchesPaletteHotkey(ev({ key: "P", code: "KeyP", metaKey: true, shiftKey: true }), "Mod+Shift+P"), true);
assert.equal(KM.matchesPaletteHotkey(ev({ key: "p", code: "KeyP", metaKey: true }), "Mod+Shift+P"), false);
assert.equal(KM.matchesPaletteHotkey(ev({ key: "˚", code: "KeyK", altKey: true }), "Alt+K"), true, "Option+K on a Mac reports ˚; the code still matches");
assert.equal(KM.matchesPaletteHotkey(ev({ key: "˚", code: "KeyK", altKey: true, metaKey: true }), "Alt+K"), false, "extra Cmd rejects Alt+K");
assert.equal(KM.matchesPaletteHotkey(ev({ key: "/", code: "Slash", metaKey: true }), "mod+/"), true, "legacy mod+/ still works");
assert.equal(KM.matchesPaletteHotkey(ev({ key: "j", code: "KeyJ", metaKey: true }), "mod+j"), true, "legacy mod+j still works");

// Recording.
assert.equal(KM.paletteBindingFromEvent(ev({ key: "p", code: "KeyP", metaKey: true, shiftKey: true })), "Mod+Shift+P");
assert.equal(KM.paletteBindingFromEvent(ev({ key: "Meta", code: "MetaLeft", metaKey: true })), "", "lone modifier records nothing");
assert.equal(KM.paletteBindingFromEvent(ev({ key: "˚", code: "KeyK", altKey: true })), "Alt+K");

// Validation.
assert.equal(KM.paletteHotkeyProblem("Mod+Shift+P", {}), "");
assert.equal(KM.paletteHotkeyProblem("Alt+K", {}), "");
assert.match(KM.paletteHotkeyProblem("P", {}), /Cmd, Ctrl or Option/, "a bare key would eat typing");
assert.match(KM.paletteHotkeyProblem("Shift+P", {}), /Cmd, Ctrl or Option/);
assert.match(KM.paletteHotkeyProblem("Mod+C", {}), /browser or editing/, "Cmd+C is reserved");
assert.match(KM.paletteHotkeyProblem("Mod+W", {}), /browser or editing/);
assert.match(KM.paletteHotkeyProblem("Mod+O", {}), /Open link or attachment/, "collides with a Keyline command");
assert.match(KM.paletteHotkeyProblem("Mod+Escape", {}), /letter, number or symbol/);

if (!tryLoadContentScripts("")) {
  console.log("palette hotkey unit tests passed (jsdom tests skipped — run: npm install)");
  process.exit(0);
}

// ---- Gmail: the real engine ------------------------------------------------
const BODY = '<div role="main"><div aria-label="Message Body" g_editable="true" contenteditable="true" role="textbox" id="body">Read the spec here</div></div>';

function load(html) {
  const w = tryLoadContentScripts(html);
  w.location.hash = "#inbox";
  w.InboxKeys.hotkeys.install();
  w.InboxKeys.toast = () => {};
  return w;
}

function press(w, key, opts = {}) {
  const target = opts.target || w.document.activeElement || w.document.body;
  const e = new w.KeyboardEvent("keydown", {
    key,
    code: opts.code || (/^[a-z]$/i.test(key) ? "Key" + key.toUpperCase() : ""),
    bubbles: true,
    cancelable: true,
    metaKey: !!opts.metaKey,
    ctrlKey: !!opts.ctrlKey,
    altKey: !!opts.altKey,
    shiftKey: !!opts.shiftKey,
  });
  target.dispatchEvent(e);
  return e;
}

function selectText(w, el) {
  const range = w.document.createRange();
  range.selectNodeContents(el);
  const sel = w.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// Cmd+K with text selected in the email editor → Gmail's insert link.
{
  const w = load(BODY);
  const body = w.document.getElementById("body");
  body.focus();
  selectText(w, body);
  const e = press(w, "k", { target: body, metaKey: true });
  assert.equal(e.defaultPrevented, false, "Cmd+K over a selection is left for Gmail's insert-link");
  assert.equal(w.InboxKeys.palette.isOpen(), false, "palette stays closed");
}

// Cmd+K in the editor with no selection still opens the palette.
{
  const w = load(BODY);
  const body = w.document.getElementById("body");
  body.focus();
  w.getSelection().removeAllRanges();
  const e = press(w, "k", { target: body, metaKey: true });
  assert.equal(e.defaultPrevented, true, "Cmd+K with just a caret opens the palette");
  assert.equal(w.InboxKeys.palette.isOpen(), true);
}

// A selection OUTSIDE the editor (e.g. in a read message) doesn't count.
{
  const w = load(BODY + '<div class="a3s" id="msg">Some quoted text</div>');
  selectText(w, w.document.getElementById("msg"));
  const e = press(w, "k", { target: w.document.body, metaKey: true });
  assert.equal(e.defaultPrevented, true, "selected text in a read message doesn't block the palette");
  assert.equal(w.InboxKeys.palette.isOpen(), true);
}

// Palette open + selection: Cmd+K still closes the palette (it owns the keyboard).
{
  const w = load(BODY);
  press(w, "k", { target: w.document.body, metaKey: true });
  assert.equal(w.InboxKeys.palette.isOpen(), true);
  const body = w.document.getElementById("body");
  selectText(w, body);
  const e = press(w, "k", { target: body, metaKey: true });
  assert.equal(e.defaultPrevented, true);
  assert.equal(w.InboxKeys.palette.isOpen(), false, "Cmd+K toggles the open palette closed");
}

// Remapped: Cmd+K is fully Gmail's again; the new key opens the palette, even while typing.
{
  const w = load(BODY);
  w.InboxKeys.storage.cache.paletteHotkey = "Mod+Shift+P";
  const body = w.document.getElementById("body");
  body.focus();
  w.getSelection().removeAllRanges();
  const k = press(w, "k", { target: body, metaKey: true });
  assert.equal(k.defaultPrevented, false, "Cmd+K untouched once remapped");
  assert.equal(w.InboxKeys.palette.isOpen(), false);
  const p = press(w, "P", { target: body, metaKey: true, shiftKey: true });
  assert.equal(p.defaultPrevented, true, "Cmd+Shift+P claimed");
  assert.equal(w.InboxKeys.palette.isOpen(), true, "new key opens the palette from the editor");
  assert.match(w.document.querySelector(".inboxkeys-prompt").textContent, /(Cmd|Ctrl)\+Shift\+P/, "palette shows the remapped key");
}

// Option+K (Mac reports "˚") works when chosen.
{
  const w = load("");
  w.InboxKeys.storage.cache.paletteHotkey = "Alt+K";
  press(w, "˚", { target: w.document.body, altKey: true, code: "KeyK" });
  assert.equal(w.InboxKeys.palette.isOpen(), true, "Option+K opens the palette");
}

// Legacy stored value from the old dropdown keeps working.
{
  const w = load("");
  w.InboxKeys.storage.cache.paletteHotkey = "mod+j";
  press(w, "j", { target: w.document.body, metaKey: true });
  assert.equal(w.InboxKeys.palette.isOpen(), true, "legacy mod+j opens the palette");
}

// ? cheat sheet shows the current palette key.
{
  const w = load("");
  w.InboxKeys.storage.cache.paletteHotkey = "Mod+Shift+P";
  press(w, "?", { target: w.document.body, shiftKey: true });
  const sheet = w.document.querySelector(".inboxkeys-cheatsheet");
  assert.ok(sheet, "cheat sheet open");
  assert.match(sheet.textContent, /Cmd\+Shift\+P|Ctrl\+Shift\+P/, "cheat sheet lists the remapped palette key");
}

// ---- Calendar ------------------------------------------------------------
{
  const w = tryLoadGcalUi('<div contenteditable="true" id="desc">Event notes link</div>');
  const ui = w.InboxKeys.gcalui;
  const cev = (key, extra = {}) =>
    Object.assign(
      { key, code: /^[a-z]$/i.test(key) ? "Key" + key.toUpperCase() : "", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, target: w.document.body, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() {}, stopPropagation() {} },
      extra
    );
  const overlayOpen = () => !!w.document.querySelector(".inboxkeys-gcal-overlay");

  const desc = w.document.getElementById("desc");
  selectText(w, desc);
  const e1 = cev("k", { metaKey: true, target: desc });
  ui.onKeydown(e1);
  assert.equal(e1.defaultPrevented, false, "Calendar: Cmd+K over selected description text is left to the editor");
  assert.equal(overlayOpen(), false);

  w.getSelection().removeAllRanges();
  w.InboxKeys.storage.cache.paletteHotkey = "Mod+Shift+P";
  const e2 = cev("k", { metaKey: true });
  ui.onKeydown(e2);
  assert.equal(e2.defaultPrevented, false, "Calendar: Cmd+K untouched once remapped");
  const e3 = cev("P", { metaKey: true, shiftKey: true });
  ui.onKeydown(e3);
  assert.equal(e3.defaultPrevented, true, "Calendar: remapped key claimed");
  assert.equal(overlayOpen(), true, "Calendar: remapped key opens the overlay");
}

// ---- Options page recorder ---------------------------------------------------
{
  const { JSDOM } = require("jsdom");
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "src/options/options.html"), "utf8").replace(/<script[^>]*><\/script>/g, "");
  const dom = new JSDOM(html, { url: "chrome-extension://x/src/options/options.html", runScripts: "outside-only" });
  const w = dom.window;
  const store = { paletteHotkey: "mod+k" };
  // Settings sync: the palette key lives in chrome.storage.sync like other settings.
  const local = {};
  const pick = (obj, keys) => {
    const out = {};
    for (const k of [].concat(keys || Object.keys(obj))) if (k in obj) out[k] = obj[k];
    return out;
  };
  w.chrome = {
    storage: {
      local: { get: async (k) => pick(local, k), set: async (p) => Object.assign(local, p) },
      sync: { QUOTA_BYTES_PER_ITEM: 8192, get: async (k) => pick(store, k), set: async (p) => Object.assign(store, p) },
      onChanged: { addListener() {} },
    },
  };
  local.syncMigrated = true;
  w.eval(fs.readFileSync(path.join(root, "src/shared/keymap.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(root, "src/content/storage.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(root, "src/options/options.js"), "utf8"));

  const cell = w.document.getElementById("paletteHotkeyCell");
  const key = (k, o = {}) =>
    w.dispatchEvent(new w.KeyboardEvent("keydown", { key: k, code: o.code || (/^[a-z]$/i.test(k) ? "Key" + k.toUpperCase() : ""), bubbles: true, cancelable: true, metaKey: !!o.metaKey, ctrlKey: !!o.ctrlKey, altKey: !!o.altKey, shiftKey: !!o.shiftKey }));

  (async () => {
    await new Promise((r) => setTimeout(r, 10));
    assert.match(cell.textContent, /(Cmd|Ctrl)\+K/, "options shows the legacy value as Cmd+K");
    assert.equal(w.document.getElementById("paletteHotkeyReset").disabled, true, "reset disabled at default");

    // A bare key is refused with a reason; nothing saved.
    cell.click();
    key("p");
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(store.paletteHotkey, "mod+k", "bare key not saved");
    assert.match(w.document.getElementById("paletteHotkeyHint").textContent, /Cmd, Ctrl or Option/);

    // Reserved and colliding keys refused.
    cell.click();
    key("c", { metaKey: true });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(store.paletteHotkey, "mod+k", "Cmd+C not saved");
    cell.click();
    key("o", { metaKey: true });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(store.paletteHotkey, "mod+k", "Cmd+O (Open link) not saved");

    // A lone modifier keeps listening; the full combo saves.
    cell.click();
    key("Meta", { metaKey: true, code: "MetaLeft" });
    key("Shift", { metaKey: true, shiftKey: true, code: "ShiftLeft" });
    key("P", { metaKey: true, shiftKey: true });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(store.paletteHotkey, "Mod+Shift+P", "Cmd+Shift+P saved");
    assert.match(cell.textContent, /(Cmd|Ctrl)\+Shift\+P/);
    assert.equal(w.document.getElementById("paletteHotkeyReset").disabled, false);

    // Escape cancels without saving.
    cell.click();
    key("Escape", { code: "Escape" });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(store.paletteHotkey, "Mod+Shift+P");

    // Reset returns to Cmd+K.
    w.document.getElementById("paletteHotkeyReset").click();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(store.paletteHotkey, "Mod+K", "reset restores Cmd+K");

    console.log("palette hotkey tests passed");
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
