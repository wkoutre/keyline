// Rate/share card and palette rows (share.js): real content scripts in jsdom,
// real keydown events, real outcomes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { tryLoadContentScripts } = require("./helpers.js");
const LINKS = require("../src/shared/links.js");

if (!tryLoadContentScripts("")) {
  console.log("share tests skipped (jsdom not installed — run: npm install)");
  process.exit(0);
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const DAY = 24 * 60 * 60 * 1000;
const ID = "FMfcgzQgMCZXKzQzpdVlZBPgJlsjMpsw";
const LIST = `
  <div role="main"><div gh="tl"><table><tbody>
    <tr class="zA"><td><div role="checkbox" aria-checked="false"></div></td><td><span class="bog">hi</span></td></tr>
  </tbody></table></div></div>`;
const THREAD = `<div role="main"><div role="listitem"><div class="gE"></div><div class="a3s" data-message-id="m1">body</div></div></div>`;

async function load(html, hash, stored) {
  const w = tryLoadContentScripts(html);
  w.location.hash = hash || "#inbox";
  w.__set = [];
  w.chrome.storage.local.get = async () => ({ ...(stored || {}) });
  w.chrome.storage.local.set = async (patch) => { w.__set.push(patch); };
  await w.InboxKeys.storage.load();
  w.InboxKeys.hotkeys.install();
  w.__toasts = [];
  w.InboxKeys.toast = (msg) => w.__toasts.push(String(msg));
  return w;
}

function press(w, key) {
  const target = w.document.activeElement || w.document.body;
  const e = new w.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}

const card = (w) => w.document.querySelector(".inboxkeys-nudge");
const nudge = (w) => w.InboxKeys.storage.get("shareNudge");
const click = (w, act) => card(w).querySelector(`[data-act="${act}"]`).dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
const ready = (extra) => ({ shareNudge: { uses: 39, since: Date.now() - 6 * DAY, ...(extra || {}) } });

(async () => {
  // Links point at the real listing, its reviews and the repo's issues.
  assert.equal(LINKS.store, "https://chromewebstore.google.com/detail/ndemgnbgodahfbbachpcefknleljgboj");
  assert.equal(LINKS.review, LINKS.store + "/reviews");
  assert.match(LINKS.share, /utm_source=keyline-share$/);
  assert.equal(LINKS.feedback, "https://github.com/wkoutre/keyline/issues/new");
  assert.ok(LINKS.shareText.endsWith(LINKS.share));

  // Privacy and sync: the counter stays on this machine, the answer syncs.
  {
    const w = await load(LIST, "#inbox");
    assert.equal(w.InboxKeys.storage.isSyncKey("shareNudge"), false, "usage counter is local only");
    assert.equal(w.InboxKeys.storage.isSyncKey("shareNudgeDone"), true, "answer syncs");
  }

  // Every Keyline command counts, and the first run stamps the start date.
  {
    const w = await load(LIST, "#inbox");
    press(w, "g");
    press(w, "i");
    assert.equal(nudge(w).uses, 1, "a hotkey chord counts once");
    assert.ok(nudge(w).since > Date.now() - 5000, "first use stamped");
    assert.ok(w.__set.some((p) => p.shareNudge && p.shareNudge.uses === 1), "persisted to local");
  }

  // The 40th command, 5+ days in, in the list: the card shows after a beat.
  {
    const w = await load(LIST, "#inbox", ready());
    press(w, "g");
    press(w, "i");
    assert.equal(card(w), null, "not instantly: the command finishes first");
    await tick(1600);
    assert.ok(card(w), "card shown");
    assert.match(card(w).textContent, /Enjoying Keyline\?/);
    assert.match(card(w).textContent, /run 40 commands/);
    assert.equal(card(w).getAttribute("role"), "region", "never a dialog");
    assert.equal(w.InboxKeys.gmail.getContext(), "inboxList", "card does not switch shortcuts off");

    // Rate: opens the reviews tab, ends the ask everywhere, closes the card.
    click(w, "rate");
    assert.deepEqual(w.__openedWindow, [LINKS.review, "_blank", "noopener"]);
    assert.equal(w.InboxKeys.storage.get("shareNudgeDone"), true);
    assert.ok(w.__set.some((p) => p.shareNudgeDone === true), "persisted");
    assert.equal(card(w), null, "closed");

    // Once answered, commands stop counting and the card never returns.
    const before = nudge(w).uses;
    press(w, "g");
    press(w, "i");
    await tick(1600);
    assert.equal(nudge(w).uses, before, "no more counting");
    assert.equal(card(w), null);
  }

  // Too early (fewer than 5 days since first use): no card, however many uses.
  {
    const w = await load(LIST, "#inbox", { shareNudge: { uses: 500, since: Date.now() - 2 * DAY } });
    press(w, "g");
    press(w, "i");
    await tick(1600);
    assert.equal(card(w), null);
    assert.equal(w.InboxKeys.share.maybeShow(Date.now() + 4 * DAY), true, "shows once 5 days have passed");
  }

  // Never in a conversation (or while writing): only the calm list.
  {
    const w = await load(THREAD, "#inbox/" + ID, ready({ uses: 100 }));
    assert.equal(w.InboxKeys.gmail.getContext(), "threadView");
    assert.equal(w.InboxKeys.share.maybeShow(), false);
    assert.equal(card(w), null);
  }

  // At most once per page.
  {
    const w = await load(LIST, "#inbox", ready({ uses: 100 }));
    assert.equal(w.InboxKeys.share.maybeShow(), true);
    click(w, "later");
    assert.equal(w.InboxKeys.share.maybeShow(Date.now() + 30 * DAY), false, "not again on this page");
  }

  // Later: asks again in 21 days, once. The second Later ends it.
  {
    const w = await load(LIST, "#inbox", ready({ uses: 100 }));
    w.InboxKeys.share.maybeShow();
    const t0 = Date.now();
    click(w, "later");
    assert.equal(card(w), null);
    const s = nudge(w);
    assert.equal(s.laters, 1);
    assert.ok(s.until >= t0 + 21 * DAY - 1000 && s.until <= Date.now() + 21 * DAY, "snoozed 21 days");
    assert.equal(w.InboxKeys.share.eligible(nudge(w), Date.now() + 20 * DAY), false, "quiet for 20 days");
    assert.equal(w.InboxKeys.share.eligible(nudge(w), Date.now() + 22 * DAY), true, "asks again after 21");
    w.InboxKeys.share.later();
    assert.equal(w.InboxKeys.storage.get("shareNudgeDone"), true, "second Later ends it");
  }

  // No thanks ends it for good.
  {
    const w = await load(LIST, "#inbox", ready({ uses: 100 }));
    w.InboxKeys.share.maybeShow();
    click(w, "never");
    assert.equal(w.InboxKeys.storage.get("shareNudgeDone"), true);
    assert.equal(card(w), null);
  }

  // Feedback opens a new issue and keeps the card (it is not an answer).
  {
    const w = await load(LIST, "#inbox", ready({ uses: 100 }));
    w.InboxKeys.share.maybeShow();
    click(w, "feedback");
    assert.deepEqual(w.__openedWindow, [LINKS.feedback, "_blank", "noopener"]);
    assert.ok(card(w), "card stays");
    assert.notEqual(w.InboxKeys.storage.get("shareNudgeDone"), true);
  }

  // Share copies the share text; without a clipboard it shows the link instead.
  {
    const w = await load(LIST, "#inbox", ready({ uses: 100 }));
    let copied = null;
    Object.defineProperty(w.navigator, "clipboard", { configurable: true, value: { writeText: async (t) => { copied = t; } } });
    w.InboxKeys.share.maybeShow();
    click(w, "share");
    await tick();
    assert.equal(copied, LINKS.shareText);
    assert.deepEqual(w.__toasts, ["Link copied. Thanks for sharing Keyline!"]);
    assert.equal(w.InboxKeys.storage.get("shareNudgeDone"), true);

    Object.defineProperty(w.navigator, "clipboard", { configurable: true, value: undefined });
    w.__toasts = [];
    w.InboxKeys.share.copyShare();
    assert.match(w.__toasts[0], /Copy this link to share Keyline: https:\/\/chromewebstore/);
  }

  // Palette rows: rate, share and feedback, any time, from anywhere.
  {
    const w = await load(LIST, "#inbox");
    const ids = w.InboxKeys.commands.all().map((c) => c.id);
    for (const id of ["keyline-rate", "keyline-share", "keyline-feedback"]) assert.ok(ids.includes(id), id + " in the palette");
    const rate = w.InboxKeys.commands.all().find((c) => c.id === "keyline-rate");
    assert.equal(rate.title, "Rate Keyline on the Chrome Web Store");
    rate.run();
    assert.deepEqual(w.__openedWindow, [LINKS.review, "_blank", "noopener"]);

    // Donate opens the settings page at its Support section (PayPal and Zelle).
    const sent = [];
    w.chrome.runtime = { sendMessage: (m) => sent.push(m) };
    const donate = w.InboxKeys.commands.all().find((c) => c.id === "keyline-donate");
    assert.equal(donate.title, "Donate to Keyline (PayPal or Zelle)");
    donate.run();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, "inboxkeys:open-options");
    assert.equal(sent[0].section, "support");
    // Context gone (extension reloaded under the page): fall back to PayPal.
    w.chrome.runtime = { sendMessage: () => { throw new Error("Extension context invalidated."); } };
    donate.run();
    assert.deepEqual(w.__openedWindow, [LINKS.paypal, "_blank", "noopener"]);
  }

  // Popup and options carry the rate/share/feedback links and load links.js.
  {
    const root = path.resolve(__dirname, "..");
    for (const rel of ["src/popup/popup.html", "src/options/options.html"]) {
      const html = fs.readFileSync(path.join(root, rel), "utf8");
      for (const k of ["review", "share", "feedback", "paypal", "zelle"]) assert.ok(html.includes(`data-ik-link="${k}"`), `${rel} has ${k}`);
      assert.ok(html.includes("../shared/links.js"), rel + " loads links.js");
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
    const js = manifest.content_scripts[0].js;
    assert.ok(js.indexOf("src/shared/links.js") < js.indexOf("src/content/share.js"), "links before share");
    assert.ok(js.indexOf("src/content/share.js") < js.indexOf("src/content/hotkeys.js"), "share before hotkeys");
    assert.deepEqual(manifest.permissions, ["storage"], "no new permission");
  }

  console.log("share tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
