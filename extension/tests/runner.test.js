// Pins the hang guards: the runner must fail (not hang) on a test that leaks
// a timer or spins forever, name the open handle, keep running the other
// files, and npm test must go through the runner.
"use strict";
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const RUN = path.join(__dirname, "run.js");
const FIX = path.join(__dirname, "fixtures", "runner");

function run(files, env) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [RUN, ...files.map((f) => path.join(FIX, f))], {
    encoding: "utf8",
    env: { ...process.env, KEYLINE_TEST_TIMEOUT_MS: "1500", ...env },
    timeout: 20_000,
  });
  return { ...r, out: r.stdout + r.stderr, ms: Date.now() - started };
}

// Passing file: exit 0.
{
  const r = run(["pass.test.js"]);
  assert.strictEqual(r.status, 0, r.out);
  assert.match(r.out, /All 1 test files passed/);
}

// Leaked interval: fails within the timeout and names the handle.
{
  const r = run(["leak.test.js", "pass.test.js"]);
  assert.strictEqual(r.status, 1, r.out);
  assert.ok(r.ms < 10_000, `runner took ${r.ms}ms on a leaked timer`);
  assert.match(r.out, /leak fixture passed/);
  assert.match(r.out, /open handles: .*Timeout/);
  assert.match(r.out, /leak\.test\.js: did not exit within 1\.5s/);
  assert.match(r.out, /pass fixture ok/, "a hung file must not stop later files from running");
  assert.match(r.out, /1 of 2 test files failed/);
}

// Busy loop: SIGTERM can't run the guard, so SIGKILL ends it.
{
  const r = run(["busy.test.js"]);
  assert.strictEqual(r.status, 1, r.out);
  assert.ok(r.ms < 10_000, `runner took ${r.ms}ms on a busy loop`);
  assert.match(r.out, /busy\.test\.js: did not exit/);
}

// Ordinary failure is reported with its exit code.
{
  const r = run(["fail.test.js"]);
  assert.strictEqual(r.status, 1, r.out);
  assert.match(r.out, /fail\.test\.js: exited with code 3/);
}

// Whole-suite deadline: files past it are reported as not run.
{
  const r = run(["leak.test.js", "pass.test.js"], { KEYLINE_SUITE_TIMEOUT_MS: "1000" });
  assert.strictEqual(r.status, 1, r.out);
  assert.match(r.out, /pass\.test\.js: not run, suite exceeded 1s/);
}

// npm test goes through the runner and picks up every test file by discovery,
// so a new file can't be forgotten in a hand-kept && chain.
{
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.strictEqual(pkg.scripts.test, "node tests/run.js");
}

// Every CI job has a timeout, so a hang can never hold a runner for 6 hours.
{
  const dir = path.join(__dirname, "..", "..", ".github", "workflows");
  for (const f of fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
    const text = fs.readFileSync(path.join(dir, f), "utf8");
    const jobs = text.split(/\n(?=  [A-Za-z0-9_-]+:\n)/).slice(1).filter((b) => /\n    runs-on:/.test(b));
    assert.ok(jobs.length, `${f}: no jobs found`);
    for (const job of jobs) {
      const name = job.split(":")[0].trim();
      assert.match(job, /\n    timeout-minutes: \d+/, `${f} job ${name} has no timeout-minutes`);
    }
  }
}

console.log("runner tests passed");
