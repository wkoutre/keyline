// Preloaded into every test process by tests/run.js (node --require).
// When the runner times a test file out it sends SIGTERM; this prints what is
// still holding the event loop open (a leaked setInterval shows up as
// "Timeout") so the failure names the cause instead of just hanging.
"use strict";
process.on("SIGTERM", () => {
  const counts = {};
  for (const r of process.getActiveResourcesInfo()) counts[r] = (counts[r] || 0) + 1;
  const list = Object.entries(counts).map(([k, n]) => `${k} x${n}`).join(", ") || "none";
  process.stderr.write(`\n[test guard] still running at timeout; open handles: ${list}\n` +
    "[test guard] A timer, interval, socket or jsdom window was left open. Stop it (or call window.close()) when the test is done.\n");
  process.exit(124);
});
