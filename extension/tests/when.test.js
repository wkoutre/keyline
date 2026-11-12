// Unit tests for the snooze / schedule-send time parser and presets.
// Every case pins `now` so results are deterministic.
const assert = require("node:assert/strict");
const { parse, presets, label, gmailDate, gmailTime } = require("../src/shared/when.js");

// Wednesday Nov 11 2026, 10:15 AM local.
const NOW = new Date(2026, 10, 11, 10, 15);
const d = (y, mo, day, h, m) => new Date(y, mo, day, h, m || 0).getTime();
const p = (s, now) => {
  const r = parse(s, now || NOW);
  return r ? r.getTime() : null;
};

// ---- weekdays + clocks (the headline "fri 3pm") ----
assert.equal(p("fri 3pm"), d(2026, 10, 13, 15), "fri 3pm → this Friday 3 PM");
assert.equal(p("friday 3pm"), d(2026, 10, 13, 15));
assert.equal(p("Friday at 3:30pm"), d(2026, 10, 13, 15, 30));
assert.equal(p("3pm fri"), d(2026, 10, 13, 15), "order does not matter");
assert.equal(p("fri 3 pm"), d(2026, 10, 13, 15), "space before pm");
assert.equal(p("fri 3"), d(2026, 10, 13, 15), "bare 3 is the afternoon");
assert.equal(p("fri 9"), d(2026, 10, 13, 9), "bare 9 is the morning");
assert.equal(p("fri"), d(2026, 10, 13, 8), "a bare day is 8 AM");
assert.equal(p("mon"), d(2026, 10, 16, 8), "next Monday");
assert.equal(p("tues 14:00"), d(2026, 10, 17, 14), "24h clock");
assert.equal(p("wed 9am"), d(2026, 10, 18, 9), "same weekday, time already passed → next week");
assert.equal(p("wed 5pm"), d(2026, 10, 11, 17), "same weekday, time still ahead → today");
assert.equal(p("next wed"), d(2026, 10, 18, 8), "next <today's weekday> skips today");
assert.equal(p("next week"), d(2026, 10, 16, 8), "next week → Monday 8 AM");
assert.equal(p("weekend"), d(2026, 10, 14, 8), "weekend → Saturday 8 AM");
assert.equal(p("fri evening"), d(2026, 10, 13, 18));
assert.equal(p("fri evening 7"), d(2026, 10, 13, 19));

// ---- today / tomorrow / named parts ----
assert.equal(p("tomorrow"), d(2026, 10, 12, 8));
assert.equal(p("tom 9am"), d(2026, 10, 12, 9));
assert.equal(p("tomorrow afternoon"), d(2026, 10, 12, 13));
assert.equal(p("tomorrow at noon"), d(2026, 10, 12, 12));
assert.equal(p("today 5pm"), d(2026, 10, 11, 17));
assert.equal(p("today 9am"), null, "a time today that has passed is refused, not silently moved");
assert.equal(p("tonight"), d(2026, 10, 11, 20));
assert.equal(p("5pm"), d(2026, 10, 11, 17), "a time alone → today if ahead");
assert.equal(p("9am"), d(2026, 10, 12, 9), "a time alone → tomorrow if passed");
assert.equal(p("12pm"), d(2026, 10, 11, 12));
assert.equal(p("12am"), d(2026, 10, 12, 0));

// ---- relative ----
assert.equal(p("in 2 hours"), NOW.getTime() + 2 * 3600000);
assert.equal(p("2h"), NOW.getTime() + 2 * 3600000);
assert.equal(p("in 30 min"), NOW.getTime() + 30 * 60000);
assert.equal(p("in an hour"), NOW.getTime() + 3600000);
assert.equal(p("3d"), d(2026, 10, 14, 8), "days land on 8 AM");
assert.equal(p("in 2 weeks"), d(2026, 10, 25, 8));

// ---- calendar dates ----
assert.equal(p("dec 3"), d(2026, 11, 3, 8));
assert.equal(p("dec 3 2pm"), d(2026, 11, 3, 14));
assert.equal(p("December 3rd at 9:30am"), d(2026, 11, 3, 9, 30));
assert.equal(p("3 dec"), d(2026, 11, 3, 8), "day before month");
assert.equal(p("12/3"), d(2026, 11, 3, 8));
assert.equal(p("12/3 4pm"), d(2026, 11, 3, 16));
assert.equal(p("1/5"), d(2027, 0, 5, 8), "a passed date rolls to next year");
assert.equal(p("jan 5 2027"), null, "a bare 4-digit token is not a time");
assert.equal(p("1/5/27"), d(2027, 0, 5, 8));
assert.equal(p("feb 30"), null, "impossible dates are refused");

// ---- refusals ----
assert.equal(p(""), null);
assert.equal(p("asdf"), null, "unknown words are refused rather than guessed");
assert.equal(p("fri potato"), null);
assert.equal(p("3pm 4pm"), null, "two clocks are ambiguous");
assert.equal(p("25:00"), null);
assert.equal(p("13pm"), null);
assert.equal(p("m"), null, "a single letter is not a weekday");

// ---- presets ----
{
  const ps = presets(NOW, "snooze");
  const byId = Object.fromEntries(ps.map((x) => [x.id, x.when.getTime()]));
  assert.equal(byId["later-today"], d(2026, 10, 11, 14), "later today = +3h rounded up to the hour");
  assert.equal(byId.tomorrow, d(2026, 10, 12, 8));
  assert.equal(byId.monday, d(2026, 10, 16, 8));
  assert.equal(byId.weekend, d(2026, 10, 14, 8));
  assert.equal(byId["tomorrow-afternoon"], undefined, "snooze has no afternoon preset");
  const send = presets(NOW, "send").map((x) => x.id);
  assert.deepEqual(send, ["later-today", "tomorrow", "tomorrow-afternoon", "monday"]);

  const late = presets(new Date(2026, 10, 11, 19, 30), "snooze").map((x) => x.id);
  assert.ok(!late.includes("later-today"), "no 'later today' once it would run past 9 PM");
  const monday = presets(new Date(2026, 10, 16, 7, 0), "snooze").find((x) => x.id === "monday");
  assert.equal(monday.when.getTime(), d(2026, 10, 23, 8), "on a Monday, 'Monday' means next week");
  for (const x of ps) assert.ok(x.when > NOW, "every preset is in the future: " + x.id);
}

// ---- follow-up ("remind me if no reply") presets: whole days at 8 AM ----
{
  const fu = presets(NOW, "followup");
  assert.deepEqual(fu.map((x) => x.id), ["followup-1d", "followup-2d", "followup-3d", "followup-1w"]);
  const at8 = (days) => {
    const x = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + days, 8, 0, 0, 0);
    return x.getTime();
  };
  assert.deepEqual(fu.map((x) => x.when.getTime()), [at8(1), at8(2), at8(3), at8(7)]);
  // Late at night the 1-day reminder is still tomorrow, not "in 24 hours".
  const night = presets(new Date(2026, 10, 11, 23, 50), "followup")[0];
  assert.equal(night.when.getTime(), d(2026, 10, 12, 8));
}

// ---- formatting ----
assert.equal(label(new Date(2026, 10, 13, 15, 0), NOW), "Fri, Nov 13, 3:00 PM");
assert.equal(label(new Date(2027, 0, 5, 8, 5), NOW), "Tue, Jan 5 2027, 8:05 AM");
assert.equal(gmailDate(new Date(2026, 10, 13, 15)), "Nov 13, 2026");
assert.equal(gmailTime(new Date(2026, 10, 13, 0, 30)), "12:30 AM");
assert.equal(gmailTime(new Date(2026, 10, 13, 12, 0)), "12:00 PM");

console.log("when.test.js: all assertions passed");
