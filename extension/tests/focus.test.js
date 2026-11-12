// Focus mode (focus.js): Shift+Z hides Gmail's side panes by flipping one
// attribute on <html>; palette.css does the hiding. Real content scripts in
// jsdom, real keydown events, real outcomes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { tryLoadContentScripts } = require("./helpers.js");

if (!tryLoadContentScripts("")) {
  console.log("focus tests skipped (jsdom not installed — run: npm install)");
  process.exit(0);
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

const ID = "FMfcgzQgMCZXKzQzpdVlZBPgJlsjMpsw";
// Gmail's real layout (verified live Nov 2026): header, then one flex row of
// app rail (the only role=navigation), folder pane (no role), a zero-height
// overlay, the main column, and the side-panel rail.
const LIST = `
  <header id="gb" role="banner"><input aria-label="Search mail" name="q" /></header>
  <div class="row" id="row">
    <div id="rail" role="navigation"><div role="link" aria-label="Mail, 0 unread messages"></div></div>
    <div id="folders"><div role="button" class="T-I T-I-KE">Compose</div><a aria-label="Inbox" href="#inbox">Inbox</a></div>
    <div id="overlay"></div>
    <div id="col"><div class="nH"><div role="main"><div gh="tl"><table><tbody>
      <tr class="zA"><td><div role="checkbox" aria-checked="false"></div></td><td><span class="bog">hi</span></td></tr>
    </tbody></table></div></div></div></div>
    <div id="side"><div class="aUx"><div role="complementary" aria-label="Side panel"></div></div></div>
  </div>`;
const THREAD = LIST.replace(
  '<div role="main">',
  `<div role="main"><div role="listitem"><div class="gE"></div><div class="a3s" data-message-id="m1">body</div></div>`
);
const hidden = (w) => Array.from(w.document.querySelectorAll("[data-keyline-focus-hide]")).map((el) => el.id).sort();

async function load(html, hash, stored) {
  const w = tryLoadContentScripts(html);
  w.location.hash = hash || "#inbox";
  w.__set = [];
  w.chrome.storage.local.get = async () => ({ ...(stored || {}) });
  w.chrome.storage.local.set = async (patch) => { w.__set.push(patch); };
  w.__listeners = [];
  w.chrome.storage.onChanged.addListener = (fn) => w.__listeners.push(fn);
  await w.InboxKeys.storage.load();
  w.InboxKeys.focus.init(w.InboxKeys.storage);
  w.InboxKeys.hotkeys.install();
  w.__toasts = [];
  w.InboxKeys.toast = (msg) => w.__toasts.push(String(msg));
  return w;
}

function press(w, key, opts = {}) {
  const target = opts.target || w.document.activeElement || w.document.body;
  const e = new w.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, shiftKey: !!opts.shiftKey, metaKey: !!opts.metaKey });
  target.dispatchEvent(e);
  return e;
}

const on = (w) => w.document.documentElement.getAttribute("data-keyline-focus") === "on";
const pill = (w) => w.document.getElementById("keyline-focus-pill");

(async () => {
  // Shift+Z in the list turns focus mode on, persists, shows the exit pill.
  {
    const w = await load(LIST, "#inbox");
    assert.equal(on(w), false, "off by default");
    assert.equal(pill(w), null, "no pill while off");
    const e = press(w, "Z", { shiftKey: true });
    assert.equal(e.defaultPrevented, true, "Shift+Z is consumed");
    assert.equal(on(w), true, "Shift+Z turns focus mode on");
    assert.ok(pill(w), "pill shown while on");
    assert.match(pill(w).textContent, /Shift\+Z to exit/);
    assert.ok(w.__set.some((p) => p.focusMode === true), "state persisted");
    assert.deepEqual(w.__toasts, ["Focus mode on"]);
    assert.deepEqual(hidden(w), ["folders", "overlay", "rail", "side"], "every row pane but the main column is hidden");
    assert.equal(w.document.getElementById("col").hasAttribute("data-keyline-focus-hide"), false, "main column untouched");
    assert.equal(w.document.getElementById("gb").hasAttribute("data-keyline-focus-hide"), false, "header (search) untouched");

    // Clicking the pill exits.
    pill(w).click();
    assert.equal(on(w), false, "pill click exits");
    assert.equal(pill(w), null, "pill removed");
    assert.deepEqual(hidden(w), [], "panes unmarked on exit");
    assert.ok(w.__set.some((p) => p.focusMode === false), "off persisted");
  }

  // Works in an open conversation, and toggles back off with the same key.
  {
    const w = await load(THREAD, "#inbox/" + ID);
    assert.equal(w.InboxKeys.gmail.getContext(), "threadView");
    press(w, "Z", { shiftKey: true });
    assert.equal(on(w), true, "on in threadView");
    assert.deepEqual(hidden(w), ["folders", "overlay", "rail", "side"], "same panes hidden in a thread");
    press(w, "Z", { shiftKey: true });
    assert.equal(on(w), false, "Shift+Z again turns it off");
    assert.deepEqual(w.__toasts, ["Focus mode on", "Focus mode off"]);
  }

  // Typing a capital Z in an editor never toggles it.
  {
    const w = await load(LIST + '<div contenteditable="true" role="textbox" aria-label="Message Body" id="ed"></div>', "#inbox");
    const ed = w.document.getElementById("ed");
    ed.focus();
    const e = press(w, "Z", { shiftKey: true, target: ed });
    assert.equal(e.defaultPrevented, false, "typing Z is left alone");
    assert.equal(on(w), false);
  }

  // Plain z is still Undo, not focus mode.
  {
    const w = await load(LIST, "#inbox");
    press(w, "z");
    assert.equal(on(w), false, "lowercase z does not toggle focus");
  }

  // A saved "on" comes back on load (reload / new tab / other machine).
  {
    const w = await load(LIST, "#inbox", { focusMode: true });
    assert.equal(on(w), true, "restored from storage");
    assert.ok(pill(w), "pill restored");
  }

  // A change from another tab applies live.
  {
    const w = await load(LIST, "#inbox");
    for (const fn of w.__listeners) fn({ focusMode: { oldValue: false, newValue: true } }, "local");
    assert.equal(on(w), true, "storage change applies");
    for (const fn of w.__listeners) fn({ focusMode: { oldValue: true, newValue: false } }, "local");
    assert.equal(on(w), false);
  }

  // Remapped key: the pill names the new key, the default no longer fires.
  {
    const w = await load(LIST, "#inbox", { keyOverrides: { "focus-mode": ["g z"] } });
    press(w, "Z", { shiftKey: true });
    assert.equal(on(w), false, "default key gone after remap");
    press(w, "g");
    press(w, "z");
    assert.equal(on(w), true, "remapped chord works");
    assert.match(pill(w).textContent, /g z to exit/);
  }

  // Gmail re-renders a pane: the next navigation re-marks it.
  {
    const w = await load(LIST, "#inbox");
    press(w, "Z", { shiftKey: true });
    const fresh = w.document.createElement("div");
    fresh.id = "folders2";
    w.document.getElementById("folders").replaceWith(fresh);
    await tick(); // the row observer fires
    assert.deepEqual(hidden(w), ["folders2", "overlay", "rail", "side"], "re-rendered pane re-marked");
    w.InboxKeys.focus.set(false);
  }

  // Unknown layout (no landmark outside main): hide nothing rather than guess.
  {
    const w = await load('<div><div role="main"><div gh="tl"></div></div><div id="x"></div></div>', "#inbox");
    press(w, "Z", { shiftKey: true });
    assert.equal(on(w), true);
    assert.deepEqual(hidden(w), [], "no guessing without a landmark");
    w.InboxKeys.focus.set(false);
  }

  // Palette row and cheat sheet entry.
  {
    const w = await load(LIST, "#inbox");
    const all = w.InboxKeys.commands.all ? w.InboxKeys.commands.all() : w.InboxKeys.commands.list();
    const row = all.find((c) => c.id === "focus-mode");
    assert.ok(row, "palette has the focus mode row");
    assert.deepEqual([...row.keys], ["Shift+Z"]);
    row.run();
    assert.equal(on(w), true, "palette row toggles");
  }

  // CSS: every rule lives under the attribute, hides only Gmail chrome, never
  // touches the main pane, and reads only --ik-* tokens (no hex).
  {
    const css = fs.readFileSync(path.join(__dirname, "..", "src/content/palette.css"), "utf8");
    const start = css.indexOf("/* ---- Focus mode ---- */");
    assert.ok(start >= 0, "focus mode block present");
    const end = css.indexOf("/* ---- ", start + 10);
    const block = css.slice(start, end < 0 ? undefined : end);
    const selectors = block.replace(/\/\*[\s\S]*?\*\//g, "").match(/[^{}]+(?=\{)/g).flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
    for (const s of selectors) {
      if (s.startsWith(".keyline-focus-pill")) continue;
      assert.ok(s.startsWith('html[data-keyline-focus="on"]'), "scoped to the attribute: " + s);
      assert.ok(!/role="main"\]\s*$/.test(s), "never hides the main pane: " + s);
    }
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(block), "no hex colors in focus css");
  }

  console.log("focus tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
