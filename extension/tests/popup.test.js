// Toolbar popup, donate links and the settings Support section: the real
// popup.html and its scripts in jsdom with a stubbed chrome, real clicks.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const LINKS = require("../src/shared/links.js");

const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

// ---- Donate links (pure) ------------------------------------------------------
assert.equal(LINKS.paypalEmail, "nick.koutrelakos@gmail.com");
assert.ok(LINKS.paypal.startsWith("https://www.paypal.com/donate/?business=nick.koutrelakos%40gmail.com"), LINKS.paypal);
assert.match(LINKS.paypal, /currency_code=USD/);
assert.equal(LINKS.zelle, "(443) 878-8819");
assert.equal(LINKS.gmail, "https://mail.google.com/mail/u/0/#inbox");

// ---- Service worker opens the settings page at a section ------------------------
{
  const created = [];
  let listener = null;
  const chrome = {
    runtime: { onInstalled: { addListener() {} }, onMessage: { addListener: (fn) => (listener = fn) }, getURL: (p) => "chrome-extension://id/" + p },
    tabs: { create: (o) => created.push(o.url), query() {} },
  };
  const self = { KeylineDevReload: { create: () => ({ onInstalled: async () => {}, check: async () => ({ dev: false }) }) } };
  const ctx = vm.createContext({ chrome, self, importScripts() {}, fetch() {} });
  vm.runInContext(read("src/background/service-worker.js"), ctx);
  let res = null;
  listener({ type: "inboxkeys:open-options", section: "support" }, {}, (r) => (res = r));
  assert.deepEqual(created, ["chrome-extension://id/src/options/options.html#support"]);
  assert.equal(res.ok, true);
  listener({ type: "inboxkeys:open-options", section: "x\" onload" }, {}, () => {});
  assert.equal(created[1], "chrome-extension://id/src/options/options.html", "odd sections are dropped, not injected");
}

let JSDOM;
try {
  ({ JSDOM } = require("jsdom"));
} catch {
  console.log("popup tests: link checks passed; jsdom checks skipped (run: npm install)");
  process.exit(0);
}

// Load an extension page with its own <script> tags, in order, against a stub chrome.
function loadPage(rel, { url = "https://mail.google.com/mail/u/1/#inbox", stored = {} } = {}) {
  const html = read(rel).replace(/<script src="[^"]+"><\/script>/g, "");
  const dom = new JSDOM(html, { url: "chrome-extension://id/" + rel, runScripts: "outside-only" });
  const w = dom.window;
  w.__saved = [];
  w.__sent = [];
  w.__closed = false;
  w.__options = 0;
  const area = {
    get: async () => ({ ...stored }),
    set: async (p) => { w.__saved.push(p); },
    remove: async () => {},
  };
  w.chrome = {
    storage: { sync: area, local: area, onChanged: { addListener() {} } },
    tabs: { query: (q, cb) => cb([{ url }]) },
    runtime: {
      sendMessage: (m, cb) => { w.__sent.push(m); if (cb) cb({ ok: true }); },
      openOptionsPage: () => w.__options++,
      getManifest: () => ({ version: "9.9.9" }),
    },
  };
  w.close = () => (w.__closed = true);
  for (const m of read(rel).matchAll(/<script src="([^"]+)"><\/script>/g)) {
    w.eval(read(path.posix.join(path.posix.dirname(rel), m[1])));
  }
  return w;
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const click = (w, el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));

(async () => {
  // On Gmail: account email, toggles from storage, version, palette key.
  {
    const w = loadPage("src/popup/popup.html", { stored: { accountNames: { 1: "me@example.com" }, tabsEnabled: false } });
    await tick(10);
    const $ = (id) => w.document.getElementById(id);
    assert.equal($("account").textContent, "me@example.com");
    assert.equal($("enabled").checked, true);
    assert.equal($("tabsEnabled").checked, false);
    assert.equal($("version").textContent, "v9.9.9");
    assert.ok($("away").hidden, "no Open Gmail card on Gmail");
    assert.ok(!w.document.body.classList.contains("not-gmail"));
    assert.ok(/K$/.test($("palette-key").textContent), "palette key shown");
    for (const cls of ["ik-switch"]) assert.ok($("enabled").classList.contains(cls));

    // Master switch dims the rest and saves.
    $("enabled").checked = false;
    $("enabled").dispatchEvent(new w.Event("change", { bubbles: true }));
    assert.ok(w.document.body.classList.contains("off"));
    assert.equal($("enabled-label").textContent, "Off");
    assert.ok(w.__saved.some((p) => p.enabled === false));

    // Launcher, tabs and help relay into the Gmail tab, then close.
    click(w, $("open-palette"));
    click(w, $("open-help"));
    click(w, $("open-tabs"));
    assert.deepEqual(w.__sent.map((m) => m.payload.type), ["inboxkeys:open-palette", "inboxkeys:open-cheatsheet", "inboxkeys:open-tabs-config"]);
    assert.ok(w.__closed);
    click(w, $("open-options"));
    assert.equal(w.__options, 1);

    // Donate: hidden until asked, then PayPal and Zelle.
    assert.ok($("donate").hidden);
    click(w, $("donate-toggle"));
    assert.equal($("donate").hidden, false);
    assert.equal($("donate-toggle").getAttribute("aria-expanded"), "true");
    const paypal = w.document.querySelector('[data-ik-link="paypal"]');
    assert.equal(paypal.href, LINKS.paypal);
    assert.equal(paypal.target, "_blank");
    assert.equal($("zelle-num").textContent, "(443) 878-8819");

    let copied = null;
    Object.defineProperty(w.navigator, "clipboard", { configurable: true, value: { writeText: async (t) => { copied = t; } } });
    w.__saved.length = 0;
    click(w, w.document.querySelector('[data-ik-copy="zelle"]'));
    await tick(5);
    assert.equal(copied, "(443) 878-8819");
    assert.match($("note").textContent, /Zelle number copied/);
    assert.ok(!w.__saved.some((p) => p.shareNudgeDone), "copying Zelle doesn't answer the rate card");

    click(w, w.document.querySelector('[data-ik-copy="share"]'));
    await tick(5);
    assert.equal(copied, LINKS.shareText);
    assert.ok(w.__saved.some((p) => p.shareNudgeDone === true), "sharing still ends the rate card");

    // No clipboard: the number is shown instead.
    Object.defineProperty(w.navigator, "clipboard", { configurable: true, value: undefined });
    click(w, w.document.querySelector('[data-ik-copy="zelle"]'));
    assert.match($("note").textContent, /\(443\) 878-8819/);
    w.close = () => {};
    w.close();
  }

  // Off Gmail: the Open Gmail card replaces the launcher.
  {
    const w = loadPage("src/popup/popup.html", { url: "https://example.com/" });
    await tick(10);
    const $ = (id) => w.document.getElementById(id);
    assert.equal($("away").hidden, false);
    assert.ok(w.document.body.classList.contains("not-gmail"));
    assert.equal(w.document.querySelector('[data-ik-link="gmail"]').href, LINKS.gmail);
    assert.equal($("account").textContent, "Keyboard-first Gmail");
  }

  // Settings page: branded header and a Support section with both donate options.
  {
    const html = read("src/options/options.html");
    assert.ok(html.includes('id="support"'));
    assert.ok(html.includes('data-ik-link="paypal"') && html.includes('data-ik-copy="zelle"'));
    assert.ok(html.includes('class="page-head ik-hero"'));
    for (const id of ["enabled", "hotkeysEnabled", "tabsEnabled", "calendarEnabled", "gmailNativeShortcuts", "autoAdvance"]) {
      assert.ok(html.includes(`class="ik-switch" id="${id}"`), id + " is a switch");
    }
  }

  // Both pages load the shared brand styles between the tokens and their own css.
  for (const [page, own] of [["src/popup/popup.html", "popup.css"], ["src/options/options.html", "options.css"]]) {
    const html = read(page);
    const a = html.indexOf("../shared/themes.css"), b = html.indexOf("../shared/brand.css"), c = html.indexOf(own);
    assert.ok(a >= 0 && a < b && b < c, page + ": themes, brand, page css");
  }

  // Gmail side: the popup's cheat sheet message opens the "?" sheet.
  {
    const src = read("src/content/content.js");
    assert.match(src, /inboxkeys:open-cheatsheet[\s\S]{0,200}shortcuts-help/);
  }

  console.log("popup tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
