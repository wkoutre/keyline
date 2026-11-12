// Instant reply / reply-all / forward from the list, and "remind me if no
// reply" (Shift+H). Same harness as hotkeys.test.js: every real content script
// in jsdom, real keydown events, real outcomes asserted.
//
// Fixtures mirror Gmail's DOM: list rows are tr.zA with a .bog subject; an
// opened conversation renders message cards ([role=listitem] > .gE header +
// .a3s[data-message-id] body) with the inline .ams "Reply" / "Reply all" /
// "Forward" links at the bottom of the thread. The Snooze toolbar button opens
// [role=menu][aria-label="Snooze menu"] whose "Pick date & time" item opens the
// shared date/time dialog (see later.test.js).
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
  const target = opts.target || w.document.body;
  const event = new w.KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    shiftKey: !!opts.shiftKey,
    metaKey: !!opts.metaKey,
    ctrlKey: !!opts.ctrlKey,
  });
  target.dispatchEvent(event);
  return event;
}

function listHtml() {
  return `
    <div role="main">
      <div gh="tm"><div role="button" aria-label="Snooze" data-tooltip="Snooze"></div></div>
      <div gh="tl"><table><tbody>
        <tr class="zA" data-row="one"><td><div role="checkbox" aria-checked="false"></div></td><td><span class="bog">one</span></td></tr>
        <tr class="zA" data-row="two"><td><div role="checkbox" aria-checked="false"></div></td><td><span class="bog">two</span></td></tr>
      </tbody></table></div>
    </div>`;
}

// What Gmail renders once a conversation opens. `replyAll` false = a
// two-person thread (no inline Reply all).
function threadInner(name, replyAll = true) {
  return `
    <div role="listitem" data-card="${name}">
      <div class="gE">${name} header</div>
      <div class="a3s" data-message-id="m-${name}">${name} body</div>
    </div>
    <span class="ams bkH">Reply</span>
    ${replyAll ? '<span class="ams bkI">Reply all</span>' : ""}
    <span class="ams bkG">Forward</span>`;
}

// Clicking a row's subject opens it like Gmail does: hash gains the thread id
// and the list is replaced by the conversation, now or after `delay` ms.
function wireRows(w, opts = {}) {
  for (const tr of w.document.querySelectorAll("tr.zA")) {
    tr.querySelector(".bog").addEventListener("click", () => {
      const name = tr.getAttribute("data-row");
      w.__log.push("open:" + name);
      if (opts.never) return;
      const render = () => {
        w.location.hash = "#inbox/" + ID;
        const main = w.document.querySelector('[role="main"]');
        main.querySelector('[gh="tl"]').remove();
        const host = w.document.createElement("div");
        host.innerHTML = threadInner(name, opts.replyAll !== false);
        main.appendChild(host);
        for (const a of host.querySelectorAll(".ams")) {
          a.addEventListener("click", () => w.__log.push("click:" + a.textContent.trim()));
        }
        w.dispatchEvent(new w.Event("hashchange"));
      };
      if (opts.delay) setTimeout(render, opts.delay);
      else render();
    });
  }
}

function add(w, html) {
  const host = w.document.createElement("div");
  host.innerHTML = html;
  const el = host.firstElementChild;
  w.document.body.appendChild(el);
  return el;
}

function wireSnooze(w) {
  const btn = w.document.querySelector('[aria-label="Snooze"]');
  btn.addEventListener("click", () => {
    w.__log.push("snooze-button");
    const menu = add(
      w,
      `<div role="menu" aria-label="Snooze menu">
         <div role="menuitem" class="J-N"><span class="bsK">Tomorrow</span></div>
         <div role="menuitem" class="J-N" id="pick"><span class="bsK">Pick date &amp; time</span></div>
       </div>`
    );
    menu.querySelector("#pick").addEventListener("click", () => {
      w.__log.push("pick-date-time");
      menu.remove();
      const dlg = add(
        w,
        `<div role="dialog" aria-modal="true"><h2>Pick date &amp; time</h2>
           <input type="text" aria-label="Date" value=""><input type="text" aria-label="Time" value="">
           <button class="c">Cancel</button><button class="s">Save</button></div>`
      );
      for (const input of dlg.querySelectorAll("input")) {
        input.addEventListener("change", () => {
          input.setAttribute("aria-invalid", "false");
          w.__log.push(input.getAttribute("aria-label") + "=" + input.value);
        });
      }
      dlg.querySelector(".s").addEventListener("click", () => {
        w.__log.push("confirm");
        dlg.remove();
      });
    });
  });
}

function pick(w, id) {
  const row = w.InboxKeys.palette.current().find((r) => r.id === id);
  assert.ok(row, "picker row " + id + " is listed");
  w.InboxKeys.palette.hide();
  row.run();
  return row;
}

(async () => {
  const probe = load("");
  if (!probe) {
    console.log("instant reply tests skipped (jsdom not installed)");
    return;
  }

  // ---- r in the list: opens the cursor conversation and starts a reply ----
  {
    const w = load(listHtml(), "#inbox");
    wireRows(w);
    press(w, "j");
    const e = press(w, "r");
    assert.equal(e.defaultPrevented, true, "r is claimed in the list");
    assert.deepEqual(w.__log, ["open:two", "click:Reply"], "r opens the cursor row, then clicks its Reply");
    assert.equal(w.location.hash, "#inbox/" + ID);
  }

  // ---- a in the list: reply all, straight to Gmail's inline Reply all ----
  {
    const w = load(listHtml(), "#inbox");
    wireRows(w);
    press(w, "a");
    assert.deepEqual(w.__log, ["open:one", "click:Reply all"], "a opens the first row and replies all");
  }

  // ---- a on a two-person thread falls back to the plain reply ----
  {
    const w = load(listHtml(), "#inbox");
    wireRows(w, { replyAll: false });
    press(w, "a");
    assert.deepEqual(w.__log, ["open:one", "click:Reply"], "no inline Reply all: plain reply is the reply-all");
  }

  // ---- f in the list: forward (single expanded message → inline Forward) ----
  {
    const w = load(listHtml(), "#inbox");
    wireRows(w);
    press(w, "j");
    press(w, "f");
    assert.deepEqual(w.__log, ["open:two", "click:Forward"], "f opens the cursor row and forwards it");
  }

  // ---- Gmail renders the conversation late: the action waits for it ----
  {
    const w = load(listHtml(), "#inbox");
    wireRows(w, { delay: 150 });
    press(w, "r");
    assert.deepEqual(w.__log, ["open:one"], "nothing clicked before the conversation renders");
    await tick(400);
    assert.deepEqual(w.__log, ["open:one", "click:Reply"], "reply fires once the conversation shows up");
    assert.deepEqual(w.__toasts, [], "no failure toast on a slow render");
  }

  // ---- the conversation never opens: say so instead of eating the key ----
  {
    const w = load(listHtml(), "#inbox");
    wireRows(w, { never: true });
    const timers = [];
    w.setTimeout = (fn) => {
      timers.push(fn);
      return 0;
    };
    press(w, "f");
    let n = 0;
    while (timers.length && n++ < 200) timers.shift()();
    assert.deepEqual(w.__log, ["open:one"], "nothing forwarded");
    assert.ok(w.__toasts.some((t) => /Couldn't open the conversation to forward/.test(t)), "explicit toast");
  }

  // ---- empty list: no row to act on ----
  {
    const w = load(`<div role="main"><div gh="tl"><table><tbody></tbody></table></div></div>`, "#inbox");
    w.InboxKeys.commands.all().find((c) => c.id === "reply").run();
    assert.ok(w.__toasts.includes("No conversation selected"), "toast when the list is empty");
  }

  // ---- in a conversation, r/a/f behave exactly as before (no re-open) ----
  {
    const w = load(`<div role="main">${threadInner("only")}</div>`, "#inbox/" + ID);
    for (const a of w.document.querySelectorAll(".ams")) a.addEventListener("click", () => w.__log.push("click:" + a.textContent.trim()));
    press(w, "a");
    assert.deepEqual(w.__log, ["click:Reply all"], "thread a is a direct reply all");
  }

  // ---- Shift+H in a conversation: follow-up picker, snooze until that day ----
  {
    const html = `<div role="main">
        <div gh="tm"><div role="button" aria-label="Snooze" data-tooltip="Snooze"></div></div>
        ${threadInner("only")}
      </div>`;
    const w = load(html, "#sent/" + ID);
    wireSnooze(w);
    const e = press(w, "H", { shiftKey: true });
    assert.equal(e.defaultPrevented, true, "Shift+H is claimed in a conversation");
    assert.equal(w.InboxKeys.palette.isOpen(), true, "Shift+H opens the follow-up picker");
    const ids = [...w.InboxKeys.palette.current().map((r) => r.id)];
    assert.deepEqual(
      ids,
      ["later-followup-1d", "later-followup-2d", "later-followup-3d", "later-followup-1w", "later-native-followup"],
      "day presets, then Gmail's own menu"
    );
    assert.deepEqual(w.__log, [], "nothing snoozed before a pick");

    pick(w, "later-followup-3d");
    const when = WHEN.presets(new Date(), "followup").find((p) => p.id === "followup-3d").when;
    assert.equal(when.getHours(), 8, "a reminder day lands at 8 AM");
    assert.deepEqual(w.__log, [
      "snooze-button",
      "pick-date-time",
      "Date=" + WHEN.gmailDate(when),
      "Time=" + WHEN.gmailTime(when),
      "confirm",
    ]);
    assert.ok(w.__toasts.some((t) => /^If no reply, back in your inbox /.test(t)), "toast says what the reminder does");
  }

  // ---- typed: a bare number is days, not 3 PM ----
  {
    const w = load(`<div role="main"><div gh="tm"><div role="button" aria-label="Snooze"></div></div>${threadInner("only")}</div>`, "#inbox/" + ID);
    press(w, "H", { shiftKey: true });
    const input = w.document.querySelector(".inboxkeys-input");
    input.value = "4";
    input.dispatchEvent(new w.Event("input", { bubbles: true }));
    const top = w.InboxKeys.palette.current()[0];
    assert.equal(top.id, "later-typed", "typed row leads");
    const expect = WHEN.parse("4d", new Date());
    assert.equal(top.title, "Remind me " + WHEN.label(expect, new Date()), "'4' means in 4 days");
    w.InboxKeys.palette.hide();
  }

  // ---- Shift+H in the list reminds on the cursor row ----
  {
    const w = load(listHtml(), "#inbox");
    wireSnooze(w);
    w.__selected = [];
    for (const cb of w.document.querySelectorAll('[role="checkbox"]')) {
      cb.addEventListener("click", () => {
        const on = cb.getAttribute("aria-checked") !== "true";
        cb.setAttribute("aria-checked", on ? "true" : "false");
        if (on) w.__selected.push(cb.closest("tr").getAttribute("data-row"));
      });
    }
    press(w, "j");
    press(w, "H", { shiftKey: true });
    pick(w, "later-followup-1d");
    assert.deepEqual(w.__selected, ["two"], "the cursor row is what gets the reminder");
    assert.ok(w.__log.includes("confirm"), "the dialog is confirmed");
  }

  // ---- catalog ----
  {
    const cat = probe.InboxKeys_KEYMAP.commands;
    const by = (id) => cat.find((c) => c.id === id);
    for (const id of ["reply", "reply-all", "forward"]) {
      assert.ok(by(id).contexts.includes("inboxList"), id + " fires from the list");
      assert.ok(by(id).contexts.includes("threadView"), id + " still fires in a conversation");
    }
    assert.deepEqual(Array.from(by("remind-no-reply").defaultKeys), ["Shift+H"]);
  }

  console.log("instant reply tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

