// Undo send: Mod+Z clicks Gmail's "Message sent" Undo, the countdown chip
// follows Gmail's snackbar, and the "Undo send window" rows drive Gmail's own
// Settings > General select. Real content scripts in jsdom, real keydowns.
const assert = require("node:assert/strict");
const { tryLoadContentScripts } = require("./helpers.js");

if (!tryLoadContentScripts("")) {
  console.log("undo send tests skipped (jsdom not installed — run: npm install)");
  process.exit(0);
}

const ACCOUNT = '<a aria-label="Google Account: Me (me@x.com)" href="#"></a>';
const LIST = `
  <div role="main"><div gh="tl"><table><tbody>
    <tr class="zA"><td><div role="checkbox" aria-checked="false"></div></td><td>Row</td></tr>
  </tbody></table></div></div>`;

// Gmail's send snackbar as it renders (span#link_undo next to the text).
const SENT_SNACKBAR = `
  <div class="vh"><span class="aT"><span class="bAq">Message sent</span>
    <span class="ag a8k" id="link_undo" role="link" tabindex="0">Undo</span>
    <span class="ag a8k" id="link_vsm" role="link" tabindex="0">View message</span></span></div>`;

function load(html, hash) {
  const w = tryLoadContentScripts(ACCOUNT + html);
  w.location.hash = hash || "#inbox";
  w.InboxKeys.hotkeys.install();
  w.__toasts = [];
  w.InboxKeys.toast = (msg) => w.__toasts.push(String(msg));
  return w;
}

function press(w, key, opts = {}) {
  const target = opts.target || w.document.activeElement || w.document.body;
  const event = new w.KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    metaKey: !!opts.metaKey,
    ctrlKey: !!opts.ctrlKey,
    shiftKey: !!opts.shiftKey,
  });
  target.dispatchEvent(event);
  return event;
}

function countClicks(w, el) {
  const rec = { n: 0 };
  el.addEventListener("click", () => rec.n++);
  return rec;
}

(async () => {
  // ---- catalog: Mod+Z is a fixed binding in the Compose group -------------
  {
    const w = load(LIST);
    const entry = w.InboxKeys_KEYMAP.commands.find((c) => c.id === "undo-send");
    assert.ok(entry, "undo-send is in the catalog");
    assert.deepEqual([...entry.defaultKeys], ["Mod+Z"]);
    assert.equal(entry.fixed, true, "engine-owned, read-only in settings");
    const sheet = w.InboxKeys.commands.cheatsheetSpec();
    const rows = sheet.sections.flatMap((s) => s.rows);
    assert.ok(rows.some((r) => r.label === "Undo send" && r.keys.includes("Mod+Z")), "cheat sheet lists Undo send");
  }

  // ---- Mod+Z clicks the send snackbar's Undo --------------------------------
  {
    const w = load(LIST + SENT_SNACKBAR);
    const clicks = countClicks(w, w.document.getElementById("link_undo"));
    const ev = press(w, "z", { metaKey: true });
    assert.equal(ev.defaultPrevented, true, "Mod+Z claimed outside text fields");
    assert.equal(clicks.n, 1, "Gmail's send Undo was clicked");
    assert.equal(w.__toasts.length, 0);
    // Ctrl+Z (Windows/Linux) does the same.
    press(w, "z", { ctrlKey: true });
    assert.equal(clicks.n, 2);
  }

  // ---- fallback: no #link_undo, but a "Message sent" snackbar with Undo -----
  {
    const w = load(LIST + '<div role="alert"><span>Message sent</span> <span role="link">Undo</span></div>');
    const undo = w.document.querySelector('[role="alert"] [role="link"]');
    const clicks = countClicks(w, undo);
    press(w, "z", { metaKey: true });
    assert.equal(clicks.n, 1, "structural fallback finds the send Undo");
  }

  // ---- an archive's Undo is NOT an undo send ---------------------------------
  {
    const w = load(LIST + '<div role="alert"><span>Conversation archived.</span> <span role="link">Undo</span></div>');
    const clicks = countClicks(w, w.document.querySelector('[role="alert"] [role="link"]'));
    press(w, "z", { metaKey: true });
    assert.equal(clicks.n, 0, "Mod+Z never undoes an archive");
    assert.ok(w.__toasts.some((t) => /undo window has closed/i.test(t)), "says the window has closed");
  }

  // ---- in a text field Mod+Z stays the editor's own undo ----------------------
  {
    const w = load(LIST + SENT_SNACKBAR + '<div role="dialog"><div aria-label="Message Body" contenteditable="true" role="textbox"></div></div>');
    const body = w.document.querySelector('[aria-label="Message Body"]');
    body.focus();
    const clicks = countClicks(w, w.document.getElementById("link_undo"));
    const ev = press(w, "z", { metaKey: true, target: body });
    assert.equal(ev.defaultPrevented, false, "editor keeps Cmd+Z");
    assert.equal(clicks.n, 0);
    // Shifted (redo) is never ours either.
    const redo = press(w, "z", { metaKey: true, shiftKey: true, target: w.document.body });
    assert.equal(redo.defaultPrevented, false);
  }

  // ---- palette row "Undo send" runs the same action ---------------------------
  {
    const w = load(LIST + SENT_SNACKBAR);
    const clicks = countClicks(w, w.document.getElementById("link_undo"));
    const row = w.InboxKeys.commands.all().find((c) => c.id === "undo-send");
    assert.ok(row && row.contexts.includes("inboxList") && row.contexts.includes("threadView"));
    row.run();
    assert.equal(clicks.n, 1);
  }

  // ---- countdown chip follows Gmail's snackbar -------------------------------
  {
    const w = load(LIST);
    const U = w.InboxKeys.undoSend;
    U.rememberWindow(10);
    assert.equal(U.windowSeconds(), 10);
    const chip = () => w.document.querySelector(".inboxkeys-undosend");
    U.tick(1000);
    assert.equal(chip(), null, "no chip without a send snackbar");

    w.document.body.insertAdjacentHTML("beforeend", SENT_SNACKBAR);
    U.tick(1000);
    assert.ok(chip(), "chip appears with the snackbar");
    assert.match(chip().textContent, /Sent · (Cmd|Ctrl)\+Z to undo · 10s/);
    U.tick(4200);
    assert.match(chip().textContent, / · 7s$/, "counts down");

    // Clicking the chip undoes the send.
    const clicks = countClicks(w, w.document.getElementById("link_undo"));
    chip().click();
    assert.equal(clicks.n, 1, "chip click clicks Gmail's Undo");
    assert.equal(chip(), null, "and closes");

    // Gmail keeps its Undo link up after the click: no fresh chip for it.
    U.tick(5000);
    assert.equal(chip(), null, "a spent snackbar never gets a second chip");
    w.document.querySelector(".vh").remove();
    U.tick(5100);
    w.document.body.insertAdjacentHTML("beforeend", SENT_SNACKBAR);
    U.tick(5200);
    assert.ok(chip(), "a new send gets a new chip");
    // Gmail drops the Undo: chip goes too.
    w.document.querySelector(".vh").remove();
    U.tick(5250);
    assert.equal(chip(), null, "chip closes with the snackbar");

    // Window elapsed: chip closes even if Gmail's snackbar lingers.
    w.document.body.insertAdjacentHTML("beforeend", SENT_SNACKBAR);
    U.tick(10000);
    assert.ok(chip());
    U.tick(20001);
    assert.equal(chip(), null, "chip closes when the window is over");
    // Live: Gmail kept #link_undo up ~17 s past a 20 s window, and the chip
    // used to restart at 20s. It must stay closed until the link goes.
    U.tick(20300);
    U.tick(30000);
    assert.equal(chip(), null, "no restart while Gmail's link lingers");
    w.document.querySelector(".vh").remove();
    U.tick(31000);
    w.document.body.insertAdjacentHTML("beforeend", SENT_SNACKBAR);
    U.tick(32000);
    assert.match(chip().textContent, / · 10s$/, "next send counts from the top");
    U.hideChip();
  }

  // ---- Gmail reuses #link_undo: only a SEND snackbar counts -----------------
  {
    // Verified live: "Draft discarded. Undo" uses the same span#link_undo.
    const DISCARD = `<div class="b8 UC bAp" role="alert" aria-live="assertive"><div class="J-J5-Ji"><div class="vh"><span class="aT"><span class="bAq">Draft discarded.</span><span class="bAo"><span id="link_undo" class="ag a8k" role="alert">Undo</span></span></span></div></div></div>`;
    const w = load(LIST + DISCARD);
    w.InboxKeys.undoSend.rememberWindow(20);
    w.InboxKeys.undoSend.tick(0);
    assert.equal(w.document.querySelector(".inboxkeys-undosend"), null, "no send chip after a discard");
    const clicks = countClicks(w, w.document.getElementById("link_undo"));
    press(w, "z", { metaKey: true });
    assert.equal(clicks.n, 0, "Cmd+Z never un-discards a draft");
    assert.ok(w.__toasts.some((t) => /undo window has closed/i.test(t)));
  }
  {
    // Phase 1 live: "Sending..." with the link reading "Cancel"; it still counts.
    const SENDING = `<div class="b8 UC bAp" role="alert" aria-live="assertive"><div class="J-J5-Ji"><div class="vh"><span class="aT"><span class="bAq">Sending...</span><span class="bAo"><span id="link_undo" class="ag a8k" role="alert">Cancel</span></span></span></div></div></div>`;
    const w = load(LIST + SENDING);
    w.InboxKeys.undoSend.tick(0);
    assert.ok(w.document.querySelector(".inboxkeys-undosend"), "chip from the first moment");
    const clicks = countClicks(w, w.document.getElementById("link_undo"));
    press(w, "z", { metaKey: true });
    assert.equal(clicks.n, 1, "Cmd+Z cancels while sending");
    w.InboxKeys.undoSend.hideChip();
  }

  // ---- the save toast survives Gmail's reload ----------------------------------
  {
    const w = load(LIST);
    w.sessionStorage.setItem("keyline:undoSendSaved", "20");
    w.InboxKeys.undoSend.showNote();
    assert.ok(w.__toasts.some((t) => /set to 20 seconds/.test(t)), "toast after the reload");
    assert.equal(w.sessionStorage.getItem("keyline:undoSendSaved"), null, "one-shot");
    w.InboxKeys.undoSend.showNote();
    assert.equal(w.__toasts.filter((t) => /set to 20/.test(t)).length, 1);
  }

  // ---- unknown window: chip without a number; disabled: no chip ---------------
  {
    const w = load(LIST + SENT_SNACKBAR);
    w.InboxKeys.undoSend.tick(0);
    const chip = w.document.querySelector(".inboxkeys-undosend");
    assert.match(chip.textContent, /^Sent · (Cmd|Ctrl)\+Z to undo$/);
    await w.InboxKeys.storage.set({ enabled: false });
    w.InboxKeys.undoSend.tick(100);
    assert.equal(w.document.querySelector(".inboxkeys-undosend"), null, "Keyline off: no chip");
  }

  // ---- Settings > General: learn the window, and set it -----------------------
  const SETTINGS = (value) => `
    <div role="main">
      <table><tr><td>Undo Send:</td><td>Send cancellation period:
        <select>
          ${[5, 10, 20, 30].map((n) => `<option value="${n}"${n === value ? " selected" : ""}>${n}</option>`).join("")}
        </select> seconds</td></tr>
        <tr><td><select><option value="1">1</option><option value="2">2</option></select></td></tr>
      </table>
      <button disabled>Save Changes</button><button>Cancel</button>
    </div>`;

  {
    // Visiting settings teaches the countdown the saved value.
    const w = load(SETTINGS(20), "#settings/general");
    w.InboxKeys.undoSend.tick(0);
    assert.equal(w.InboxKeys.undoSend.windowSeconds(), 20, "learned from Settings > General");
  }

  {
    const w = load(SETTINGS(10), "#inbox/FMfcgzQgMCZXKzQzpdVlZBPgJlsjMpsw");
    const sel = w.document.querySelector("select");
    const save = w.document.querySelector("button");
    let changes = 0;
    sel.addEventListener("change", () => {
      changes++;
      save.disabled = false; // Gmail enables Save Changes on a change
    });
    const saves = countClicks(w, save);
    const rows = w.InboxKeys.commands.all().filter((c) => /^undo-send-window:/.test(c.id));
    assert.deepEqual([...rows.map((r) => r.title)], [5, 10, 20, 30].map((n) => `Undo send window: ${n} seconds`));
    rows.find((r) => r.id === "undo-send-window:30").run();
    assert.equal(w.location.hash, "#settings/general", "opened Gmail's settings");
    assert.equal(sel.value, "30", "picked 30 in Gmail's own select");
    assert.equal(changes, 1, "fired change so Gmail notices");
    assert.equal(saves.n, 1, "clicked Save Changes");
    assert.equal(w.InboxKeys.undoSend.windowSeconds(), 30, "remembered for the countdown");
    assert.ok(w.__toasts.some((t) => /set to 30 seconds/.test(t)));
    assert.equal(w.sessionStorage.getItem("keyline:undoSendSaved"), "30", "note left for after Gmail's reload");
    // Now marked current in the palette.
    const cur = w.InboxKeys.commands.all().find((c) => c.id === "undo-send-window:30");
    assert.equal(cur.hint, "current");
    // Gmail stayed on settings: we go back to where the user was.
    await new Promise((r) => setTimeout(r, 1600));
    assert.equal(w.location.hash, "#inbox/FMfcgzQgMCZXKzQzpdVlZBPgJlsjMpsw", "returned to the conversation");
  }

  {
    // Already that value: no save, straight back.
    const w = load(SETTINGS(30), "#inbox");
    const saves = countClicks(w, w.document.querySelector("button"));
    w.InboxKeys.undoSend.setWindow(30);
    assert.equal(saves.n, 0, "nothing to save");
    assert.equal(w.location.hash, "#inbox");
    assert.ok(w.__toasts.some((t) => /already 30 seconds/.test(t)));
    assert.equal(w.InboxKeys.undoSend.setWindow(7), false, "only Gmail's choices");
  }

  {
    // Save Changes never enables: say so instead of silently doing nothing.
    const w = load(SETTINGS(5), "#inbox");
    w.InboxKeys.undoSend.setWindow(20);
    await new Promise((r) => setTimeout(r, 1400));
    assert.ok(w.__toasts.some((t) => /Gmail control not found: Save Changes/.test(t)), w.__toasts.join("|"));
  }

  {
    // No settings select at all.
    const w = load(LIST, "#inbox");
    w.InboxKeys.undoSend.setWindow(20);
    await new Promise((r) => setTimeout(r, 6300));
    assert.ok(w.__toasts.some((t) => /Gmail control not found: Undo Send setting/.test(t)));
  }

  // ---- storage: the learned window stays on this machine ----------------------
  {
    const fs = require("node:fs");
    const src = fs.readFileSync(require("node:path").join(__dirname, "../src/content/storage.js"), "utf8");
    assert.match(src, /LOCAL_ONLY = new Set\(\[[^\]]*"undoSendWindows"/);
  }

  console.log("undo send tests passed");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
