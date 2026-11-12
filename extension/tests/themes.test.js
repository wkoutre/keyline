// Themes: the token sheet is complete for every theme in light and dark, every
// surface reads only tokens (no stray hex colors), and the theme is chosen,
// previewed, saved, synced and followed across the palette, the in-Gmail
// settings modal, the Calendar overlay and the options page.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { tryLoadContentScripts, tryLoadGcalUi } = require("./helpers.js");

const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const css = read("src/shared/themes.css");
const themeJs = read("src/shared/theme.js");

// ---- Token sheet -------------------------------------------------------------

// Collect { selector, dark, tokens } for every rule block that sets --ik-* vars.
function blocks(text) {
  const out = [];
  const src = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(src))) {
    const sel = m[1].trim();
    const tokens = new Map();
    for (const d of m[2].matchAll(/(--ik-[\w-]+)\s*:\s*([^;]+);/g)) tokens.set(d[1], d[2].trim());
    if (!tokens.size) continue;
    const before = src.slice(0, m.index);
    const dark = /@media \(prefers-color-scheme: dark\)\s*\{\s*$/.test(before);
    const theme = (sel.match(/data-inboxkeys-theme="(\w+)"/) || [])[1];
    out.push({ sel, dark, theme, tokens });
  }
  return out;
}

const T = (() => {
  const w = { InboxKeys: {} };
  new Function("window", "InboxKeys", themeJs)(w, w.InboxKeys);
  return w.InboxKeys.theme;
})();
const ids = T.THEMES.map((t) => t.id);
assert.deepEqual(ids, ["keyline", "clay", "mono", "aurora", "plush"], "the five themes, default first");

const all = blocks(css);
const base = all.find((b) => b.theme === "keyline" && !b.dark);
assert.ok(base && base.sel.startsWith(":root,"), "default block also targets bare :root");
const allTokens = [...base.tokens.keys()];
const isColor = (v) => /#|rgba?\(|gradient\(/.test(v);
const colorTokens = allTokens.filter((k) => isColor(base.tokens.get(k)));
assert.ok(colorTokens.length >= 40, "the default defines the color tokens");

for (const id of ids) {
  const light = all.find((b) => b.theme === id && !b.dark);
  const dark = all.find((b) => b.theme === id && b.dark);
  assert.ok(light, `${id}: light block`);
  assert.ok(dark, `${id}: dark block`);
  for (const k of allTokens) assert.ok(light.tokens.has(k), `${id} light defines ${k}`);
  for (const k of colorTokens) assert.ok(dark.tokens.has(k), `${id} dark defines ${k}`);
  for (const k of [...light.tokens.keys(), ...dark.tokens.keys()]) assert.ok(base.tokens.has(k), `${id}: ${k} is a known token`);
  const meta = T.byId(id);
  assert.equal(meta.swatch.length, 3, `${id}: swatch bg/text/accent`);
  if (id !== "keyline") assert.ok(meta.inspired, `${id}: names its inspiration`);
}
// Themes borrow a mood, never a logo or a remote font.
assert.doesNotMatch(css, /url\(|@import|@font-face/, "themes.css loads no assets");

// Every token a surface uses exists; no surface hardcodes a hex color.
const surfaces = {
  "src/content/palette.css": read("src/content/palette.css"),
  "src/options/options.css": read("src/options/options.css"),
  "src/popup/popup.css": read("src/popup/popup.css"),
  "src/content/gcal-ui.js (overlay css)": (() => {
    const s = read("src/content/gcal-ui.js");
    return s.slice(s.indexOf("const css = `"), s.indexOf("`;", s.indexOf("const css = `")));
  })(),
};
for (const [name, text] of Object.entries(surfaces)) {
  for (const m of text.matchAll(/var\((--ik-[\w-]+)/g)) assert.ok(base.tokens.has(m[1]), `${name}: ${m[1]} is defined`);
  assert.doesNotMatch(text, /#[0-9a-f]{3,8}\b/i, `${name}: no hardcoded hex colors (use a --ik-* token)`);
  assert.doesNotMatch(text, /prefers-color-scheme/, `${name}: dark mode lives in themes.css only`);
}

// Manifest: tokens load before the surface css, theme.js right after storage.js.
const manifest = JSON.parse(read("manifest.json"));
for (const cs of manifest.content_scripts.filter((c) => c.css)) {
  assert.deepEqual(cs.css, ["src/shared/themes.css", "src/content/palette.css"], "themes.css first");
  assert.equal(cs.js.indexOf("src/shared/theme.js"), cs.js.indexOf("src/content/storage.js") + 1, "theme.js after storage.js");
}
for (const page of ["src/options/options.html", "src/popup/popup.html"]) {
  const html = read(page);
  assert.ok(html.indexOf("../shared/themes.css") < html.indexOf(page.includes("options") ? "options.css" : "popup.css"), `${page}: tokens before page css`);
  assert.ok(html.indexOf("../shared/theme.js") > html.indexOf("../content/storage.js"), `${page}: theme.js after storage.js`);
}

// ---- Behavior (jsdom) --------------------------------------------------------

const probe = tryLoadContentScripts("");
if (!probe) {
  console.log("themes tests: token checks passed; jsdom checks skipped (run: npm install)");
  process.exit(0);
}

function gmail() {
  const w = tryLoadContentScripts('<div role="main"></div>');
  w.__toasts = [];
  w.InboxKeys.toast = (msg) => w.__toasts.push(String(msg));
  w.InboxKeys.storage.cache = { ...w.InboxKeys.DEFAULTS, tabs: w.InboxKeys.DEFAULTS.tabs.map((t) => ({ ...t })), keyOverrides: {} };
  w.__writes = [];
  w.InboxKeys.storage.persist = async (patch) => w.__writes.push(JSON.parse(JSON.stringify(patch)));
  return w;
}
const attr = (w) => w.document.documentElement.getAttribute("data-inboxkeys-theme");
const click = (w, el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));

(async () => {
  // Storage: a synced preference with a safe default.
  {
    const w = gmail();
    const { storage, DEFAULTS, theme } = w.InboxKeys;
    assert.equal(DEFAULTS.theme, "keyline");
    assert.equal(storage.isSyncKey("theme"), true, "theme syncs between computers");
    assert.equal(theme.normalize("CLAY"), "clay");
    assert.equal(theme.normalize("neon"), "keyline", "unknown ids fall back to the default");
    assert.equal(theme.label("plush"), "Plush (family.co-inspired)");
  }

  // init applies the stored theme and follows changes from elsewhere.
  {
    const w = gmail();
    let listener;
    const fake = { get: (k) => (k === "theme" ? "mono" : undefined), onChange: (cb) => (listener = cb) };
    w.InboxKeys.theme.init(fake);
    assert.equal(attr(w), "mono", "stored theme applied on load");
    listener({ theme: "aurora" }, { theme: { newValue: "aurora" } });
    assert.equal(attr(w), "aurora", "a change from another tab or computer applies live");
    listener({ theme: "clay", tabs: [] }, { tabs: {} });
    assert.equal(attr(w), "aurora", "unrelated changes leave the theme alone");
  }

  // Cmd+K: one row per theme in every context, current marked, running saves.
  {
    const w = gmail();
    w.InboxKeys.storage.cache.theme = "clay";
    const rows = w.InboxKeys.commands.all().filter((c) => c.group === "Appearance");
    assert.deepEqual(Array.from(rows, (r) => r.id), ids.map((id) => "theme:" + id));
    assert.equal(rows.find((r) => r.id === "theme:clay").hint, "current");
    assert.equal(rows.find((r) => r.id === "theme:mono").title, "Theme: Mono (Codex-inspired)");
    for (const r of rows) assert.ok(r.contexts.includes("threadView") && r.contexts.includes("inboxList"), "offered everywhere");
    await rows.find((r) => r.id === "theme:aurora").run();
    assert.equal(attr(w), "aurora", "applied at once");
    assert.equal(w.InboxKeys.storage.get("theme"), "aurora");
    assert.deepEqual(w.__writes.pop(), { theme: "aurora" }, "persisted");
    assert.match(w.__toasts.pop(), /Aurora/);
  }

  // In-Gmail settings: Appearance pane previews on click, Cancel reverts, Save keeps.
  {
    const w = gmail();
    w.InboxKeys.theme.apply("keyline");
    w.InboxKeys.tabs.openConfig("appearance");
    const cfg = w.document.querySelector(".inboxkeys-cfg");
    const pane = cfg.querySelector('[data-settings-panel="appearance"]');
    assert.equal(pane.hidden, false, "openConfig('appearance') opens the pane");
    const cards = [...pane.querySelectorAll(".inboxkeys-theme-card")];
    assert.equal(cards.length, ids.length);
    assert.equal(pane.querySelector(".inboxkeys-theme-card--active").dataset.theme, "keyline");
    const plush = cards.find((c) => c.dataset.theme === "plush");
    assert.equal(plush.querySelector(".inboxkeys-theme-preview").style.getPropertyValue("--sw-accent"), "#1a88f8", "card paints its own swatch");
    click(w, plush);
    assert.equal(attr(w), "plush", "clicking previews live");
    assert.equal(pane.querySelector(".inboxkeys-theme-card--active").dataset.theme, "plush");
    assert.equal(pane.querySelector('[aria-checked="true"]').dataset.theme, "plush");
    click(w, cfg.querySelector(".inboxkeys-cfg-cancel"));
    assert.equal(attr(w), "keyline", "Cancel drops the preview");
    assert.equal(w.InboxKeys.storage.get("theme"), "keyline", "nothing saved");

    w.InboxKeys.tabs.openConfig("appearance");
    const cfg2 = w.document.querySelector(".inboxkeys-cfg");
    click(w, cfg2.querySelector('.inboxkeys-theme-card[data-theme="clay"]'));
    w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    assert.equal(attr(w), "keyline", "Esc drops the preview too");

    w.InboxKeys.tabs.openConfig("appearance");
    const cfg3 = w.document.querySelector(".inboxkeys-cfg");
    click(w, cfg3.querySelector('.inboxkeys-theme-card[data-theme="clay"]'));
    click(w, cfg3.querySelector(".inboxkeys-cfg-save"));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(w.InboxKeys.storage.get("theme"), "clay", "Save keeps it");
    assert.equal(attr(w), "clay", "and it stays applied after the modal closes");
    assert.equal(w.__writes.pop().theme, "clay", "persisted with the other settings");
    assert.equal(w.document.querySelector(".inboxkeys-cfg"), null, "modal closed");
  }

  // Calendar overlay offers the same rows.
  {
    const w = tryLoadGcalUi("");
    await new Promise((r) => setTimeout(r, 10)); // let gcal-ui's boot storage.load() settle
    w.InboxKeys.storage.set = async (patch) => Object.assign(w.InboxKeys.storage.cache, patch);
    const rows = w.InboxKeys.gcalui.calendarCommands().filter((c) => c.kind === "theme");
    assert.deepEqual(Array.from(rows, (r) => r.id), ids.map((id) => "theme:" + id));
    await rows.find((r) => r.id === "theme:mono").run();
    assert.equal(w.document.documentElement.getAttribute("data-inboxkeys-theme"), "mono");
    assert.equal(w.InboxKeys.storage.get("theme"), "mono");
  }

  // Options page: theme cards, click saves to chrome.storage.sync and applies.
  {
    const { JSDOM } = require("jsdom");
    const html = read("src/options/options.html").replace(/<script[^>]*><\/script>/g, "");
    const dom = new JSDOM(html, { url: "chrome-extension://x/src/options/options.html", runScripts: "outside-only" });
    const w = dom.window;
    const sync = { theme: "mono" };
    const local = { syncMigrated: true };
    const pick = (obj, keys) => {
      const out = {};
      for (const k of [].concat(keys || Object.keys(obj))) if (k in obj) out[k] = obj[k];
      return out;
    };
    w.chrome = {
      storage: {
        local: { get: async (k) => pick(local, k), set: async (p) => Object.assign(local, p) },
        sync: { QUOTA_BYTES_PER_ITEM: 8192, get: async (k) => pick(sync, k), set: async (p) => Object.assign(sync, p) },
        onChanged: { addListener() {} },
      },
    };
    w.eval(read("src/shared/keymap.js"));
    w.eval(read("src/content/storage.js"));
    w.eval(themeJs);
    w.eval(read("src/options/options.js"));
    await new Promise((r) => setTimeout(r, 10));
    const cards = [...w.document.querySelectorAll("#themes .theme-card")];
    assert.equal(cards.length, ids.length, "options lists every theme");
    assert.equal(w.document.querySelector("#themes .theme-card.active").dataset.theme, "mono", "synced theme selected");
    assert.equal(w.document.documentElement.getAttribute("data-inboxkeys-theme"), "mono", "options page itself wears it");
    click(w, cards.find((c) => c.dataset.theme === "aurora"));
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(sync.theme, "aurora", "saved to chrome.storage.sync");
    assert.equal(w.document.documentElement.getAttribute("data-inboxkeys-theme"), "aurora");
    assert.equal(w.document.querySelector("#themes .theme-card.active").dataset.theme, "aurora");
  }

  console.log("themes tests passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
