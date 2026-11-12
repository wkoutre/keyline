// The command registry: every action the palette and hotkeys can run.
// Each command: { id, title, group, hint?, keys, contexts, run() }.
// `keys` is derived from InboxKeys_KEYMAP.keysFor(id, keyOverrides); "g i" is a chord
// (press g then i). `contexts` comes from the shared catalog.
window.InboxKeys = window.InboxKeys || {};

(function () {
  const { gmail, accounts, calendar, tabs, storage } = InboxKeys;

  function nav(hash) {
    return () => gmail.setHash(hash);
  }

  // Pull keys + contexts for a catalog command id, applying user overrides.
  function entry(id) {
    return (InboxKeys_KEYMAP.commands || []).find((c) => c.id === id) || null;
  }
  function keysFor(id) {
    return InboxKeys_KEYMAP.keysFor(id, storage.get("keyOverrides") || {});
  }
  function contextsFor(id) {
    const e = entry(id);
    return e ? e.contexts : InboxKeys_KEYMAP.DEFAULT_CONTEXTS;
  }
  // Build a base command from a catalog id: catalog supplies title/group/keys/
  // contexts; the caller supplies run() and an optional hint override.
  function cmd(id, run, hint) {
    const e = entry(id);
    return {
      id,
      title: e ? e.title : id,
      group: e ? e.group : "",
      hint,
      keys: keysFor(id),
      contexts: contextsFor(id),
      run,
    };
  }

  function listSelectionAction(action) {
    if (gmail.getContext() === "inboxList" && InboxKeys.listnav && InboxKeys.listnav.withSelection) {
      return InboxKeys.listnav.withSelection(action);
    }
    return action();
  }

  function listTemporarySelectionAction(action) {
    if (gmail.getContext() === "inboxList" && InboxKeys.listnav && InboxKeys.listnav.withTemporarySelection) {
      return InboxKeys.listnav.withTemporarySelection(action);
    }
    return action();
  }

  // Instant reply / reply-all / forward: in the list, open the cursor
  // conversation and run the thread action once Gmail has rendered it, so one
  // keystroke goes from the inbox to a draft. In a conversation, run it as is.
  function fromList(threadAction, what) {
    return () => {
      if (gmail.getContext() === "inboxList" && InboxKeys.listnav && InboxKeys.listnav.openThen) {
        return InboxKeys.listnav.openThen(threadAction, what);
      }
      return threadAction();
    };
  }

  // In an open conversation, run a thread-removing action with auto-advance
  // armed (see listnav.advancing). Snooze gets a longer window because Gmail
  // only returns to the list after you pick a time in its picker.
  function advancing(action, ms) {
    return () => {
      if (gmail.getContext() === "threadView" && InboxKeys.listnav && InboxKeys.listnav.advancing) {
        return InboxKeys.listnav.advancing(action, ms);
      }
      return action();
    };
  }

  // How h reaches Gmail's Snooze menu, captured when h is pressed (before the
  // picker takes focus): the cursor row / selection in the list, the open
  // conversation (with auto-advance armed) otherwise. `after` continues into
  // the custom date/time dialog; null leaves Gmail's own menu open.
  function snoozeOpener() {
    if (gmail.getContext() === "inboxList") return (after) => InboxKeys.listnav.snooze(after || undefined);
    return (after) => advancing(() => gmail.snooze(after || undefined), 60000)();
  }

  // "All mail from this sender / domain": the focused message's sender in a
  // conversation, the cursor row's sender in the list.
  function currentSender() {
    if (gmail.getContext() === "threadView") {
      const card = InboxKeys.threadnav && InboxKeys.threadnav.currentCard ? InboxKeys.threadnav.currentCard() : null;
      return gmail.senderOfCard(card) || gmail.senderOfCard(null);
    }
    const row = InboxKeys.listnav && InboxKeys.listnav.cursorRow ? InboxKeys.listnav.cursorRow() : null;
    if (!row) return undefined; // no conversation at all
    return gmail.senderOfRow(row);
  }

  function mailFrom(kind) {
    const who = currentSender();
    if (who === undefined) {
      InboxKeys.toast("No conversation selected", { kind: "warn" });
      return false;
    }
    if (!who) {
      InboxKeys.toast("Couldn't find this conversation's sender", { kind: "warn" });
      return false;
    }
    if (kind === "domain") {
      const domain = gmail.domainOf(who.email);
      return gmail.search("from:" + domain);
    }
    return gmail.search("from:" + who.email);
  }

  // Rebuilt each time the palette opens so key overrides stay current.
  function buildBase() {
    return [
      // Compose / messaging
      cmd("compose", () => gmail.compose()),
      cmd("reply", fromList(() => gmail.replyToThread(), "reply")),
      cmd("reply-all", fromList(() => gmail.replyAllToThread(InboxKeys.threadnav.currentCard() || document), "reply all")),
      cmd("forward", fromList(() => gmail.forwardThread(InboxKeys.threadnav.currentCard() || document), "forward")),
      cmd("open-link-or-attachment", () => gmail.openLinkOrAttachment(InboxKeys.threadnav.currentCard() || document)),
      cmd("attach-file", () => gmail.attachFile()),
      cmd("discard-draft", () => gmail.discardDraft()),

      // Triage (archive is context-aware: open thread vs. selected/cursor rows)
      cmd("archive", () => (gmail.getContext() === "threadView" ? advancing(() => gmail.archiveThread())() : InboxKeys.listnav.archive())),
      cmd("mark-not-done", () => listSelectionAction(() => gmail.markNotDone())),
      cmd("delete", () => (gmail.getContext() === "threadView" ? advancing(() => gmail.action(["Delete"], "Delete"))() : InboxKeys.listnav.trash())),
      cmd("undo", () => gmail.undo()),
      cmd("mark-read-unread", () => (gmail.getContext() === "inboxList" ? InboxKeys.listnav.markReadUnread() : gmail.markReadUnread())),
      cmd("mark-read", () => gmail.action(["Mark as read"])),
      cmd("mark-unread", () => gmail.action(["Mark as unread"])),
      cmd("snooze", () => InboxKeys.later.snooze(snoozeOpener())),
      cmd("remind-no-reply", () => InboxKeys.later.remindNoReply(snoozeOpener())),
      cmd("schedule-send", () => InboxKeys.later.scheduleSend()),
      cmd("report-spam", advancing(() => gmail.action(["Report spam"]))),
      cmd("star", () => (gmail.getContext() === "threadView" ? gmail.toggleStar(InboxKeys.threadnav.currentCard() || document) : InboxKeys.listnav.toggleStar())),
      cmd("mute", advancing(() => listSelectionAction(() => gmail.mute()))),
      cmd("unsubscribe", () => gmail.unsubscribe()),
      cmd("label", () => listSelectionAction(() => gmail.openLabelMenu())),
      cmd("remove-label", () => listSelectionAction(() => gmail.removeLabel())),
      cmd("remove-all-labels", () => listSelectionAction(() => gmail.removeAllLabels())),
      cmd("move", () => listSelectionAction(() => gmail.openMoveMenu())),

      // Navigation (chords mirror Gmail's "g" prefix)
      cmd("go-inbox", nav("inbox")),
      cmd("go-sent", nav("sent")),
      cmd("go-drafts", nav("drafts")),
      cmd("go-starred", nav("starred")),
      cmd("go-snoozed", nav("snoozed")),
      cmd("go-important", nav("imp")),
      cmd("go-all", nav("all")),
      cmd("go-spam", nav("spam")),
      cmd("go-trash", nav("trash")),
      cmd("go-settings", nav("settings/general")),

      // List scrolling + thread/tab navigation (engine helpers)
      cmd("go-top", () => {
        gmail.listScrollTop();
        if (InboxKeys.listnav && InboxKeys.listnav.syncEdgeAfterScroll) InboxKeys.listnav.syncEdgeAfterScroll(-1);
      }),
      cmd("go-bottom", () => {
        gmail.listScrollBottom();
        if (InboxKeys.listnav && InboxKeys.listnav.syncEdgeAfterScroll) InboxKeys.listnav.syncEdgeAfterScroll(1);
      }),
      cmd("expand-message", () => InboxKeys.threadnav.toggleFocused()),
      cmd("expand-all", () => InboxKeys.threadnav.expandAllToggle()),
      cmd("next-page", () => InboxKeys.listnav.page(1)),
      cmd("prev-page", () => InboxKeys.listnav.page(-1)),
      cmd("next-tab", () => tabs.next()),
      cmd("prev-tab", () => tabs.prev()),
      cmd("back-to-list", () => gmail.back()),
      { id: "next-thread", title: "Next conversation", group: "Navigation", hint: "← / →", keys: [], contexts: ["threadView"], run: () => gmail.nextThread() },
      { id: "prev-thread", title: "Previous conversation", group: "Navigation", hint: "← / →", keys: [], contexts: ["threadView"], run: () => gmail.prevThread() },

      // Calendar (the 0 / 0 0 keys are special-cased in hotkeys.js; these rows
      // surface them in the palette with a hint).
      cmd("calendar-half", () => calendar.open("side"), "0"),
      cmd("calendar-tab", () => calendar.open("tab"), "0 0"),

      // Search
      cmd("search", () => {
        const box = document.querySelector(gmail.SEL.searchInput);
        if (box) {
          if (InboxKeys.hotkeys && InboxKeys.hotkeys.armSearchEditing) InboxKeys.hotkeys.armSearchEditing();
          box.focus();
        } else {
          gmail.setHash("search/");
        }
      }),
      cmd("mail-from-sender", () => mailFrom("sender")),
      cmd("mail-from-domain", () => mailFrom("domain")),

      // Help
      cmd("shortcuts-help", () => InboxKeys.cheatsheet.toggle(cheatsheetSpec)),
    ];
  }

  // ---- "?" cheat sheet ------------------------------------------------------
  // Keys the engine handles directly (hotkeys.js), which have no catalog row.
  const ENGINE_SECTIONS = [
    {
      title: "Command palette",
      rows: [
        { label: "Open the command palette", keys: ["Mod+K"] },
      ],
    },
    {
      title: "Message list",
      rows: [
        { label: "Move cursor down / up", keys: ["j", "k"] },
        { label: "Move cursor", keys: ["ArrowDown", "ArrowUp"] },
        { label: "Grow / shrink selection", keys: ["Shift+ArrowDown", "Shift+ArrowUp"] },
        { label: "Select row", keys: ["x"] },
        { label: "Open conversation", keys: ["Enter"] },
        { label: "Clear selection", keys: ["Escape"] },
      ],
    },
    {
      title: "Conversation",
      rows: [
        { label: "Next / previous conversation", keys: ["j", "k"] },
        { label: "Move between messages", keys: ["ArrowDown", "ArrowUp"] },
        { label: "Expand / collapse all", keys: [":"] },
        { label: "Leave reply, then back to list", keys: ["Escape"] },
      ],
    },
    {
      title: "Accounts",
      rows: [{ label: "Switch to account 0 to 8", keys: ["g 0", "g 8"] }],
    },
  ];

  const SHEET_GROUP_ORDER = ["Triage", "Compose", "Labels", "Go to", "Search", "Navigation", "Tabs", "Calendar", "Help"];

  // Built when the sheet opens, so remapped keys show as remapped.
  function cheatsheetSpec() {
    const groups = new Map();
    for (const c of buildBase()) {
      if (!c.keys || !c.keys.length) continue;
      if (!groups.has(c.group)) groups.set(c.group, []);
      groups.get(c.group).push({ label: c.title, keys: c.keys });
    }
    const ordered = [...groups.keys()].sort((a, b) => {
      const ia = SHEET_GROUP_ORDER.indexOf(a);
      const ib = SHEET_GROUP_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    const KM = window.InboxKeys_KEYMAP;
    const rawHotkey = storage.get("paletteHotkey") || "Mod+K";
    const hotkey = KM && typeof KM.normalizePaletteHotkey === "function" ? KM.normalizePaletteHotkey(rawHotkey) : rawHotkey;
    const paletteSection = { title: "Command palette", rows: [{ label: "Open the command palette", keys: [hotkey] }] };
    return {
      title: "Keyline keyboard shortcuts",
      sections: [paletteSection, ...ENGINE_SECTIONS.slice(1, 3), ...ordered.map((g) => ({ title: g, rows: groups.get(g) })), ENGINE_SECTIONS[3]],
      footer: "Remap any key in Keyline settings. Everything here is also in the command palette.",
    };
  }

  // Split-inbox tabs: a "Go to <tab>" row per saved tab.
  function tabCommands() {
    const list = (tabs && tabs.list && tabs.list()) || [];
    return list.map((tab) => ({
      id: `tab-${tab.id}`,
      title: `Go to tab: ${tab.name}`,
      hint: tab.type === "inbox" ? "Inbox" : tab.query,
      group: "Tabs",
      keys: [],
      contexts: InboxKeys_KEYMAP.DEFAULT_CONTEXTS,
      run: () => tabs.navigate(tab),
    }));
  }

  function settingsCommands() {
    return [
      {
        id: "inboxkeys-settings",
        title: "Keyline settings…",
        group: "Settings",
        keys: [],
        contexts: InboxKeys_KEYMAP.DEFAULT_CONTEXTS,
        run: () => tabs.openConfig("tabs"),
      },
      {
        id: "tabs-config",
        title: "Configure split inbox tabs...",
        group: "Settings",
        keys: [],
        contexts: InboxKeys_KEYMAP.DEFAULT_CONTEXTS,
        run: () => tabs.openConfig("tabs"),
      },
      {
        id: "shortcuts-config",
        title: "Configure keyboard shortcuts...",
        group: "Settings",
        keys: [],
        contexts: InboxKeys_KEYMAP.DEFAULT_CONTEXTS,
        run: () => tabs.openConfig("shortcuts"),
      },
      {
        // In-Gmail smoke probe over gmail.SEL: run when a shortcut stops
        // working — the toast/console name exactly which Gmail hook moved.
        id: "verify-selectors",
        title: "Verify Gmail selectors (smoke check)",
        group: "Settings",
        keys: [],
        contexts: InboxKeys_KEYMAP.DEFAULT_CONTEXTS,
        run: () => gmail.verifySelectors(),
      },
    ];
  }

  // One row per theme ("Theme: Clay (Claude-inspired)"), current one marked.
  // Applies instantly and syncs. Mirrors the Appearance pane in settings.
  function themeCommands() {
    const T = InboxKeys.theme;
    if (!T) return [];
    const cur = T.normalize(storage.get("theme"));
    return T.THEMES.map((t) => ({
      id: "theme:" + t.id,
      title: "Theme: " + T.label(t.id),
      group: "Appearance",
      hint: t.id === cur ? "current" : undefined,
      keys: [],
      contexts: InboxKeys_KEYMAP.DEFAULT_CONTEXTS,
      run: () => T.set(t.id).then(() => InboxKeys.toast("Theme: " + T.label(t.id))),
    }));
  }

  // Account switching: g 0 / g 1 / g 2 … map to /mail/u/N. The engine binds
  // g 0–g 8 unconditionally (hotkeys.js), so every signed-in account is reachable
  // by keyboard immediately. The MAIN-world bridge enumerates the real signed-in
  // account list from the OneGoogle bar (account-bridge.js → account-sync.js →
  // accountNames), so once it has run we know every account's email.
  function accountCommands() {
    const cur = gmail.accountIndex();
    const names = storage.get("accountNames") || {};
    const known = accounts.known();
    // Show exactly the accounts we know — every row carries an email, no useless
    // "account u/N" placeholders. Before enumeration lands (cold start), fall back
    // to the g 0–g 8 slots so switching still works immediately; emails appear on
    // the next palette open once the bridge has populated accountNames.
    let indices;
    if (known.length >= 2) {
      indices = known.map((a) => a.index);
      if (!indices.includes(cur)) indices.push(cur);
      indices = [...new Set(indices)].sort((a, b) => a - b);
    } else {
      indices = [];
      for (let i = 0; i <= 8; i++) indices.push(i);
    }
    const rows = indices.map((index) => {
      const email = names[String(index)];
      return {
        id: `acct-${index}`,
        title: email ? `Switch to ${email}` : `Switch to account u/${index}`,
        hint: index === cur ? "current" : `g ${index}`,
        group: "Accounts",
        keys: [`g ${index}`],
        contexts: InboxKeys_KEYMAP.DEFAULT_CONTEXTS,
        run: () => accounts.switchTo(index),
      };
    });
    rows.push({
      id: "accounts-config",
      title: "Configure accounts…",
      group: "Accounts",
      keys: [],
      contexts: InboxKeys_KEYMAP.DEFAULT_CONTEXTS,
      run: () => accounts.openConfig(),
    });
    return rows;
  }

  // ---- Cmd+K jump: labels, people, free-text search, recents --------------

  function hashRow(id, title, group, hash, extra) {
    return Object.assign(
      { id, title, group, keys: [], contexts: InboxKeys_KEYMAP.DEFAULT_CONTEXTS, hash, run: () => gmail.setHash(hash) },
      extra || {}
    );
  }

  // Rows that only make sense once you type: every label in the left nav and
  // every person on screen. Offered when the palette has a query, so the
  // default (empty) palette stays a short command list.
  function jumpCommands() {
    const labels = gmail.navLabels().map((l) => hashRow("label:" + l.name, "Go to label: " + l.name, "Labels", l.hash, { matchText: l.name }));
    const people = gmail.visiblePeople().map((p) =>
      hashRow(
        "person:" + p.email.toLowerCase(),
        "Conversations with " + p.name,
        "People",
        "search/" + encodeURIComponent(`from:${p.email} OR to:${p.email}`),
        { hint: p.name === p.email ? "" : p.email, searchText: p.email, matchText: p.name + " " + p.email }
      )
    );
    return [...labels, ...people];
  }

  // The always-last row for a typed query: run it as a Gmail search.
  function queryCommands(query) {
    const q = String(query || "").trim();
    if (!q) return [];
    return [hashRow("search-query:" + q, `Search mail for "${q}"`, "Search", "search/" + encodeURIComponent(q), { always: true })];
  }

  const RECENT_MAX = 8;

  // Recently run palette rows, most recent first, resolved against the live
  // registry (so keys and titles are current). A row that isn't in the live
  // registry (a label or person no longer on screen, a past search) comes back
  // from its saved hash, so recents survive navigation.
  function recent() {
    const saved = storage.get("paletteRecents") || [];
    const live = [...all(), ...jumpCommands()];
    const out = [];
    for (const r of saved) {
      if (!r || !r.id) continue;
      const hit = live.find((c) => c.id === r.id);
      if (hit) out.push(Object.assign({}, hit, { group: "Recent" }));
      else if (r.hash) out.push(hashRow(r.id, r.title, "Recent", r.hash));
    }
    return out;
  }

  function remember(cmd) {
    if (!cmd || !cmd.id) return;
    const entry = { id: cmd.id, title: typeof cmd.title === "function" ? cmd.title() : cmd.title };
    if (cmd.hash) entry.hash = cmd.hash;
    const prev = (storage.get("paletteRecents") || []).filter((r) => r && r.id !== cmd.id);
    storage.set({ paletteRecents: [entry, ...prev].slice(0, RECENT_MAX) });
  }

  // Built fresh each time the palette opens so tab/account/override state is current.
  function all() {
    return [...buildBase(), ...tabCommands(), ...settingsCommands(), ...themeCommands(), ...accountCommands(), ...extra];
  }

  // Allow late registration (e.g. from custom user config later).
  const extra = [];
  function register(cmd) {
    extra.push(cmd);
  }

  function byKeys() {
    const map = [];
    for (const cmd of all()) {
      for (const k of cmd.keys || []) map.push({ keys: k, cmd, contexts: cmd.contexts });
    }
    return map;
  }

  // `base` is kept as a getter so callers always see current overrides applied.
  InboxKeys.commands = {
    all,
    jumpCommands,
    queryCommands,
    recent,
    remember,
    cheatsheetSpec,
    register,
    byKeys,
    get base() {
      return buildBase();
    },
  };
})();
