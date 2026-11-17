#!/usr/bin/env node
// Test runner: runs every tests/*.test.js in its own Node process, one at a
// time, with a hard per-file timeout and a whole-suite deadline. A test that
// leaves a timer or jsdom window open used to make `npm test` print "passed"
// and then hang forever (and held the publish job for 6 hours). Here that
// file fails after KEYLINE_TEST_TIMEOUT_MS with its open handles listed.
//
// Usage: node tests/run.js [dir-or-files...]   (default: this directory)
"use strict";
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const FILE_TIMEOUT_MS = Number(process.env.KEYLINE_TEST_TIMEOUT_MS) || 60_000;
const SUITE_TIMEOUT_MS = Number(process.env.KEYLINE_SUITE_TIMEOUT_MS) || 5 * 60_000;
const KILL_GRACE_MS = 2_000;
const GUARD = path.join(__dirname, "guard.js");

function collect(args) {
  const targets = args.length ? args : [__dirname];
  const files = [];
  for (const t of targets) {
    const abs = path.resolve(t);
    if (fs.statSync(abs).isDirectory()) {
      for (const f of fs.readdirSync(abs).sort()) if (f.endsWith(".test.js")) files.push(path.join(abs, f));
    } else files.push(abs);
  }
  return files;
}

function runFile(file, budgetMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, ["--require", GUARD, file], {
      cwd: path.resolve(__dirname, ".."),
      stdio: ["ignore", "inherit", "inherit"],
    });
    let timedOut = false;
    let killer;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM"); // guard prints open handles and exits
      killer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS); // busy loop: guard can't run
    }, budgetMs);
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      clearTimeout(killer);
      resolve({ code, signal, timedOut, ms: Date.now() - started });
    });
  });
}

async function main() {
  const files = collect(process.argv.slice(2));
  if (!files.length) {
    console.error("No *.test.js files found.");
    process.exit(1);
  }
  const deadline = Date.now() + SUITE_TIMEOUT_MS;
  const failed = [];
  for (const file of files) {
    const name = path.relative(process.cwd(), file);
    const left = deadline - Date.now();
    if (left <= 0) {
      failed.push(`${name}: not run, suite exceeded ${SUITE_TIMEOUT_MS / 1000}s`);
      continue;
    }
    const budget = Math.min(FILE_TIMEOUT_MS, left);
    const r = await runFile(file, budget);
    if (r.timedOut) {
      failed.push(`${name}: did not exit within ${budget / 1000}s (hung or left a handle open)`);
    } else if (r.code !== 0) {
      failed.push(`${name}: exited with ${r.signal || "code " + r.code}`);
    }
    if (r.ms > FILE_TIMEOUT_MS / 2 && !r.timedOut) {
      console.warn(`[test runner] ${name} took ${(r.ms / 1000).toFixed(1)}s, over half its ${FILE_TIMEOUT_MS / 1000}s timeout`);
    }
  }
  if (failed.length) {
    console.error(`\n${failed.length} of ${files.length} test files failed:\n  ` + failed.join("\n  "));
    process.exit(1);
  }
  console.log(`\nAll ${files.length} test files passed.`);
}

main();
