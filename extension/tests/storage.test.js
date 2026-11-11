// storage.js against an in-memory chrome.storage with both areas: settings
// sync through chrome.storage.sync, per-machine data stays local, pre-sync
// settings migrate once, and anything sync refuses falls back to local.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let JSDOM;
try {
  ({ JSDOM } = require("jsdom"));
} catch {
  console.log("storage tests skipped (jsdom not installed — run: npm install)");
  process.exit(0);
}

const root = path.resolve(__dirname, "..");
const storageScript = fs.readFileSync(path.join(root, "src/content/storage.js"), "utf8");
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
// Values cross the jsdom realm, so compare their JSON shape.
const eq = (a, b, msg) => assert.deepEqual(clone(a), clone(b), msg);

// A chrome.storage area backed by a plain object. Fires onChanged like Chrome.
// `failSet(patch)` may throw to emulate quota / rate-limit errors.
function makeArea(name, initial, listeners, opts = {}) {
  const data = clone(initial || {});
  const writes = [];
  return {
    data,
    writes,
    QUOTA_BYTES_PER_ITEM: opts.perItem,
    async get(keys) {
      const out = {};
      const list = keys == null ? Object.keys(data) : Array.isArray(keys) ? keys : [keys];
      for (const k of list) if (k in data) out[k] = clone(data[k]);
      return out;
    },
    async set(patch) {
      if (opts.failSet) opts.failSet(patch);
      writes.push(clone(patch));
      const changes = {};
      for (const [k, v] of Object.entries(patch)) {
        changes[k] = { oldValue: clone(data[k]), newValue: clone(v) };
        data[k] = clone(v);
      }
      listeners.forEach((l) => l(changes, name));
    },
  };
}

async function boot({ local, sync, noSync, failSet, perItem = 8192 } = {}) {
  const dom = new JSDOM("<!DOCTYPE html><body></body>", {
    url: "https://mail.google.com/mail/u/0/",
    runScripts: "outside-only",
  });
  const { window } = dom;
  const listeners = [];
  const areas = {
    local: makeArea("local", local, listeners),
    sync: noSync ? undefined : makeArea("sync", sync, listeners, { failSet, perItem }),
  };
  window.chrome = {
    storage: {
      local: areas.local,
      ...(areas.sync ? { sync: areas.sync } : {}),
      onChanged: { addListener: (fn) => listeners.push(fn) },
    },
  };
  window.__toasts = [];
  window.eval(storageScript);
  window.InboxKeys.toast = (m) => window.__toasts.push(String(m));
  const storage = window.InboxKeys.storage;
  const cache = await storage.load();
  return { window, storage, cache, areas, listeners };
}

const OLD_TABS = [
  { id: "inbox", name: "Inbox", type: "inbox", query: "" },
  { id: "unread", name: "Unread", type: "search", query: "is:unread" },
  { id: "important", name: "Important", type: "search", query: "is:important" },
  { id: "starred", name: "Starred", type: "search", query: "is:starred" },
  { id: "attachments", name: "Attachments", type: "search", query: "has:attachment" },
];
const MY_TABS = [
  { id: "inbox", name: "Inbox", type: "inbox", query: "" },
  { id: "clients", name: "Clients", type: "search", query: "label:Clients" },
];

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// --- Existing tab-query normalization (now persisted to sync) -------------

test("old tab queries are normalized and written back", async () => {
  const { cache, areas } = await boot({ sync: { tabs: OLD_TABS } });
  assert.equal(cache.tabs[1].query, "in:inbox is:unread");
  assert.equal(cache.tabs[4].query, "in:inbox has:attachment");
  assert.equal(areas.sync.data.tabs[1].query, "in:inbox is:unread", "normalized tabs persist to sync");
});

test("custom tab queries are not rewritten", async () => {
  const custom = [{ id: "unread", name: "Unread", type: "search", query: "label:Clients is:unread" }];
  const { cache, areas } = await boot({ sync: { tabs: custom }, local: { syncMigrated: true } });
  assert.equal(cache.tabs[0].query, "label:Clients is:unread");
  assert.equal(areas.sync.writes.length, 0, "nothing written");
});

test("without chrome.storage.sync everything stays in local (old behavior)", async () => {
  const { cache, areas } = await boot({ noSync: true, local: { tabs: OLD_TABS } });
  assert.equal(cache.tabs[1].query, "in:inbox is:unread");
  assert.equal(areas.local.data.tabs[1].query, "in:inbox is:unread");
});

// --- Migration ------------------------------------------------------------

test("first load copies pre-sync local settings into sync, once", async () => {
  const local = {
    tabs: MY_TABS,
    keyOverrides: { archive: ["y"] },
    autoAdvance: false,
    accountNames: { 0: "me@x.com" },
    paletteRecents: [{ id: "x" }],
  };
  const { cache, areas, storage } = await boot({ local });
  eq(areas.sync.data.tabs, MY_TABS);
  eq(areas.sync.data.keyOverrides, { archive: ["y"] });
  assert.equal(areas.sync.data.autoAdvance, false);
  assert.ok(!("accountNames" in areas.sync.data), "accountNames is per-machine");
  assert.ok(!("paletteRecents" in areas.sync.data), "recents are per-machine");
  assert.equal(areas.local.data.syncMigrated, true);
  eq(cache.tabs, MY_TABS);
  eq(cache.accountNames, { 0: "me@x.com" });

  // A later load with a stale local copy must not push it again.
  areas.local.data.tabs = OLD_TABS;
  const writes = areas.sync.writes.length;
  await storage.load();
  assert.equal(areas.sync.writes.length, writes);
  eq(storage.get("tabs"), MY_TABS, "synced value wins after migration");
});

test("second machine adopts synced settings; keyOverrides merge, sync wins per command", async () => {
  const { cache, areas } = await boot({
    sync: { tabs: MY_TABS, keyOverrides: { archive: ["y"], reply: ["r"] } },
    local: { tabs: OLD_TABS, keyOverrides: { archive: ["q"], star: ["8"] }, tabsEnabled: false },
  });
  eq(cache.tabs, MY_TABS, "synced tabs win");
  eq(cache.keyOverrides, { archive: ["y"], reply: ["r"], star: ["8"] });
  eq(areas.sync.data.keyOverrides, cache.keyOverrides, "merge pushed to sync");
  assert.equal(cache.tabsEnabled, false, "a key only this machine had is pushed up");
  assert.equal(areas.sync.data.tabsEnabled, false);
});

test("fresh install with nothing stored keeps defaults and writes nothing to sync", async () => {
  const { cache, areas, window } = await boot();
  eq(cache.tabs, window.InboxKeys.DEFAULTS.tabs);
  assert.equal(areas.sync.writes.length, 0);
});

// --- Writes ---------------------------------------------------------------

test("set routes preferences to sync and per-machine keys to local", async () => {
  const { storage, areas } = await boot();
  await storage.set({ tabs: MY_TABS, paletteHotkey: "mod+j", accountNames: { 1: "w@x.com" }, paletteRecents: [] });
  eq(areas.sync.data.tabs, MY_TABS);
  assert.equal(areas.sync.data.paletteHotkey, "mod+j");
  assert.ok(!("tabs" in areas.local.data) && !("paletteHotkey" in areas.local.data));
  eq(areas.local.data.accountNames, { 1: "w@x.com" });
  assert.ok(!("accountNames" in areas.sync.data));
  assert.equal(storage.get("paletteHotkey"), "mod+j");
});

test("a setting too large for one sync item stays on this machine, then syncs again when it fits", async () => {
  const { storage, areas, window } = await boot({ perItem: 400 });
  const big = Array.from({ length: 20 }, (_, i) => ({ id: "t" + i, name: "Tab " + i, type: "search", query: "label:L" + i }));
  await storage.set({ tabs: big, autoAdvance: false });
  assert.ok(!("tabs" in areas.sync.data), "oversized tabs not in sync");
  eq(areas.local.data.tabs, big, "kept locally");
  assert.equal(areas.sync.data.autoAdvance, false, "the rest still syncs");
  eq(storage.unsynced(), ["tabs"]);
  eq(areas.local.data.syncOverflow, ["tabs"]);
  assert.ok(window.__toasts.some((t) => /couldn't sync/.test(t)), "the user is told");

  // Reload: the local copy wins over anything older in sync.
  areas.sync.data.tabs = MY_TABS;
  await storage.load();
  eq(storage.get("tabs"), big);

  // Shrink it back: it syncs and leaves the overflow list.
  await storage.set({ tabs: MY_TABS });
  eq(areas.sync.data.tabs, MY_TABS);
  eq(storage.unsynced(), []);
  eq(areas.local.data.syncOverflow, []);
});

test("a sync write error (quota or rate limit) falls back to local for that key only", async () => {
  const { storage, areas } = await boot({
    failSet: (patch) => {
      if ("keyOverrides" in patch) throw new Error("QUOTA_BYTES quota exceeded");
    },
  });
  await storage.set({ keyOverrides: { archive: ["y"] }, autoAdvance: false });
  assert.equal(areas.sync.data.autoAdvance, false);
  eq(areas.local.data.keyOverrides, { archive: ["y"] });
  eq(storage.unsynced(), ["keyOverrides"]);
  eq(storage.get("keyOverrides"), { archive: ["y"] });
});

// --- Change events --------------------------------------------------------

test("onChange applies sync changes from another machine and ignores stale local copies", async () => {
  const { storage, areas } = await boot();
  const seen = [];
  storage.onChange((cache, changes) => seen.push(Object.keys(changes)));

  // Another machine changed tabs: Chrome writes it into this machine's sync area.
  await areas.sync.set({ tabs: MY_TABS });
  eq(storage.get("tabs"), MY_TABS);

  // A leftover local copy of a synced key must not override.
  await areas.local.set({ tabs: OLD_TABS });
  eq(storage.get("tabs"), MY_TABS);

  // Per-machine keys still come from local.
  await areas.local.set({ accountNames: { 2: "z@x.com" } });
  eq(storage.get("accountNames"), { 2: "z@x.com" });
  // ... and a stray sync copy of them is ignored.
  await areas.sync.set({ accountNames: { 9: "other@x.com" } });
  eq(storage.get("accountNames"), { 2: "z@x.com" });

  eq(seen, [["tabs"], ["accountNames"]]);
});

test("a key removed from sync falls back to its default", async () => {
  const { storage, listeners } = await boot({ sync: { autoAdvance: false }, local: { syncMigrated: true } });
  storage.onChange(() => {});
  assert.equal(storage.get("autoAdvance"), false);
  listeners.forEach((l) => l({ autoAdvance: { oldValue: false, newValue: undefined } }, "sync"));
  assert.equal(storage.get("autoAdvance"), true);
});

test("popup, options and the service worker go through storage.js, not chrome.storage.local", async () => {
  for (const rel of ["src/popup/popup.js", "src/options/options.js", "src/background/service-worker.js"]) {
    const src = fs.readFileSync(path.join(root, rel), "utf8");
    assert.ok(!/chrome\.storage\.(local|sync)\./.test(src), rel + " must use InboxKeys.storage");
  }
  for (const rel of ["src/popup/popup.html", "src/options/options.html"]) {
    const html = fs.readFileSync(path.join(root, rel), "utf8");
    assert.ok(html.includes("../content/storage.js"), rel + " loads storage.js");
  }
});

(async () => {
  for (const [name, fn] of tests) {
    try {
      await fn();
    } catch (err) {
      console.error("FAIL:", name);
      throw err;
    }
  }
  console.log(`storage tests passed (${tests.length})`);
})();
