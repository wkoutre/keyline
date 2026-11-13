// Contact sidebar ("i"): sender info + recent conversations, built only from
// Gmail's DOM. Fixtures use the selectors verified live (Nov 2026): list rows
// tr.zA with span[email] chips, .bog subject, .y2 snippet, td.xW span[title]
// date, [data-thread-id] / [data-legacy-thread-id] on descendants; thread
// headers .gE with span.gD (sender) and span.g2 (recipients); avatars
// img.ajn[data-hovercard-id] outside .gE.
const assert = require("node:assert/strict");
const { tryLoadContentScripts } = require("./helpers.js");

if (!tryLoadContentScripts("")) {
  console.log("contacts tests skipped (jsdom not installed — run: npm install)");
  process.exit(0);
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const OPEN_ID = "FMfcgzQgMCZXKzQzpdVlZBPgJlsjMpsw";

function row(o) {
  const chips = o.people.map(([e, n]) => `<span class="yP" email="${e}" name="${n}">${n}</span>`).join("");
  return `
    <tr class="zA ${o.unread ? "zE" : "yO"}" data-row="${o.id}">
      <td><div role="checkbox" aria-checked="false"></div></td>
      <td>${chips}</td>
      <td><div class="xT"><span class="bog"><span data-thread-id="#thread-f:${o.perm}" data-legacy-thread-id="${o.legacy}">${o.subject}</span></span><span class="y2"> - ${o.snippet}</span></div></td>
      <td class="xW"><span title="${o.title}"><span>${o.short}</span></span></td>
    </tr>`;
}

const ROWS = [
  { id: "a", perm: "1001", legacy: "1a1c000000000001", subject: "Next Steps – Technical Interview", snippet: "Thank you, you too!", title: "Tue, Nov 10, 2026, 5:35 PM", short: "Nov 10", people: [["grecia@nectarsocial.com", "Grecia Martinez"], ["me@x.com", "me"]] },
  { id: "b", perm: "1002", legacy: "1a1c000000000002", subject: "Reminder: Submit Your Availability", snippet: "Please pick", title: "Tue, Nov 10, 2026, 3:24 PM", short: "Nov 10", people: [["recruiting@nectarsocial.com", "Nectar Hiring Team"]] },
  { id: "c", perm: "1003", legacy: "1a1c000000000003", subject: "Programming Language Preference", snippet: "Which do you prefer", title: "Mon, Nov 9, 2026, 3:23 PM", short: "Nov 9", people: [["grecia@nectarsocial.com", "Grecia Martinez"]], unread: true },
  { id: "d", perm: "1004", legacy: "1a1c000000000004", subject: "Onsite Interviews + References", snippet: "See attached", title: "Mon, Nov 2, 2026, 7:19 PM", short: "Nov 2", people: [["grecia@nectarsocial.com", "Grecia Martinez"]] },
  // the conversation that is open in the thread fixture
  { id: "open", perm: "9999", legacy: "1a1c00000000ffff", subject: "Chat with Vaibhav", snippet: "Looking forward", title: "Tue, Nov 3, 2026, 4:55 PM", short: "Nov 3", people: [["grecia@nectarsocial.com", "Grecia Martinez"]] },
];

function shell(inMain) {
  return `
    <a aria-label="Google Account: Me (me@x.com)" href="#"></a>
    <input aria-label="Search mail" name="q" />
    <div role="complementary" aria-label="Side panel"></div>
    <div role="main">
      <div gh="tl"><table><tbody>${ROWS.map(row).join("")}</tbody></table></div>
      ${inMain || ""}
    </div>`;
}

const THREAD = `
  <div id="thread">
    <h2 class="hP" data-thread-perm-id="thread-f:9999" data-legacy-thread-id="1a1c00000000ffff">Chat with Vaibhav</h2>
    <div role="listitem">
      <img class="ajn ajo" jid="grecia@nectarsocial.com" data-hovercard-id="grecia@nectarsocial.com" src="https://lh3.googleusercontent.com/a/photo">
      <div class="gE hI"><span class="gD bco" email="grecia@nectarsocial.com" name="Grecia Martinez">Grecia Martinez</span>
        <span class="g2" email="me@x.com" name="me">me</span><span class="g2" email="safia@nectarsocial.com" name="safia">safia</span></div>
      <div class="a3s" data-message-id="m1">hi</div>
    </div>
  </div>`;

function load(html, hash) {
  const w = tryLoadContentScripts(html);
  w.location.hash = hash || "#inbox";
  w.InboxKeys.hotkeys.install();
  w.__toasts = [];
  w.InboxKeys.toast = (msg) => w.__toasts.push(String(msg));
  w.__saved = [];
  const set = w.InboxKeys.storage.set.bind(w.InboxKeys.storage);
  w.InboxKeys.storage.set = (patch) => {
    w.__saved.push(patch);
    return set(patch);
  };
  return w;
}

function press(w, key, target) {
  const e = new w.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  (target || w.document.body).dispatchEvent(e);
  return e;
}

const panel = (w) => w.document.querySelector(".inboxkeys-contact");
const subjects = (w) => Array.from(w.document.querySelectorAll(".inboxkeys-contact-thread-subject")).map((n) => n.textContent);

(async () => {
  // ---- parsing -------------------------------------------------------------
  {
    const w = load(shell());
    const c = w.InboxKeys.contacts;
    const rec = c.parseRow(w.document.querySelector('tr.zA[data-row="c"]'));
    assert.equal(rec.key, "thread-f:1003", "row key is the permanent thread id");
    assert.equal(rec.legacyId, "1a1c000000000003");
    assert.equal(rec.subject, "Programming Language Preference");
    assert.equal(rec.snippet, "Which do you prefer", "snippet loses Gmail's leading dash");
    assert.equal(rec.whenText, "Nov 9");
    assert.equal(rec.unread, true, "zE marks unread");
    assert.deepEqual(JSON.parse(JSON.stringify(rec.people)), [{ email: "grecia@nectarsocial.com", name: "Grecia Martinez" }]);
    assert.ok(c.parseDate("Tue, Nov 10, 2026, 5:35 PM") > c.parseDate("Tue, Nov 10, 2026, 3:24 PM"), "dates parse with Gmail's narrow no-break space");
    assert.ok(c.parseDate("Mon, Nov 9, 2026, 3:23 PM") > 0);
    assert.equal(c.parseDate(""), 0);
    assert.equal(c.parseRow(w.document.createElement("tr")), null, "a row without ids or subject is skipped");

    assert.equal(c.scan(), 5, "scan indexes every list row");
    const recent = c.recentWith("Grecia@NectarSocial.com");
    assert.deepEqual(JSON.parse(JSON.stringify(recent.map((r) => r.subject))), ["Next Steps – Technical Interview", "Programming Language Preference", "Chat with Vaibhav", "Onsite Interviews + References"], "newest first, case-insensitive match, only that person's conversations");
    // Rows that leave the DOM stay in the in-memory index.
    w.document.querySelector('tr.zA[data-row="d"]').remove();
    c.scan();
    assert.ok(c.recentWith("grecia@nectarsocial.com").some((r) => r.subject === "Onsite Interviews + References"), "the index remembers rows Gmail stopped rendering");
    console.log("✓ contacts: row parsing, date parsing, recent index");
  }

  // ---- thread view: i opens, shows sender, avatar, others, recent ----------
  {
    const w = load(shell(THREAD), "#inbox/" + OPEN_ID);
    assert.equal(w.InboxKeys.gmail.getContext(), "threadView");
    const e = press(w, "i");
    assert.ok(e.defaultPrevented, "i is consumed");
    const p = panel(w);
    assert.ok(p, "i opens the contact sidebar");
    assert.equal(p.querySelector(".inboxkeys-contact-name").textContent, "Grecia Martinez");
    assert.equal(p.querySelector(".inboxkeys-contact-email").textContent, "grecia@nectarsocial.com");
    assert.equal(p.querySelector("img.inboxkeys-contact-avatar").getAttribute("src"), "https://lh3.googleusercontent.com/a/photo", "uses Gmail's avatar for that address");
    const chips = Array.from(p.querySelectorAll(".inboxkeys-contact-chip")).map((n) => n.textContent);
    assert.deepEqual(chips, ["safia"], "others on the thread, without you or the contact");
    assert.deepEqual(subjects(w), ["Next Steps – Technical Interview", "Programming Language Preference", "Onsite Interviews + References"], "recent conversations exclude the open one");
    assert.deepEqual(JSON.parse(JSON.stringify(w.__saved.pop())), { contactSidebar: true }, "open state is remembered");

    // All mail with them → Gmail search through the hash router.
    const btn = Array.from(p.querySelectorAll(".inboxkeys-contact-btn")).find((b) => b.textContent === "All mail with them");
    btn.click();
    assert.equal(w.location.hash, "#search/" + encodeURIComponent("from:grecia@nectarsocial.com OR to:grecia@nectarsocial.com"));

    // Clicking a recent conversation clicks its real row (Gmail opens it).
    let opened = null;
    w.document.querySelector('tr.zA[data-row="c"] .bog').addEventListener("click", () => (opened = "c"));
    const item = Array.from(p.querySelectorAll(".inboxkeys-contact-thread")).find((b) => b.textContent.includes("Programming Language"));
    item.click();
    assert.equal(opened, "c", "a recent conversation opens through its list row");

    press(w, "i");
    assert.equal(panel(w), null, "i again closes it");
    assert.deepEqual(JSON.parse(JSON.stringify(w.__saved.pop())), { contactSidebar: false });
    console.log("✓ contacts: i toggles the sidebar in a conversation");
  }

  // ---- a row Gmail no longer renders opens by id ---------------------------
  {
    const w = load(shell(THREAD), "#inbox/" + OPEN_ID);
    w.InboxKeys.contacts.scan();
    w.document.querySelector('tr.zA[data-row="d"]').remove();
    press(w, "i");
    const item = Array.from(panel(w).querySelectorAll(".inboxkeys-contact-thread")).find((b) => b.textContent.includes("Onsite"));
    item.click();
    assert.equal(w.location.hash, "#all/1a1c000000000004", "falls back to Gmail's hash router with the thread id");
    w.InboxKeys.contacts.close();
    console.log("✓ contacts: off-screen conversations open by id");
  }

  // ---- list: follows the cursor row ----------------------------------------
  {
    const w = load(shell(), "#inbox");
    await tick(5); // let the initial hashchange land (it resets the list cursor)
    // The cursor starts on the first row.
    press(w, "i");
    assert.equal(panel(w).querySelector(".inboxkeys-contact-email").textContent, "grecia@nectarsocial.com", "list: the cursor row's sender, skipping you");
    assert.ok(panel(w).querySelector(".inboxkeys-contact-initials"), "no avatar in the list → initials");
    assert.equal(panel(w).querySelector(".inboxkeys-contact-initials").textContent, "GM");
    assert.ok(!subjects(w).includes("Next Steps – Technical Interview"), "the cursor row itself is not listed as a recent conversation");
    assert.ok(subjects(w).includes("Programming Language Preference"));
    press(w, "j");
    // No poll tick needed: the keydown schedules a re-check (Chrome throttles
    // intervals in hidden windows, found live).
    await tick(80);
    assert.equal(panel(w).querySelector(".inboxkeys-contact-email").textContent, "recruiting@nectarsocial.com", "moving the cursor updates the sidebar right after the key");
    assert.deepEqual(JSON.parse(JSON.stringify(subjects(w))), [], "the only conversation with them is the cursor row");
    w.InboxKeys.contacts.close();
    console.log("✓ contacts: list cursor drives the sidebar");
  }

  // ---- guards ----------------------------------------------------------------
  {
    const w = load(shell(), "#inbox");
    const box = w.document.querySelector('input[name="q"]');
    box.focus();
    const e = press(w, "i", box);
    assert.equal(e.defaultPrevented, false, "typing i in a field types");
    assert.equal(panel(w), null);
    // Palette lists it.
    const c = w.InboxKeys.commands.all().find((x) => x.id === "contact-sidebar");
    assert.ok(c && c.keys.includes("i"), "palette row carries the i key");
    // Remapped away: i does nothing.
    w.InboxKeys.storage.cache.keyOverrides = { "contact-sidebar": ["Shift+I"] };
    press(w, "i");
    assert.equal(panel(w), null, "remapping frees i");
    // Persisted open state reopens on load.
    w.InboxKeys.storage.cache.contactSidebar = true;
    w.InboxKeys.contacts.init();
    assert.ok(panel(w), "init reopens a sidebar left open");
    w.InboxKeys.contacts.close();
    console.log("✓ contacts: editable guard, palette row, remap, persisted state");
  }

  // ---- source pins -----------------------------------------------------------
  {
    const fs = require("node:fs");
    const src = fs.readFileSync(require("node:path").join(__dirname, "../src/content/contacts.js"), "utf8");
    assert.ok(!/chrome\.storage|fetch\(|XMLHttpRequest|createElement\("iframe"\)/.test(src), "no direct storage, network, or iframe: conversations stay in memory");
    const css = fs.readFileSync(require("node:path").join(__dirname, "../src/content/palette.css"), "utf8");
    const block = css.slice(css.indexOf("/* ---- Contact sidebar"));
    assert.ok(!/#[0-9a-f]{3,8}\b/i.test(block), "sidebar css uses only --ik-* tokens");
    const manifest = JSON.parse(fs.readFileSync(require("node:path").join(__dirname, "../manifest.json"), "utf8"));
    assert.deepEqual(manifest.permissions, ["storage"], "no new permission");
    console.log("✓ contacts: no storage/network/iframe, themed, no new permission");
  }

  console.log("contacts tests passed");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
