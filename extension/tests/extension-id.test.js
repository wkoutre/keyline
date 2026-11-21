// chrome.storage.sync is keyed by extension ID. An unpacked copy without a
// manifest "key" gets an ID hashed from its folder path, so two unpacked copies
// (or an unpacked copy and the Web Store build) never see each other's synced
// settings. manifest.json pins the Web Store item's public key so every copy
// gets the store ID; release.sh strips it again because the Web Store refuses
// an upload whose manifest has "key".
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const STORE_ID = "ndemgnbgodahfbbachpcefknleljgboj";

// Chrome's ID: first 16 bytes of SHA-256, each hex digit mapped 0-f -> a-p.
const idFromBytes = (buf) =>
  crypto
    .createHash("sha256")
    .update(buf)
    .digest("hex")
    .slice(0, 32)
    .replace(/./g, (c) => String.fromCharCode(97 + parseInt(c, 16)));

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

// 1. The pinned key is the store item's key, so unpacked ID == store ID.
assert.equal(typeof manifest.key, "string", "manifest.json pins a key");
assert.equal(idFromBytes(Buffer.from(manifest.key, "base64")), STORE_ID, "the key derives the Web Store ID");

// 2. Without it, two folders give two IDs (the bug this pins against).
assert.notEqual(
  idFromBytes(Buffer.from("/Volumes/Storage/Projects/keyline/extension")),
  idFromBytes(Buffer.from("/Volumes/Storage/Projects/keyline-chrome/extension")),
  "path-derived IDs differ per folder"
);

// 3. Links point at the same item.
const links = fs.readFileSync(path.join(root, "src/shared/links.js"), "utf8");
assert.ok(links.includes(STORE_ID), "links.js names the same store item");

// 4. The store zip has everything else from the manifest, minus "key".
(function packaged() {
  const hasPython = (() => {
    try {
      execFileSync("python3", ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();
  if (!hasPython) {
    console.log("release packaging check skipped (python3 not installed)");
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keyline-release-"));
  const out = path.join(dir, "out.zip");
  try {
    execFileSync("bash", [path.join(root, "release.sh")], {
      cwd: root,
      env: { ...process.env, KEYLINE_SKIP_TESTS: "1", KEYLINE_RELEASE_OUT: out },
      stdio: "pipe",
      timeout: 30000,
    });
    const zipped = JSON.parse(
      execFileSync("python3", ["-c", "import sys, zipfile; sys.stdout.write(zipfile.ZipFile(sys.argv[1]).read('manifest.json').decode())", out], {
        encoding: "utf8",
      })
    );
    assert.ok(!("key" in zipped), "the packaged manifest has no key");
    const { key, ...rest } = manifest;
    assert.deepEqual(zipped, rest, "everything else is unchanged");
    const names = execFileSync("python3", ["-c", "import sys, zipfile; print('\\n'.join(zipfile.ZipFile(sys.argv[1]).namelist()))", out], {
      encoding: "utf8",
    })
      .trim()
      .split("\n");
    assert.equal(names.filter((n) => n === "manifest.json").length, 1, "one manifest in the zip");
    assert.ok(names.some((n) => n.startsWith("src/")) && names.some((n) => n.startsWith("icons/")), "src and icons ship");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();

console.log("extension-id tests passed");
