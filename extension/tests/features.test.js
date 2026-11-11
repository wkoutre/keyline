// Integration tests for the ? cheat sheet, auto-advance, Cmd+K jump (labels,
// people, search, recents) and "all mail from this sender / domain". Same
// harness as hotkeys.test.js: every real content script loaded into jsdom,
// real keydown events, real outcomes asserted.
const assert = require("node:assert/strict");
const { tryLoadContentScripts, tryLoadGcalUi } = require("./helpers.js");

if (!tryLoadContentScripts("")) {
  console.log("feature tests skipped (jsdom not installed — run: npm install)");
  process.exit(0);
}

const IDS = {
  one: "FMfcgzQgMCZXKzQzpdVlZBPgJlsjMpsw",
  two: "FMfcgzQgMCZXKzQzpdVlZBPgJlsjMpsx",
  three: "FMfcgzQgMCZXKzQzpdVlZBPgJlsjMpsy",
};

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

function row(name, people) {
  const chips = (people || [])
    .map(([email, label]) => `<span class="yP" email="${email}" name="${label}">${label}</span>`)
    .join("");
  return `
    <tr class="zA" data-row="${name}">
      <td><div role="checkbox" aria-checked="false"></div></td>
      <td>${chips}</td>
      <td><span class="bog" data-thread-id="#thread-f:${name}">${name}</span></td>
    </tr>`;
}

function listHtml(names, inMain = "") {
  return `
    <a aria-label="Google Account: Me (me@x.com)" href="#"></a>
    <div role="navigation">
      <a href="https://mail.google.com/mail/u/0/#label/Clients" aria-label="Clients">Clients</a>
      <a href="https://mail.google.com/mail/u/0/#label/Clients%2FAcme+Corp" aria-label="Acme Corp">Acme Corp</a>
    </div>
    <input aria-label="Search mail" name="q" />
    <div role="main">
      <div gh="tl"><table><tbody>
        ${names.map((n) => row(n, [["me@x.com", "me"], [`${n}@acme.com`, n[0].toUpperCase() + n.slice(1)]])).join("")}
      </tbody></table></div>
      ${inMain}
    </div>`;
}

// A list plus an open conversation: Gmail keeps the list in the DOM while a
// thread is open, which is what auto-advance and Escape-return rely on.
function threadHtml(names, opts = {}) {
  const toolbar = opts.noArchive
    ? '<div gh="tm"></div>'
    : '<div gh="tm"><div role="button" aria-label="Archive" id="tb-archive"></div><div role="button" aria-label="Snooze" id="tb-snooze"></div><div role="button" aria-label="Older" id="tb-older"></div></div>';
  return (
    toolbar +
    listHtml(
      names,
      `<div id="thread">
      <div role="listitem"><div class="gE"><span class="gD" email="alice@corp.io" name="Alice">Alice</span></div>
        <div class="a3s" data-message-id="m1">first</div></div>
      <div role="listitem"><div class="gE"><span class="gD" email="bob@other.org" name="Bob">Bob</span></div>
        <div class="a3s" data-message-id="m2">second</div></div>
    </div>`
    )
  );
}

function rows(w) {
  return Array.from(w.document.querySelectorAll("tr.zA"));
}

// Gmail's behavior, in miniature: clicking a row opens its conversation (hash
// gains the id); Archive removes the open row and returns to the list; Older
// steps to the next row's conversation.
function wireGmail(w) {
  const idOf = (r) => IDS[r.getAttribute("data-row")];
  w.__opened = [];
  for (const r of rows(w)) {
    r.querySelector(".bog").addEventListener("click", () => {
      w.__opened.push(r.getAttribute("data-row"));
      w.location.hash = "#inbox/" + idOf(r);
    });
  }
  const current = () => rows(w).find((r) => w.location.hash.endsWith(idOf(r)));
  const archive = w.document.getElementById("tb-archive");
  if (archive) {
    archive.addEventListener("click", () => {
      const r = current();
      if (r) r.remove();
      w.location.hash = "#inbox";
    });
  }
  const older = w.document.getElementById("tb-older");
  if (older) {
    older.addEventListener("click", () => {
      const list = rows(w);
      const next = list[list.indexOf(current()) + 1];
      if (next) w.location.hash = "#inbox/" + idOf(next);
    });
  }
}

async function openRow(w, name) {
  const list = rows(w);
  const idx = list.findIndex((r) => r.getAttribute("data-row") === name);
  for (let i = 0; i < idx; i++) press(w, "j", { target: w.document.body });
  press(w, "Enter", { target: w.document.body });
  await tick(5);
}

function sheetText(w) {
  const s = w.document.querySelector(".inboxkeys-cheatsheet");
  return s ? s.textContent : null;
}

function typeInPalette(w, text) {
  const input = w.document.querySelector(".inboxkeys-input");
  input.value = text;
  input.dispatchEvent(new w.Event("input"));
}

function paletteRows(w) {
  return Array.from(w.document.querySelectorAll(".inboxkeys-row")).map((r) => r.querySelector(".inboxkeys-row-title").textContent);
}

(async () => {
  // ---- ? cheat sheet (Gmail) --------------------------------------------

  // ? opens the sheet from the list, listing catalog keys and engine keys.
  {
    const w = load(listHtml(["one", "two"]));
    const e = press(w, "?", { target: w.document.body, shiftKey: true });
    assert.equal(e.defaultPrevented, true, "? is claimed");
    const text = sheetText(w);
    assert.ok(text, "? opens the cheat sheet");
    assert.match(text, /Archive/, "lists Archive");
    assert.match(text, /All mail from this sender/, "lists the new sender search");
    assert.match(text, /Open the command palette/, "lists the palette key");
    assert.match(text, /Move cursor down \/ up/, "lists engine-only list keys");
    assert.match(text, /Switch to account 0 to 8/, "lists account switching");
  }

  // While the sheet is open it owns the keyboard: e archives nothing, and
  // Escape or ? closes it.
  {
    const w = load(threadHtml(["one", "two"]), "#inbox");
    wireGmail(w);
    press(w, "?", { target: w.document.body, shiftKey: true });
    const e = press(w, "j", { target: w.document.body });
    assert.equal(e.defaultPrevented, true, "keys behind the sheet are swallowed");
    assert.equal(rows(w)[0].classList.contains("inboxkeys-cursor"), false, "j did not move the list cursor under the sheet");
    press(w, "Escape", { target: w.document.body });
    assert.equal(sheetText(w), null, "Escape closes the sheet");
    press(w, "?", { target: w.document.body, shiftKey: true });
    assert.ok(sheetText(w), "? reopens");
    press(w, "?", { target: w.document.body, shiftKey: true });
    assert.equal(sheetText(w), null, "? toggles it closed");
  }

  // A remapped key shows as remapped.
  {
    const w = load(listHtml(["one"]));
    w.InboxKeys.storage.cache.keyOverrides = { archive: ["Ctrl+e"] };
    press(w, "?", { target: w.document.body, shiftKey: true });
    const archiveRow = Array.from(w.document.querySelectorAll(".inboxkeys-cheatsheet-row")).find((r) => /^Archive/.test(r.textContent));
    assert.ok(archiveRow, "Archive row present");
    assert.match(archiveRow.querySelector(".inboxkeys-cheatsheet-keys").textContent, /Ctrl\+e/, "shows the override, not the default");
  }

  // ? typed in a text field is just a question mark.
  {
    const w = load(listHtml(["one"]) + '<div aria-label="Message Body" contenteditable="true" role="textbox" id="body"></div>');
    const body = w.document.getElementById("body");
    body.focus();
    const e = press(w, "?", { target: body, shiftKey: true });
    assert.equal(e.defaultPrevented, false, "? is left alone while typing");
    assert.equal(sheetText(w), null, "no sheet while typing");
  }

  // Opening the palette closes the sheet.
  {
    const w = load(listHtml(["one"]));
    press(w, "?", { target: w.document.body, shiftKey: true });
    press(w, "k", { target: w.document.body, metaKey: true });
    assert.equal(sheetText(w), null, "Cmd+K replaces the sheet with the palette");
    assert.equal(w.InboxKeys.palette.isOpen(), true);
  }

  // ---- ? cheat sheet (Calendar) ------------------------------------------
  {
    const w = tryLoadGcalUi("<div></div>");
    const ev = (key, extra = {}) =>
      Object.assign(
        { key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: key === "?", target: w.document.body, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() {}, stopPropagation() {} },
        extra
      );
    const e = ev("?");
    w.InboxKeys.gcalui.onKeydown(e);
    assert.equal(e.defaultPrevented, true, "? is claimed on Calendar");
    assert.match(w.document.querySelector(".inboxkeys-cheatsheet").textContent, /Week view/, "the Calendar sheet lists Calendar keys");
    w.InboxKeys.cheatsheet.hide();

    w.InboxKeys.gcalui.onKeydown(ev("?", { defaultPrevented: true }));
    assert.equal(w.document.querySelector(".inboxkeys-cheatsheet"), null, "defers when Calendar's own ? already handled it");

    const input = w.document.createElement("input");
    w.document.body.appendChild(input);
    w.InboxKeys.gcalui.onKeydown(ev("?", { target: input }));
    assert.equal(w.document.querySelector(".inboxkeys-cheatsheet"), null, "not while typing");

    const row = w.InboxKeys.gcalui.calendarCommands().find((c) => c.id === "shortcuts");
    assert.ok(row && row.key === "?", "Calendar's Cmd+K lists the shortcut sheet");
  }

  // ---- Auto-advance ------------------------------------------------------

  // Archive from an open conversation opens the next one.
  {
    const w = load(threadHtml(["one", "two", "three"]));
    wireGmail(w);
    await openRow(w, "one");
    assert.equal(w.location.hash, "#inbox/" + IDS.one, "opened one");
    press(w, "e", { target: w.document.body });
    await tick(20);
    assert.deepEqual(w.__opened, ["one", "two"], "archive advanced to the next conversation");
    assert.equal(w.location.hash, "#inbox/" + IDS.two);

    // And again: the chain continues from the advanced-to conversation.
    press(w, "e", { target: w.document.body });
    await tick(20);
    assert.deepEqual(w.__opened, ["one", "two", "three"], "a second archive advances again");

    // Archiving the last one lands on the (now empty) list with a note.
    press(w, "e", { target: w.document.body });
    await tick(1500);
    assert.equal(w.location.hash, "#inbox", "nothing left: stays on the list");
    assert.ok(w.__toasts.some((t) => /No more conversations/.test(t)), "says there is nothing next");
  }

  // Opened by the MOUSE (not Enter): still advances to the row below.
  {
    const w = load(threadHtml(["one", "two", "three"]));
    wireGmail(w);
    rows(w)[1].querySelector(".bog").click();
    await tick(5);
    press(w, "e", { target: w.document.body });
    await tick(20);
    assert.deepEqual(w.__opened, ["two", "three"], "mouse-opened conversation advances to the next row");
  }

  // j inside a conversation, then archive: advances from where you are.
  {
    const w = load(threadHtml(["one", "two", "three"]));
    wireGmail(w);
    await openRow(w, "one");
    press(w, "j", { target: w.document.body });
    await tick(5);
    assert.equal(w.location.hash, "#inbox/" + IDS.two, "j stepped to two");
    press(w, "e", { target: w.document.body });
    await tick(20);
    assert.equal(w.location.hash, "#inbox/" + IDS.three, "archive after j advances to three, not back to two");
  }

  // Delete, spam and mute arm it too (via the command registry).
  {
    const w = load(threadHtml(["one", "two"]));
    wireGmail(w);
    await openRow(w, "one");
    const spam = w.document.createElement("div");
    spam.setAttribute("role", "button");
    spam.setAttribute("aria-label", "Report spam");
    spam.setAttribute("data-tooltip", "Report spam");
    spam.addEventListener("click", () => {
      rows(w)[0].remove();
      w.location.hash = "#inbox";
    });
    w.document.querySelector('[gh="tm"]').appendChild(spam);
    w.InboxKeys.commands.all().find((c) => c.id === "report-spam").run();
    await tick(20);
    assert.deepEqual(w.__opened, ["one", "two"], "report spam advances");
  }

  // Native passthrough on: Gmail handles the real e itself; its return to
  // the list still advances.
  {
    const w = load(threadHtml(["one", "two"]));
    w.InboxKeys.storage.cache.gmailNativeShortcuts = true;
    wireGmail(w);
    await openRow(w, "one");
    const e = press(w, "e", { target: w.document.body });
    assert.equal(e.defaultPrevented, false, "e is left to Gmail");
    rows(w)[0].remove(); // what Gmail does on its own e
    w.location.hash = "#inbox";
    await tick(20);
    assert.deepEqual(w.__opened, ["one", "two"], "Gmail's native archive still advances");
  }

  // Off in settings: archive returns to the list as before.
  {
    const w = load(threadHtml(["one", "two"]));
    w.InboxKeys.storage.cache.autoAdvance = false;
    wireGmail(w);
    await openRow(w, "one");
    press(w, "e", { target: w.document.body });
    await tick(20);
    assert.deepEqual(w.__opened, ["one"], "no advance when the setting is off");
    assert.equal(w.location.hash, "#inbox");
  }

  // Escape after arming (snooze picker opened, then abandoned) never advances.
  {
    const w = load(threadHtml(["one", "two"]));
    wireGmail(w);
    await openRow(w, "one");
    w.InboxKeys.commands.all().find((c) => c.id === "snooze").run();
    press(w, "Escape", { target: w.document.body });
    await tick(20);
    assert.equal(w.location.hash, "#inbox", "Escape went back");
    assert.deepEqual(w.__opened, ["one"], "going back disarms auto-advance");
  }

  // A missing Archive control toasts and disarms, so a later manual return
  // doesn't jump into another conversation.
  {
    const w = load(threadHtml(["one", "two"], { noArchive: true }));
    wireGmail(w);
    await openRow(w, "one");
    w.console.warn = () => {};
    press(w, "e", { target: w.document.body });
    await tick(2000); // clickControl polls ~1s, then tries the More menu
    assert.ok(w.__toasts.some((t) => /not found: Archive/.test(t)), "missing control toasts");
    w.location.hash = "#inbox";
    await tick(20);
    assert.deepEqual(w.__opened, ["one"], "failed action does not leave auto-advance armed");
  }

  // ---- All mail from this sender / domain ---------------------------------

  // List: g f searches the cursor row's sender, skipping you.
  {
    const w = load(listHtml(["dana", "eve"]));
    press(w, "j", { target: w.document.body });
    press(w, "g", { target: w.document.body });
    press(w, "f", { target: w.document.body });
    assert.equal(w.location.hash, "#search/" + encodeURIComponent("from:eve@acme.com"), "g f searches the cursor row's sender");
  }

  // List: the domain command searches the sender's domain.
  {
    const w = load(listHtml(["dana"]));
    w.InboxKeys.commands.all().find((c) => c.id === "mail-from-domain").run();
    assert.equal(w.location.hash, "#search/" + encodeURIComponent("from:acme.com"));
  }

  // Thread: uses the focused message's sender.
  {
    const w = load(threadHtml(["one"]), "#inbox/" + IDS.one);
    // threadnav focuses the last card by default (Bob).
    press(w, "g", { target: w.document.body });
    press(w, "f", { target: w.document.body });
    assert.equal(w.location.hash, "#search/" + encodeURIComponent("from:bob@other.org"), "focused (last) card's sender");
    w.location.hash = "#inbox/" + IDS.one;
    await tick(5);
    press(w, "ArrowUp", { target: w.document.body });
    w.InboxKeys.commands.all().find((c) => c.id === "mail-from-domain").run();
    assert.equal(w.location.hash, "#search/" + encodeURIComponent("from:corp.io"), "moving up targets the earlier sender's domain");
  }

  // Empty list: says so instead of doing nothing.
  {
    const w = load(listHtml([]));
    w.InboxKeys.commands.all().find((c) => c.id === "mail-from-sender").run();
    assert.ok(w.__toasts.some((t) => /No conversation selected/.test(t)));
  }

  // ---- Cmd+K jump ------------------------------------------------------------

  // Labels from the left nav, by their real path.
  {
    const w = load(listHtml(["dana"]));
    press(w, "k", { target: w.document.body, metaKey: true });
    assert.equal(paletteRows(w).some((t) => /^Go to label/.test(t)), false, "labels stay out of the empty palette");
    typeInPalette(w, "acme corp");
    assert.equal(paletteRows(w)[0], "Go to label: Clients/Acme Corp", "nested label found by name");
    press(w, "Enter", { target: w.document.querySelector(".inboxkeys-input") });
    await tick(50);
    assert.equal(w.location.hash, "#label/Clients%2FAcme+Corp", "navigates with Gmail's own label hash");
  }

  // People on screen, and free text as a search.
  {
    const w = load(listHtml(["dana", "eve"]));
    press(w, "k", { target: w.document.body, metaKey: true });
    typeInPalette(w, "eve");
    const titles = paletteRows(w);
    assert.ok(titles.includes("Conversations with Eve"), "a person on screen is a jump target");
    assert.equal(titles.includes("Conversations with me"), false, "you are not a jump target");
    assert.equal(titles[titles.length - 1], 'Search mail for "eve"', "free-text search is always last");
    const rowsEls = Array.from(w.document.querySelectorAll(".inboxkeys-row"));
    rowsEls.find((r) => /Conversations with Eve/.test(r.textContent)).click();
    await tick(50);
    assert.equal(w.location.hash, "#search/" + encodeURIComponent("from:eve@acme.com OR to:eve@acme.com"));

    press(w, "k", { target: w.document.body, metaKey: true });
    typeInPalette(w, "invoice march");
    Array.from(w.document.querySelectorAll(".inboxkeys-row")).find((r) => /Search mail for/.test(r.textContent)).click();
    await tick(50);
    assert.equal(w.location.hash, "#search/" + encodeURIComponent("invoice march"), "the search row runs a Gmail search");
  }

  // Live regression (Dia, Nov 2026): scattered-letter matches against the
  // "Go to label: …" / "Conversations with …" wording outranked real hits.
  // "toby" listed unrelated labels above Toby, and "invoice" + Enter opened a
  // person instead of searching.
  {
    const html = listHtml(["toby"]).replace(
      "</div>\n    <input",
      '<a href="https://mail.google.com/mail/u/0/#label/Yearly" aria-label="Yearly">Yearly</a></div>\n    <input'
    );
    const w = load(html);
    press(w, "k", { target: w.document.body, metaKey: true });
    typeInPalette(w, "toby");
    const titles = paletteRows(w);
    assert.equal(titles[0], "Conversations with Toby", "the person whose name was typed comes first");
    assert.equal(titles.some((t) => /^Go to label/.test(t)), false, "labels don't match on their 'Go to label' wording");
    typeInPalette(w, "year");
    assert.equal(paletteRows(w)[0], "Go to label: Yearly", "labels still match on their own name");
  }
  {
    const w = load(listHtml([]).replace("<tbody>", `<tbody>${row("x", [["me@x.com", "me"], ["ice@x.org", "Ian Voigt"]])}`));
    press(w, "k", { target: w.document.body, metaKey: true });
    typeInPalette(w, "invoice");
    const titles = paletteRows(w);
    assert.equal(titles.includes("Conversations with Ian Voigt"), false, "no scattered-letter person match");
    assert.equal(titles[0], 'Search mail for "invoice"', "with no real hit, the search row leads");
    press(w, "Enter", { target: w.document.querySelector(".inboxkeys-input") });
    await tick(50);
    assert.equal(w.location.hash, "#search/invoice", "Enter runs the search");
  }

  // Recents: the last run rows lead the empty palette, newest first, and a
  // label row survives even when its nav link is gone.
  {
    const w = load(listHtml(["dana"]));
    press(w, "k", { target: w.document.body, metaKey: true });
    typeInPalette(w, "clients");
    press(w, "Enter", { target: w.document.querySelector(".inboxkeys-input") });
    await tick(50);
    press(w, "k", { target: w.document.body, metaKey: true });
    typeInPalette(w, "go to sent");
    press(w, "Enter", { target: w.document.querySelector(".inboxkeys-input") });
    await tick(50);
    assert.equal(w.location.hash, "#sent");

    w.document.querySelector('[role="navigation"]').remove();
    press(w, "k", { target: w.document.body, metaKey: true });
    const groups = Array.from(w.document.querySelectorAll(".inboxkeys-group")).map((g) => g.textContent);
    assert.equal(groups[0], "Recent", "Recent leads the empty palette");
    assert.deepEqual(paletteRows(w).slice(0, 2), ["Go to Sent", "Go to label: Clients"], "newest first");
    assert.equal(paletteRows(w).filter((t) => t === "Go to Sent").length, 1, "a recent row is not listed twice");
    press(w, "ArrowDown", { target: w.document.querySelector(".inboxkeys-input") });
    press(w, "Enter", { target: w.document.querySelector(".inboxkeys-input") });
    await tick(50);
    assert.equal(w.location.hash, "#label/Clients", "a recent label still navigates after its link is gone");
    assert.equal(w.InboxKeys.storage.get("paletteRecents").length, 2, "re-running a recent doesn't duplicate it");
  }

  // Picker mode (choose) never records recents.
  {
    const w = load(listHtml(["dana"]));
    let ran = 0;
    w.InboxKeys.palette.choose({ items: [{ id: "x", title: "Pick me", run: () => ran++ }] });
    press(w, "Enter", { target: w.document.querySelector(".inboxkeys-input") });
    await tick(50);
    assert.equal(ran, 1);
    assert.equal(w.InboxKeys.storage.get("paletteRecents").length, 0, "picker choices are not recents");
  }

  console.log("feature tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
