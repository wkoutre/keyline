// Pure date/time helpers for the snooze and schedule-send pickers: the preset
// list and a small natural-language parser ("fri 3pm", "tomorrow", "in 2h",
// "dec 3 9am", "12/3 14:30"). No DOM, no chrome APIs: loaded as a content
// script (window.InboxKeys_WHEN) and required directly by the Node tests.
// Every function takes `now` so tests are deterministic.
(function () {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const DEFAULT_HOUR = 8; // a bare day ("tomorrow", "fri") means 8:00 AM

  const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // Named times of day. "tonight" also implies today.
  const PARTS = { morning: 8, noon: 12, afternoon: 13, evening: 18, tonight: 20, midnight: 0 };

  function at(base, h, m) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m || 0, 0, 0);
    return d;
  }
  function addDays(base, n) {
    return new Date(base.getFullYear(), base.getMonth(), base.getDate() + n, base.getHours(), base.getMinutes(), 0, 0);
  }

  // Prefix lookup for weekday and month names: "fr", "fri", "friday" and the
  // common "tues"/"thurs"/"sept" all resolve. Two letters minimum so "m" or "s"
  // can't be read as a day.
  function lookup(word, names, min) {
    if (!word || word.length < (min || 2)) return -1;
    const hits = names.map((n, i) => (n.startsWith(word) ? i : -1)).filter((i) => i >= 0);
    return hits.length === 1 ? hits[0] : -1;
  }
  function weekdayOf(word) {
    if (word === "tu" || word === "tue" || word === "tues") return 2;
    if (word === "th" || word === "thu" || word === "thur" || word === "thurs") return 4;
    if (word === "sa") return 6;
    if (word === "su") return 0;
    return lookup(word, WEEKDAYS, 2);
  }
  function monthOf(word) {
    if (word === "sept") return 8;
    return lookup(word, MONTHS, 3);
  }

  // "3pm", "3:30pm", "3 pm", "15:00", "1530"? (no), "9a", "noon".
  // Returns {h, m, explicitMeridiem} or null.
  function parseClock(tok, next) {
    let m = /^(\d{1,2})(?::(\d{2}))?(am|pm|a|p)?$/.exec(tok);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    let mer = m[3] || null;
    let consumedNext = false;
    if (!mer && next && /^(am|pm|a|p)$/.test(next)) {
      mer = next;
      consumedNext = true;
    }
    if (min > 59) return null;
    if (mer) {
      if (h < 1 || h > 12) return null;
      const pm = mer[0] === "p";
      if (h === 12) h = pm ? 12 : 0;
      else if (pm) h += 12;
      return { h, m: min, explicit: true, consumedNext };
    }
    if (m[2] !== undefined) {
      // 24-hour clock with minutes: "15:00", "9:30" (9:30 is ambiguous; treated
      // like a bare hour below unless it is >= 13 or has a leading zero).
      if (h > 23) return null;
      if (h >= 13 || /^0/.test(m[1])) return { h, m: min, explicit: true, consumedNext };
      return { h, m: min, explicit: false, consumedNext };
    }
    if (h > 23) return null;
    if (h >= 13 || h === 0) return { h, m: 0, explicit: true, consumedNext };
    return { h, m: 0, explicit: false, consumedNext };
  }

  // A bare "3" or "9:30": pick the reading a person means at work. 7 or below
  // is the afternoon/evening, 8-11 the morning, 12 noon.
  function resolveAmbiguous(h) {
    if (h >= 1 && h <= 7) return h + 12;
    return h;
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  // Parse free text into a future Date, or null when it can't be read or the
  // result is not in the future. `now` defaults to the current time.
  function parse(text, now) {
    now = now || new Date();
    const raw = String(text || "").toLowerCase().trim();
    if (!raw) return null;
    const s = raw
      .replace(/,/g, " ")
      .replace(/\bat\b/g, " ")
      .replace(/\bon\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Relative: "in 2 hours", "in 30 min", "2h", "3d", "in a week".
    const rel = /^(?:in\s+)?(an?|\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|wk|wks|weeks?)$/.exec(s);
    if (rel) {
      const n = /^an?$/.test(rel[1]) ? 1 : parseFloat(rel[1]);
      const unit = rel[2][0];
      if (!(n > 0)) return null;
      if (unit === "m") return new Date(now.getTime() + n * 60000);
      if (unit === "h") return new Date(now.getTime() + n * 3600000);
      const days = unit === "w" ? n * 7 : n;
      return at(addDays(now, Math.round(days)), DEFAULT_HOUR, 0);
    }

    const toks = s.split(" ");
    let day = null; // a Date at midnight, when the text names a day
    let weekday = -1;
    let clock = null; // {h, m, explicit}
    let part = null; // named time of day
    let nextWeekday = false;

    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      const nx = toks[i + 1];
      if (t === "today" || t === "tod") { day = startOfDay(now); continue; }
      if (t === "tomorrow" || t === "tom" || t === "tmrw" || t === "tmr" || t === "tomo") { day = startOfDay(addDays(now, 1)); continue; }
      if (t === "tonight") { day = startOfDay(now); part = PARTS.tonight; continue; }
      if (t === "weekend" || t === "wknd") { weekday = 6; continue; }
      if (t === "next" && nx === "week") { weekday = 1; nextWeekday = true; i++; continue; }
      if (t === "next") { nextWeekday = true; continue; }
      if (t === "this") continue;
      if (Object.prototype.hasOwnProperty.call(PARTS, t)) { part = PARTS[t]; continue; }

      const c = parseClock(t, nx);
      if (c) {
        // "dec 3" / "3 dec": a number next to a month is a date, not a clock.
        const prev = toks[i - 1];
        const isDayOfMonth =
          !c.explicit && !/[:]/.test(t) && ((prev && monthOf(prev) >= 0) || (nx && monthOf(nx) >= 0));
        if (isDayOfMonth) continue; // the month branch reads it
        if (clock) return null; // two clocks: ambiguous
        clock = c;
        if (c.consumedNext) i++;
        continue;
      }

      // Month name with a day: "dec 3", "december 3rd", "3 dec".
      const mo = monthOf(t);
      if (mo >= 0) {
        let dn = null;
        if (nx && /^\d{1,2}(st|nd|rd|th)?$/.test(nx)) { dn = parseInt(nx, 10); i++; }
        else if (toks[i - 1] && /^\d{1,2}(st|nd|rd|th)?$/.test(toks[i - 1])) dn = parseInt(toks[i - 1], 10);
        if (!dn) return null;
        day = monthDay(now, mo, dn);
        if (!day) return null;
        continue;
      }
      if (/^\d{1,2}(st|nd|rd|th)$/.test(t)) continue; // day-of-month taken by the month branch

      // Numeric date: 12/3, 12/3/26, 12/3/2026 (US month/day).
      const nd = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(t);
      if (nd) {
        const yr = nd[3] ? (nd[3].length === 2 ? 2000 + parseInt(nd[3], 10) : parseInt(nd[3], 10)) : null;
        day = monthDay(now, parseInt(nd[1], 10) - 1, parseInt(nd[2], 10), yr);
        if (!day) return null;
        continue;
      }

      const wd = weekdayOf(t);
      if (wd >= 0) { weekday = wd; continue; }
      return null; // an unknown word: refuse rather than guess
    }

    let h, m;
    if (clock) {
      h = clock.explicit ? clock.h : resolveAmbiguous(clock.h);
      m = clock.m;
      // "tomorrow morning 9" / "fri evening 7": the part settles am/pm.
      if (!clock.explicit && part !== null) h = part >= 12 && clock.h < 12 ? clock.h + 12 : clock.h;
    } else if (part !== null) {
      h = part;
      m = 0;
    } else if (day || weekday >= 0) {
      h = DEFAULT_HOUR;
      m = 0;
    } else {
      return null;
    }

    if (weekday >= 0) {
      const today = now.getDay();
      let delta = (weekday - today + 7) % 7;
      if (nextWeekday && delta === 0) delta = 7;
      let cand = at(addDays(now, delta), h, m);
      if (cand <= now) cand = at(addDays(now, delta + 7), h, m);
      return cand;
    }
    if (day) {
      const cand = at(day, h, m);
      return cand > now ? cand : null;
    }
    // A time alone: today if still ahead, else tomorrow.
    let cand = at(now, h, m);
    if (cand <= now) cand = at(addDays(now, 1), h, m);
    return cand;
  }

  // Month/day (and optional year) as a midnight Date, rolling to next year when
  // the date has passed. Rejects impossible dates (Feb 30).
  function monthDay(now, mo, dn, yr) {
    if (mo < 0 || mo > 11 || dn < 1 || dn > 31) return null;
    let y = yr || now.getFullYear();
    let d = new Date(y, mo, dn);
    if (d.getMonth() !== mo) return null;
    if (!yr && d < startOfDay(now)) {
      y++;
      d = new Date(y, mo, dn);
    }
    return d;
  }

  // The quick picks. "Later today" is three hours out, rounded up to the hour,
  // and is dropped once that would cross into the night (after 9 PM) where
  // "tomorrow" is the honest answer. Monday is the NEXT Monday, never today.
  function presets(now, kind) {
    now = now || new Date();
    const out = [];
    // "Remind me if no reply": whole days out, at 8 AM like other bare days.
    if (kind === "followup") {
      for (const [id, n, title] of [["1d", 1, "In 1 day"], ["2d", 2, "In 2 days"], ["3d", 3, "In 3 days"], ["1w", 7, "In 1 week"]]) {
        out.push({ id: "followup-" + id, title, when: at(addDays(now, n), DEFAULT_HOUR, 0) });
      }
      return out;
    }
    const later = new Date(now.getTime() + 3 * 3600000);
    later.setMinutes(later.getMinutes() > 0 ? 60 : 0, 0, 0);
    if (later.getDate() === now.getDate() && later.getHours() <= 21) out.push({ id: "later-today", title: "Later today", when: later });
    const tomorrow = addDays(now, 1);
    out.push({ id: "tomorrow", title: "Tomorrow morning", when: at(tomorrow, 8, 0) });
    if (kind === "send") out.push({ id: "tomorrow-afternoon", title: "Tomorrow afternoon", when: at(tomorrow, 13, 0) });
    const toMonday = ((1 - now.getDay() + 7) % 7) || 7;
    out.push({ id: "monday", title: "Monday morning", when: at(addDays(now, toMonday), 8, 0) });
    if (kind !== "send") {
      const toSat = ((6 - now.getDay() + 7) % 7) || 7;
      if (now.getDay() !== 0) out.push({ id: "weekend", title: "This weekend", when: at(addDays(now, toSat), 8, 0) });
    }
    return out;
  }

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }
  function clock12(d) {
    const h = d.getHours() % 12 || 12;
    return `${h}:${pad(d.getMinutes())} ${d.getHours() < 12 ? "AM" : "PM"}`;
  }

  // "Fri, Nov 14, 3:00 PM" (year added when it is not this year).
  function label(d, now) {
    now = now || new Date();
    const y = d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : "";
    return `${DAY_SHORT[d.getDay()]}, ${MONTH_SHORT[d.getMonth()]} ${d.getDate()}${y}, ${clock12(d)}`;
  }

  // The strings Gmail's own date and time boxes accept ("Nov 14, 2026" and
  // "3:00 PM"); see gmail.js fillDateTime.
  function gmailDate(d) {
    return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }
  function gmailTime(d) {
    return clock12(d);
  }

  const api = { parse, presets, label, gmailDate, gmailTime, DAY_MS };
  if (typeof window !== "undefined") window.InboxKeys_WHEN = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
