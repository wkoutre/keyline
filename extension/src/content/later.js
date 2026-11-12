// Snooze and schedule-send presets: `h` (snooze) and Mod+Shift+Enter in a
// compose window (schedule send) open a one-shot picker over palette.choose
// with quick picks (later today, tomorrow morning, Monday, ...) plus whatever
// the user types ("fri 3pm", "dec 3 9am", "in 2h") parsed by
// InboxKeys_WHEN. The chosen time is then entered into Gmail's OWN
// "Select date and time" / "Pick date & time" dialog (gmail.snoozeUntil /
// gmail.scheduleSendAt), so Gmail does the snoozing and scheduling: no API,
// no server. A last row hands off to Gmail's native menu unchanged.
window.InboxKeys = window.InboxKeys || {};

(function () {
  const WHEN = window.InboxKeys_WHEN;

  function rowsFor(kind, act) {
    const now = new Date();
    const group = kind === "send" ? "Schedule send" : "Snooze until";
    return WHEN.presets(now, kind).map((p) => ({
      id: "later-" + p.id,
      title: p.title,
      group,
      hint: WHEN.label(p.when, now),
      searchText: WHEN.label(p.when, now),
      run: () => act(p.when),
    }));
  }

  function typedRow(kind, q, act) {
    const query = String(q || "").trim();
    if (!query) return [];
    const now = new Date();
    const when = WHEN.parse(query, now);
    if (!when) {
      // A query that names a preset ("mon", "later") is still being filtered;
      // only say "can't read" when nothing else matches either.
      return [
        {
          id: "later-unparsed",
          title: `Can't read "${query}"`,
          group: "Typed time",
          hint: "try fri 3pm, tomorrow, dec 3 9am, in 2h",
          run: () => InboxKeys.toast(`Couldn't read "${query}" as a time`, { kind: "warn" }),
          unparsed: true,
        },
      ];
    }
    return [
      {
        id: "later-typed",
        title: (kind === "send" ? "Send " : "Snooze until ") + WHEN.label(when, now),
        group: "Typed time",
        hint: query,
        run: () => act(when),
      },
    ];
  }

  function open(kind, act, nativeRow) {
    const items = [...rowsFor(kind, act), nativeRow];
    InboxKeys.palette.choose({
      items,
      prompt: kind === "send" ? "Send at" : "Snooze",
      placeholder: kind === "send" ? "Schedule send: pick or type a time (fri 3pm)…" : "Snooze until: pick or type a time (fri 3pm)…",
      dynamic: (q) => {
        const rows = typedRow(kind, q, act);
        // Hide the "can't read" row while the text still fuzzy-matches a preset.
        if (rows[0] && rows[0].unparsed && matchesPreset(items, q)) return [];
        return rows;
      },
    });
    return true;
  }

  function matchesPreset(items, q) {
    const lq = String(q || "").toLowerCase().trim();
    return items.some((it) => (it.title + " " + (it.searchText || "")).toLowerCase().includes(lq));
  }

  // h: snooze the cursor row / selection (list) or the open conversation.
  // `target(onOpen)` opens Gmail's Snooze menu on the right conversation and
  // calls onOpen once the menu button was clicked; commands.js passes the
  // list or thread variant.
  function snooze(opener) {
    return open(
      "snooze",
      (when) => opener(() => InboxKeys.gmail.snoozeUntil(when)),
      {
        id: "later-native-snooze",
        title: "Open Gmail's snooze menu",
        group: "Gmail",
        searchText: "native custom other",
        run: () => opener(null),
      }
    );
  }

  // Mod+Shift+Enter in compose. Remember which draft was focused BEFORE the
  // picker takes focus, so a second open compose window can't be scheduled
  // by mistake.
  function scheduleSend() {
    const gmail = InboxKeys.gmail;
    const draft = gmail.composeScope ? gmail.composeScope() : null;
    if (!draft) {
      InboxKeys.toast("Open a draft to schedule it", { kind: "warn" });
      return false;
    }
    return open(
      "send",
      (when) => gmail.scheduleSendAt(draft, when),
      {
        id: "later-native-send",
        title: "Open Gmail's schedule send menu",
        group: "Gmail",
        searchText: "native custom other",
        run: () => gmail.scheduleSendAt(draft, null),
      }
    );
  }

  InboxKeys.later = { snooze, scheduleSend, _rowsFor: rowsFor, _typedRow: typedRow };
})();
