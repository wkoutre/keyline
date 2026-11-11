// Snooze and schedule-send presets, end to end over the real content scripts.
// Fixtures mirror Gmail's DOM as mapped live (Nov 2026): the Snooze toolbar
// button opens [role=menu][aria-label="Snooze menu"] whose last item is
// "Pick date & time"; compose's "More send options" caret opens a menu with
// "Schedule send", which opens [role=dialog][aria-label="Schedule send"] with
// its own "Pick date & time"; both end in ONE dialog with text inputs
// aria-label Date / Time and an unlabeled confirm button ("Save" /
// "Schedule send") that never disables, so validity lives in aria-invalid.
const assert = require("node:assert/strict");
const { tryLoadContentScripts } = require("./helpers");
const WHEN = require("../src/shared/when.js");

const ID = "FMfcgzQgMCZXKzQzpdVlZBPgJlsjMpsw";
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

function load(html, hash) {
  const w = tryLoadContentScripts(html);
  if (!w) return null;
  w.location.hash = hash || "#inbox";
  w.InboxKeys.hotkeys.install();
  w.__toasts = [];
  w.InboxKeys.toast = (msg) => w.__toasts.push(String(msg));
  w.__log = [];
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
    altKey: !!opts.altKey,
    shiftKey: !!opts.shiftKey,
  });
  target.dispatchEvent(event);
  return event;
}

function add(w, html) {
  const host = w.document.createElement("div");
  host.innerHTML = html;
  const el = host.firstElementChild;
  w.document.body.appendChild(el);
  return el;
}

// The shared "Pick date & time" dialog. `rejects(value)` marks an input
// aria-invalid on change, like Gmail does for a past or unreadable value.
function dateTimeDialog(w, confirmText, rejects) {
  const dlg = add(
    w,
    `<div role="dialog" aria-modal="true" class="uW2Fw-bHo"><h2>Pick date &amp; time</h2>
       <input type="text" aria-label="Date" value="Nov 11, 2026">
       <input type="text" aria-label="Time" value="8:00 AM">
       <button class="Rb6pkf">Cancel</button><button class="eV8l8d">${confirmText}</button>
     </div>`
  );
  for (const input of dlg.querySelectorAll("input")) {
    input.addEventListener("change", () => {
      input.setAttribute("aria-invalid", rejects && rejects(input.value) ? "true" : "false");
      w.__log.push(input.getAttribute("aria-label") + "=" + input.value);
    });
  }
  dlg.querySelector(".eV8l8d").addEventListener("click", () => {
    w.__log.push("confirm:" + confirmText);
    dlg.remove();
  });
  dlg.querySelector(".Rb6pkf").addEventListener("click", () => {
    w.__log.push("cancel");
    dlg.remove();
  });
  return dlg;
}

function wireSnooze(w, opts = {}) {
  const btn = w.document.querySelector('[aria-label="Snooze"]');
  btn.addEventListener("click", () => {
    w.__log.push("snooze-button");
    const menu = add(
      w,
      `<div role="menu" aria-label="Snooze menu"><div>Snooze until…</div>
         <div role="menuitem" class="J-N"><span class="bsK">Later today</span><span class="brz">Wed, 7:00 PM</span></div>
         <div role="menuitem" class="J-N"><span class="bsK">Tomorrow</span><span class="brz">Thu, 8:00 AM</span></div>
         <div role="menuitem" class="J-N" id="pick"><span class="bsK">Pick date &amp; time</span></div>
       </div>`
    );
    menu.querySelector("#pick").addEventListener("click", () => {
      w.__log.push("pick-date-time");
      menu.remove();
      dateTimeDialog(w, "Save", opts.rejects);
    });
  });
}

function threadHtml() {
  return `<div role="main">
      <div gh="tm"><div role="button" aria-label="Snooze" data-tooltip="Snooze"></div></div>
      <div role="listitem"><div class="gE">h</div><div class="a3s" data-message-id="m1">body</div></div>
    </div>`;
}

function pick(w, id) {
  const row = w.InboxKeys.palette.current().find((r) => r.id === id);
  assert.ok(row, "picker row " + id + " is listed");
  w.InboxKeys.palette.hide();
  row.run();
  return row;
}

function typeInto(w, text) {
  const input = w.document.querySelector(".inboxkeys-input");
  input.value = text;
  input.dispatchEvent(new w.Event("input", { bubbles: true }));
}

(async () => {
  const probe = load("");
  if (!probe) {
    console.log("later tests skipped (jsdom not installed)");
    return;
  }

  // ---- h in a thread: presets listed, nothing touched until a pick ----
  {
    const w = load(threadHtml(), "#inbox/" + ID);
    wireSnooze(w);
    const e = press(w, "h", { target: w.document.body });
    assert.equal(e.defaultPrevented, true, "h is claimed");
    assert.equal(w.InboxKeys.palette.isOpen(), true, "h opens the snooze picker");
    const ids = w.InboxKeys.palette.current().map((r) => r.id);
    assert.ok(ids.includes("later-tomorrow"), "tomorrow morning preset");
    assert.ok(ids.includes("later-monday"), "Monday preset");
    assert.equal(ids[ids.length - 1], "later-native-snooze", "Gmail's own menu is the last row");
    assert.deepEqual(w.__log, [], "Gmail is not touched while the picker is open");

    // A preset drives Snooze → Pick date & time → Date/Time → Save.
    const row = pick(w, "later-tomorrow");
    const when = WHEN.presets(new Date(), "snooze").find((p) => p.id === "tomorrow").when;
    assert.deepEqual(w.__log, [
      "snooze-button",
      "pick-date-time",
      "Date=" + WHEN.gmailDate(when),
      "Time=8:00 AM",
      "confirm:Save",
    ]);
    assert.ok(w.__toasts.some((t) => /^Snoozed until /.test(t)), "confirms what it did");
    assert.ok(row.hint && /8:00 AM/.test(row.hint), "the preset row shows its exact time");
  }

  // ---- a typed time: "fri 3pm" becomes the top row and is what gets entered ----
  {
    const w = load(threadHtml(), "#inbox/" + ID);
    wireSnooze(w);
    press(w, "h", { target: w.document.body });
    typeInto(w, "fri 3pm");
    const top = w.InboxKeys.palette.current()[0];
    assert.equal(top.id, "later-typed", "the parsed time leads the list");
    assert.match(top.title, /^Snooze until Fri, .* 3:00 PM$/);
    press(w, "Enter", { target: w.document.querySelector(".inboxkeys-input") });
    await tick(60); // palette.run defers the command 30ms
    const fri = WHEN.parse("fri 3pm");
    assert.ok(w.__log.includes("Date=" + WHEN.gmailDate(fri)), "Friday's date is entered");
    assert.ok(w.__log.includes("Time=3:00 PM"), "3:00 PM is entered");
    assert.equal(w.__log[w.__log.length - 1], "confirm:Save");
  }

  // ---- unreadable text says so instead of guessing; a preset prefix still filters ----
  {
    const w = load(threadHtml(), "#inbox/" + ID);
    wireSnooze(w);
    press(w, "h", { target: w.document.body });
    typeInto(w, "potato");
    const rows = w.InboxKeys.palette.current();
    assert.equal(rows[0].id, "later-unparsed", "unreadable text gets an explicit row");
    rows[0].run();
    assert.ok(w.__toasts.some((t) => /Couldn't read "potato"/.test(t)));
    assert.deepEqual(w.__log, [], "nothing is snoozed");
    typeInto(w, "mon");
    const ids = w.InboxKeys.palette.current().map((r) => r.id);
    assert.equal(ids[0], "later-typed", "'mon' parses as Monday");
    assert.ok(ids.includes("later-monday"), "and still matches the Monday preset");
    w.InboxKeys.palette.hide();
  }

  // ---- Gmail rejects the value: cancel the dialog and say so, never Save ----
  {
    const w = load(threadHtml(), "#inbox/" + ID);
    wireSnooze(w, { rejects: (v) => /AM|PM/.test(v) });
    press(w, "h", { target: w.document.body });
    pick(w, "later-tomorrow");
    await tick(500);
    assert.ok(!w.__log.includes("confirm:Save"), "an invalid value is never confirmed");
    assert.equal(w.__log[w.__log.length - 1], "cancel", "the half-filled dialog is cancelled");
    assert.ok(w.__toasts.some((t) => /^Gmail rejected /.test(t)), "and the user is told");
  }

  // ---- h on the list snoozes the cursor row, via the same dialog ----
  {
    const w = load(
      `<div role="main">
        <div gh="tm"><div role="button" aria-label="Snooze" data-tooltip="Snooze"></div></div>
        <div gh="tl"><table><tbody>
          <tr class="zA" data-row="one"><td><div role="checkbox" aria-checked="false"></div></td><td><span class="bog">one</span></td></tr>
          <tr class="zA" data-row="two"><td><div role="checkbox" aria-checked="false"></div></td><td><span class="bog">two</span></td></tr>
        </tbody></table></div>
      </div>`,
      "#inbox"
    );
    for (const cb of w.document.querySelectorAll('[role="checkbox"]')) {
      cb.addEventListener("click", () => cb.setAttribute("aria-checked", cb.getAttribute("aria-checked") === "true" ? "false" : "true"));
    }
    wireSnooze(w);
    w.document.querySelector('[aria-label="Snooze"]').addEventListener("click", () => {
      w.__selected = Array.from(w.document.querySelectorAll("tr.zA"))
        .filter((r) => r.querySelector('[role="checkbox"]').getAttribute("aria-checked") === "true")
        .map((r) => r.getAttribute("data-row"));
    });
    press(w, "j", { target: w.document.body });
    press(w, "h", { target: w.document.body });
    assert.deepEqual(w.__log, [], "the row is not selected until a time is picked");
    pick(w, "later-monday");
    assert.deepEqual(w.__selected, ["two"], "the cursor row is what Gmail snoozes");
    assert.equal(w.__log[w.__log.length - 1], "confirm:Save");
  }

  // ---- Mod+Shift+Enter in a draft schedules THAT draft ----
  function composeHtml() {
    return `<div role="main"><div gh="tl"></div></div>
      <div role="dialog" class="M9" id="draft">
        <input aria-label="To" value="a@example.com">
        <div aria-label="Message Body" contenteditable="true" g_editable="true">hi</div>
        <div role="button" aria-label="Send">Send</div>
        <div role="button" aria-label="More send options" aria-haspopup="true" id="caret"></div>
      </div>`;
  }
  function wireSchedule(w, opts = {}) {
    w.document.querySelector("#caret").addEventListener("click", () => {
      w.__log.push("send-options");
      const menu = add(w, `<div role="menu" id="sbddm"><div role="menuitem" class="J-N" id="sched">Schedule send</div></div>`);
      menu.querySelector("#sched").addEventListener("click", () => {
        w.__log.push("schedule-send");
        menu.remove();
        if (opts.noRecipient) {
          add(w, `<div role="alertdialog">Please specify at least one recipient.</div>`);
          return;
        }
        const dlg = add(
          w,
          `<div role="dialog" aria-label="Schedule send"><div>Pacific Standard Time</div>
             <div role="menuitem" class="Az"><div class="Aj">Tomorrow morning</div><div class="Ay">Nov 12, 8:00 AM</div></div>
             <div role="menuitem" class="Az AM" id="pick">Pick date &amp; time</div>
           </div>`
        );
        dlg.querySelector("#pick").addEventListener("click", () => {
          w.__log.push("pick-date-time");
          dlg.remove();
          dateTimeDialog(w, "Schedule send");
        });
      });
    });
  }
  {
    const w = load(composeHtml(), "#inbox");
    wireSchedule(w);
    const body = w.document.querySelector('[aria-label="Message Body"]');
    body.focus();
    assert.equal(w.InboxKeys.gmail.composeScope(), w.document.querySelector("#draft"), "the focused draft owns the caret");
    const e = press(w, "Enter", { target: body, metaKey: true, shiftKey: true });
    assert.equal(e.defaultPrevented, true, "Mod+Shift+Enter is claimed in compose");
    assert.equal(w.InboxKeys.palette.isOpen(), true, "opens the schedule picker");
    const ids = w.InboxKeys.palette.current().map((r) => r.id);
    assert.ok(ids.includes("later-tomorrow-afternoon"), "send presets include tomorrow afternoon");
    assert.ok(!ids.includes("later-weekend"), "nobody schedules mail for Saturday 8 AM");
    typeInto(w, "dec 3 9:30am");
    pick(w, "later-typed");
    assert.deepEqual(w.__log, [
      "send-options",
      "schedule-send",
      "pick-date-time",
      "Date=Dec 3, " + WHEN.parse("dec 3").getFullYear(),
      "Time=9:30 AM",
      "confirm:Schedule send",
    ]);
    assert.ok(w.__toasts.some((t) => /^Scheduled for /.test(t)));
  }

  // ---- no recipient: Gmail's own alert stands, we stop ----
  {
    const w = load(composeHtml(), "#inbox");
    wireSchedule(w, { noRecipient: true });
    w.document.querySelector('[aria-label="Message Body"]').focus();
    press(w, "Enter", { target: w.document.activeElement, metaKey: true, shiftKey: true });
    pick(w, "later-tomorrow");
    assert.deepEqual(w.__log, ["send-options", "schedule-send"], "stops at Gmail's recipient alert");
    assert.ok(!w.__toasts.some((t) => /not found/.test(t)), "no false 'control not found'");
  }

  // ---- the native row only opens Gmail's Schedule send dialog ----
  {
    const w = load(composeHtml(), "#inbox");
    wireSchedule(w);
    w.document.querySelector('[aria-label="Message Body"]').focus();
    press(w, "Enter", { target: w.document.activeElement, metaKey: true, shiftKey: true });
    pick(w, "later-native-send");
    assert.deepEqual(w.__log, ["send-options", "schedule-send"]);
    assert.ok(w.document.querySelector('[aria-label="Schedule send"][role="dialog"]'), "Gmail's dialog is left open for the user");
  }

  // ---- no draft open: say so ----
  {
    const w = load(threadHtml(), "#inbox/" + ID);
    w.InboxKeys.commands.all().find((c) => c.id === "schedule-send").run();
    assert.equal(w.InboxKeys.palette.isOpen(), false);
    assert.ok(w.__toasts.some((t) => /Open a draft/.test(t)));
  }

  // ---- catalog: schedule-send is a fixed compose binding; snooze stays h ----
  {
    const cat = probe.InboxKeys_KEYMAP.commands;
    const s = cat.find((c) => c.id === "schedule-send");
    assert.deepEqual(Array.from(s.defaultKeys), ["Mod+Shift+Enter"]);
    assert.equal(s.fixed, true);
    assert.ok(s.contexts.includes("compose"));
    assert.deepEqual(Array.from(cat.find((c) => c.id === "snooze").defaultKeys), ["h"]);
  }

  console.log("later tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
