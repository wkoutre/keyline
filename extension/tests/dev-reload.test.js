// Dev-only self-reload (src/background/dev-reload.js): an unpacked build with
// the opt-in flag reloads itself when its files change; a Web Store build, or
// an unpacked one without the flag, never does anything.
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { create, FLAG } = require("../src/background/dev-reload.js");

function fakeChrome({ installType = "development", files = {}, flag = true } = {}) {
  const session = {};
  const calls = { reload: 0, reloadedTabs: [] };
  const disk = { ...files };
  if (flag) disk[FLAG] = "";
  const chrome = {
    management: { getSelf: async () => ({ installType }) },
    runtime: {
      getURL: (p) => "chrome-extension://id/" + p,
      getManifest: () => ({
        content_scripts: [{ js: ["src/a.js"], css: ["src/a.css"] }],
        background: { service_worker: "src/background/service-worker.js" },
      }),
      reload: () => { calls.reload++; },
    },
    storage: {
      session: {
        get: async (k) => (k in session ? { [k]: session[k] } : {}),
        set: async (o) => Object.assign(session, o),
      },
    },
    tabs: {
      query: async ({ url }) => {
        assert.deepEqual(url, ["https://mail.google.com/*", "https://calendar.google.com/*"]);
        return [{ id: 7 }, { id: 9 }];
      },
      reload: (id) => calls.reloadedTabs.push(id),
    },
  };
  const fetchFn = async (url) => {
    const p = url.replace("chrome-extension://id/", "");
    if (!(p in disk)) return { ok: false, text: async () => "" };
    return { ok: true, text: async () => disk[p] };
  };
  return { chrome, fetchFn, disk, calls, session };
}

(async () => {
  // Unpacked + flag: first check sets the baseline, a file change reloads.
  {
    const f = fakeChrome({ files: { "manifest.json": "{}", "src/a.js": "one", "src/a.css": "" } });
    const d = create(f.chrome, f.fetchFn);
    assert.deepEqual(await d.check(), { dev: true, changed: false }, "first check only records the baseline");
    assert.ok(f.session.devStamp, "baseline kept in storage.session (cleared by a reload)");
    assert.deepEqual(await d.check(), { dev: true, changed: false }, "unchanged files: no reload");
    assert.equal(f.calls.reload, 0);
    f.disk["src/a.js"] = "two"; // a git checkout changed a content script
    assert.deepEqual(await d.check(), { dev: true, changed: true });
    assert.equal(f.calls.reload, 1, "changed files reload the extension");
    // After the reload Chrome fires onInstalled(update): open Gmail/Calendar tabs reload.
    assert.equal(await d.onInstalled({ reason: "update" }), true);
    assert.deepEqual(f.calls.reloadedTabs, [7, 9]);
  }

  // Web Store build: never active, even with the flag present.
  {
    const f = fakeChrome({ installType: "normal", files: { "src/a.js": "one" } });
    const d = create(f.chrome, f.fetchFn);
    assert.deepEqual(await d.check(), { dev: false });
    f.disk["src/a.js"] = "two";
    assert.deepEqual(await d.check(), { dev: false });
    assert.equal(f.calls.reload, 0, "a store build never reloads itself");
    assert.equal(await d.onInstalled({ reason: "update" }), false, "nor reloads tabs on its own update");
    assert.deepEqual(f.calls.reloadedTabs, []);
  }

  // Unpacked without the opt-in flag (e.g. the main checkout): inert.
  {
    const f = fakeChrome({ flag: false, files: { "src/a.js": "one" } });
    const d = create(f.chrome, f.fetchFn);
    assert.deepEqual(await d.check(), { dev: false });
    f.disk["src/a.js"] = "two";
    assert.deepEqual(await d.check(), { dev: false });
    assert.equal(f.calls.reload, 0, "no flag, no self-reload");
  }

  // Wiring: the worker answers dev-check, the content script asks, the flag
  // never ships (gitignored, and release.sh zips only manifest/icons/src).
  {
    const root = path.join(__dirname, "..");
    const sw = fs.readFileSync(path.join(root, "src/background/service-worker.js"), "utf8");
    assert.match(sw, /importScripts\("dev-reload\.js"\)/);
    assert.match(sw, /inboxkeys:dev-check/);
    const cs = fs.readFileSync(path.join(root, "src/content/content.js"), "utf8");
    assert.match(cs, /inboxkeys:dev-check/);
    const ignore = fs.readFileSync(path.join(root, "..", ".gitignore"), "utf8");
    assert.match(ignore, /extension\/dev-autoreload\.flag/);
    const rel = fs.readFileSync(path.join(root, "release.sh"), "utf8");
    assert.match(rel, /manifest\.json icons src/, "the store zip holds only manifest, icons and src");
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
    assert.deepEqual(manifest.permissions, ["storage"], "no new permission");
  }

  console.log("dev reload tests passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
