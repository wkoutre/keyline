// One-key unsubscribe (Cmd/Ctrl+U, remappable): drives Gmail's own header
// "Unsubscribe" control and its confirm dialog, from an open conversation or
// from the list. Same harness as hotkeys.test.js: every real content script in
// jsdom, real keydown events, real outcomes asserted.
const assert = require("node:assert/strict");
const { tryLoadContentScripts } = require("./helpers.js");

if (!tryLoadContentScripts("")) {
  console.log("unsubscribe tests skipped (jsdom not installed — run: npm install)");
  process.exit(0);
}

const ID = "FMfcgzQgMCZXKzQzpdVlZBPgJlsjMpsw";
const ID2 = "FMfcgzQgMCZXKzQzpdVlZBPgJlsjMpsx";
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function load(html, hash) {
  const w = tryLoadContentScripts(html);
  w.location.hash = hash || "#inbox";
  w.InboxKeys.hotkeys.install();
  w.__toasts = [];
  w.InboxKeys.toast = (msg) => w.__toasts.push(String(msg));
  return w;
}

function press(w, key, opts = {}) {
  const target = opts.target || w.document.body;
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

// A bulk-mail message card the way Gmail renders it: the sender header carries
// Gmail's "Unsubscribe" control; the body carries the newsletter's own footer
// link with the same text (a decoy we must never click).
function card(id, opts = {}) {
  const header = opts.noHeaderControl
    ? ""
    : `<span class="Ca" role="link" tabindex="0" data-unsub="${id}">Unsubscribe</span>`;
  return `
    <div role="listitem">
      <div class="gE"><span class="gD" email="news@shop.com" name="Shop">Shop</span>${header}</div>
      <div class="a3s" data-message-id="${id}">Deals! <a href="https://shop.com/u" data-body-unsub="${id}">Unsubscribe</a></div>
    </div>`;
}

// Gmail, in miniature: the header control opens a confirm dialog; its confirm
// button records which control was confirmed and closes the dialog.
function wireDialog(w, confirmLabel = "Unsubscribe") {
  w.__headerClicks = [];
  w.__confirmed = [];
  w.__bodyClicks = 0;
  w.document.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest && t.closest("[data-body-unsub]")) {
      e.preventDefault();
      w.__bodyClicks++;
      return;
    }
    const hdr = t.closest && t.closest("[data-unsub]");
    if (!hdr) return;
    const which = hdr.getAttribute("data-unsub");
    w.__headerClicks.push(which);
    const dialog = w.document.createElement("div");
    dialog.setAttribute("role", "alertdialog");
    dialog.innerHTML = `<span>Unsubscribe from Shop?</span><button>Cancel</button><button data-confirm>${confirmLabel}</button>`;
    dialog.querySelector("[data-confirm]").addEventListener("click", () => {
      w.__confirmed.push(which);
      dialog.remove();
    });
    w.document.body.appendChild(dialog);
  });
}

(async () => {
  // Thread: Cmd+U clicks Gmail's header control (never the body link) and
  // confirms the dialog.
  {
    const w = load(`<div role="main">${card("m1")}</div>`, "#inbox/" + ID);
    wireDialog(w);
    const ev = press(w, "u", { metaKey: true });
    assert.equal(ev.defaultPrevented, true, "Cmd+U is claimed in a conversation");
    assert.deepEqual(w.__headerClicks, ["m1"], "Gmail's header control is clicked");
    assert.deepEqual(w.__confirmed, ["m1"], "Gmail's confirm dialog is confirmed");
    assert.equal(w.__bodyClicks, 0, "the newsletter's own body link is never clicked");
    assert.ok(w.__toasts.some((t) => /^Unsubscribed/.test(t)), "a success toast is shown");
  }

  // Ctrl+U works the same (Windows/Linux).
  {
    const w = load(`<div role="main">${card("m1")}</div>`, "#inbox/" + ID);
    wireDialog(w);
    press(w, "u", { ctrlKey: true });
    assert.deepEqual(w.__confirmed, ["m1"], "Ctrl+U unsubscribes too");
  }

  // Several bulk messages: the focused card's control wins over the latest.
  {
    const w = load(`<div role="main">${card("m1")}${card("m2")}</div>`, "#inbox/" + ID);
    wireDialog(w);
    w.InboxKeys.threadnav.currentCard = () => w.document.querySelectorAll('[role="listitem"]')[0];
    press(w, "u", { metaKey: true });
    assert.deepEqual(w.__headerClicks, ["m1"], "the focused message's control is used");
  }
  {
    const w = load(`<div role="main">${card("m1")}${card("m2")}</div>`, "#inbox/" + ID);
    wireDialog(w);
    w.InboxKeys.threadnav.currentCard = () => null;
    press(w, "u", { metaKey: true });
    assert.deepEqual(w.__headerClicks, ["m2"], "without a focused card, the latest message's control is used");
  }

  // No Gmail control (only the body's own link): toast, click nothing.
  {
    const w = load(`<div role="main">${card("m1", { noHeaderControl: true })}</div>`, "#inbox/" + ID);
    wireDialog(w);
    const ev = press(w, "u", { metaKey: true });
    assert.equal(ev.defaultPrevented, true, "the key is still claimed (never falls to view-source)");
    assert.equal(w.__bodyClicks, 0, "the body link is not a fallback");
    assert.ok(w.__toasts.some((t) => /No unsubscribe option/.test(t)), "the user is told why nothing happened");
  }

  // Sender without one-click unsubscribe: Gmail's dialog offers "Go to website".
  {
    const w = load(`<div role="main">${card("m1")}</div>`, "#inbox/" + ID);
    wireDialog(w, "Go to website");
    press(w, "u", { metaKey: true });
    assert.deepEqual(w.__confirmed, ["m1"], "Go to website is accepted as the confirm step");
    assert.ok(w.__toasts.some((t) => /unsubscribe page/.test(t)), "the toast says a page was opened");
  }

  // A dialog that was already on screen is never mistaken for the confirm step.
  {
    const w = load(
      `<div role="main">${card("m1")}</div><div role="dialog" id="stale"><button id="stale-ok">OK</button></div>`,
      "#inbox/" + ID
    );
    let staleClicked = false;
    w.document.getElementById("stale-ok").addEventListener("click", () => { staleClicked = true; });
    // Header control that opens no dialog at all.
    w.document.querySelector("[data-unsub]").addEventListener("click", () => {});
    w.InboxKeys.gmail.unsubscribe(w.document);
    await tick(1600);
    assert.equal(staleClicked, false, "the pre-existing dialog's OK is not clicked");
    assert.ok(w.__toasts.some((t) => /Unsubscribe \(confirm dialog\)/.test(t)), "a missing confirm dialog toasts by stage");
  }

  // Remappable: an override replaces Cmd+U.
  {
    const w = load(`<div role="main">${card("m1")}</div>`, "#inbox/" + ID);
    wireDialog(w);
    w.InboxKeys.storage.cache = { ...w.InboxKeys.storage.cache, keyOverrides: { unsubscribe: ["Shift+U"] } };
    const old = press(w, "u", { metaKey: true });
    assert.equal(old.defaultPrevented, false, "Cmd+U is released once unsubscribe is remapped");
    assert.deepEqual(w.__confirmed, [], "the old key no longer unsubscribes");
    press(w, "U", { shiftKey: true });
    assert.deepEqual(w.__confirmed, ["m1"], "the remapped key unsubscribes");
  }
  {
    // A key recorded by the settings page ("Mod+u", lower case) also matches.
    const w = load(`<div role="main">${card("m1")}</div>`, "#inbox/" + ID);
    wireDialog(w);
    w.InboxKeys.storage.cache = { ...w.InboxKeys.storage.cache, keyOverrides: { unsubscribe: ["Mod+j"] } };
    press(w, "j", { metaKey: true });
    assert.deepEqual(w.__confirmed, ["m1"], "a recorded Mod+letter binding fires");
  }

  // Compose keeps Cmd+U as Attach files.
  {
    const w = load(
      `<div role="dialog"><div aria-label="Message Body" contenteditable="true" role="textbox"></div><button aria-label="Attach files" id="att"></button></div>
       <div role="main">${card("m1")}</div>`,
      "#inbox/" + ID
    );
    wireDialog(w);
    let attached = false;
    w.document.getElementById("att").addEventListener("click", () => { attached = true; });
    const body = w.document.querySelector('[aria-label="Message Body"]');
    body.focus();
    press(w, "u", { metaKey: true, target: body });
    assert.equal(attached, true, "Cmd+U in a draft still attaches");
    assert.deepEqual(w.__headerClicks, [], "and does not unsubscribe");
  }

  // List: Cmd+U opens the cursor conversation, unsubscribes, and returns to the
  // list with the cursor where it was.
  {
    const listHtml = `
      <div role="main">
        <div gh="tl"><table><tbody>
          <tr class="zA" data-row="a"><td><div role="checkbox" aria-checked="false"></div></td><td><span class="bog">A</span></td></tr>
          <tr class="zA" data-row="b"><td><div role="checkbox" aria-checked="false"></div></td><td><span class="bog">B</span></td></tr>
        </tbody></table></div>
        <div id="thread"></div>
      </div>`;
    const w = load(listHtml, "#inbox");
    wireDialog(w);
    const ids = { a: ID, b: ID2 };
    w.__opened = [];
    for (const r of w.document.querySelectorAll("tr.zA")) {
      r.querySelector(".bog").addEventListener("click", () => {
        const name = r.getAttribute("data-row");
        w.__opened.push(name);
        w.location.hash = "#inbox/" + ids[name];
        w.document.getElementById("thread").innerHTML = card("m-" + name);
      });
    }
    w.addEventListener("hashchange", () => {
      if (w.location.hash === "#inbox") w.document.getElementById("thread").innerHTML = "";
    });
    press(w, "j");
    const ev = press(w, "u", { metaKey: true });
    assert.equal(ev.defaultPrevented, true, "Cmd+U is claimed in the list");
    await tick(50);
    assert.deepEqual(w.__opened, ["b"], "the cursor conversation is opened");
    assert.deepEqual(w.__confirmed, ["m-b"], "its sender is unsubscribed");
    await tick(500);
    assert.equal(w.location.hash, "#inbox", "back on the list afterwards");
    assert.equal(w.InboxKeys.listnav.cursorRow().getAttribute("data-row"), "b", "cursor stays on the same row");
  }

  // List, sender with no Gmail control: toast and still return to the list.
  {
    const w = load(
      `<div role="main"><div gh="tl"><table><tbody>
        <tr class="zA" data-row="a"><td><div role="checkbox" aria-checked="false"></div></td><td><span class="bog">A</span></td></tr>
      </tbody></table></div><div id="thread"></div></div>`,
      "#inbox"
    );
    wireDialog(w);
    w.document.querySelector(".bog").addEventListener("click", () => {
      w.location.hash = "#inbox/" + ID;
      w.document.getElementById("thread").innerHTML = card("m1", { noHeaderControl: true });
    });
    press(w, "u", { metaKey: true });
    await tick(1600);
    assert.ok(w.__toasts.some((t) => /No unsubscribe option/.test(t)), "toast when Gmail offers no unsubscribe");
    assert.equal(w.__bodyClicks, 0, "body link untouched");
    assert.equal(w.location.hash, "#inbox", "returns to the list");
  }

  // List with no rows: nothing selected.
  {
    const w = load(`<div role="main"><div gh="tl"><table><tbody></tbody></table></div></div>`, "#inbox");
    press(w, "u", { metaKey: true });
    assert.ok(w.__toasts.some((t) => /No conversation selected/.test(t)), "empty list toasts");
  }

  // Catalog: remappable, offered in the list and the thread, on the cheat sheet.
  {
    const w = load(`<div role="main">${card("m1")}</div>`, "#inbox/" + ID);
    const entry = w.InboxKeys_KEYMAP.commands.find((c) => c.id === "unsubscribe");
    assert.equal(entry.fixed, false, "unsubscribe is remappable in Settings");
    assert.equal(JSON.stringify(entry.defaultKeys), '["Mod+U"]');
    assert.equal(JSON.stringify(entry.contexts.slice().sort()), '["inboxList","threadView"]');
    const sheet = JSON.stringify(w.InboxKeys.commands.cheatsheetSpec());
    assert.ok(/Unsubscribe from sender/.test(sheet), "listed on the ? cheat sheet");
  }

  console.log("unsubscribe tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
