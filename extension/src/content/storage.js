// Namespaced globals shared across the content scripts.
window.InboxKeys = window.InboxKeys || {};

(function () {
  const DEFAULTS = {
    enabled: true,
    paletteHotkey: "mod+k", // Cmd+K on mac, Ctrl+K elsewhere
    hotkeysEnabled: true,
    accountNames: {}, // { "0": "work@x.com", "1": "me@gmail.com" }
    tabsEnabled: true, // split-inbox tab bar at the top of Gmail
    calendarEnabled: true, // the 0 / 00 calendar shortcut
    calendarFeeds: [], // ICS/Outlook feed URLs added through the unified-calendar layer
    calendarNudgeDismissed: false, // user dismissed the "add more calendars" nudge
    keyOverrides: {}, // { commandId: ["e"] } — per-command key remaps
    // Gmail's own keyboard shortcuts are on: in an open thread, let the real
    // keystroke reach Gmail for the keys it already handles natively (see
    // NATIVE_THREAD_KEYS in hotkeys.js) instead of driving its toolbar.
    gmailNativeShortcuts: false,
    // After archive/delete/snooze/spam/mute in an open conversation, open the
    // next (older) conversation instead of returning to the list.
    autoAdvance: true,
    // Focus mode: Gmail's side panes hidden so the list/thread fills the
    // window (see focus.js). Syncs like other preferences.
    focusMode: false,
    // UI theme for every Keyline surface (see src/shared/theme.js). Syncs.
    theme: "keyline",
    // The contact sidebar ("i") stays open across conversations once opened.
    contactSidebar: false,
    // Cmd+K "recent" rows: [{ id, title, group, hash? }], most recent first.
    paletteRecents: [],
    // Gmail's Undo Send window per account ({ "me@x.com": 30 }), learned from
    // Settings > General or set from Cmd+K. Only feeds the countdown chip.
    undoSendWindows: {},
    // Split-inbox tabs. Each tab is a saved Gmail search; "inbox" is the special
    // landing tab. The user edits these from the gear in the tab bar.
    tabs: [
      { id: "inbox", name: "Inbox", type: "inbox", query: "" },
      { id: "unread", name: "Unread", type: "search", query: "in:inbox is:unread" },
      { id: "important", name: "Important", type: "search", query: "in:inbox is:important" },
      { id: "starred", name: "Starred", type: "search", query: "in:inbox is:starred" },
      { id: "attachments", name: "Attachments", type: "search", query: "in:inbox has:attachment" },
    ],
  };

  const TAB_QUERY_MIGRATIONS = {
    unread: { from: "is:unread", to: "in:inbox is:unread" },
    important: { from: "is:important", to: "in:inbox is:important" },
    starred: { from: "is:starred", to: "in:inbox is:starred" },
    attachments: { from: "has:attachment", to: "in:inbox has:attachment" },
  };

  function normalizeTabs(value) {
    if (!Array.isArray(value)) return value;
    let changed = false;
    const tabs = value.map((tab) => {
      const migration = tab && TAB_QUERY_MIGRATIONS[tab.id];
      if (!migration || tab.type !== "search" || tab.query !== migration.from) return tab;
      changed = true;
      return { ...tab, query: migration.to };
    });
    return changed ? tabs : value;
  }

  // Settings sync. Everything in DEFAULTS lives in chrome.storage.sync (the
  // browser's own sync: no Keyline account, no server, just the `storage`
  // permission) EXCEPT the keys below, which describe this machine rather than
  // your preferences. accountNames maps /u/N to an email, and N depends on the
  // order you signed in on each machine; paletteRecents changes on every palette
  // run and would burn the sync write quota. New settings sync by default.
  const LOCAL_ONLY = new Set(["accountNames", "paletteRecents", "undoSendWindows"]);
  const SYNC_KEYS = Object.keys(DEFAULTS).filter((k) => !LOCAL_ONLY.has(k));
  // Bookkeeping, always in chrome.storage.local:
  //   syncMigrated  this machine has copied its pre-sync settings into sync once
  //   syncOverflow  sync keys that could not be written to sync (too big, quota,
  //                 rate limit) and are kept in local instead until a later write
  //                 to sync succeeds
  const MIGRATED = "syncMigrated";
  const OVERFLOW = "syncOverflow";
  // keyOverrides is the one object where merging two machines is unambiguous
  // (one entry per command); every other key takes the synced value whole.
  const MERGE_ON_MIGRATE = new Set(["keyOverrides"]);

  function syncArea() {
    const s = typeof chrome !== "undefined" && chrome.storage && chrome.storage.sync;
    return s && typeof s.get === "function" && typeof s.set === "function" ? s : null;
  }

  // chrome.storage.sync.QUOTA_BYTES_PER_ITEM counts the key plus the JSON value.
  function itemBytes(key, value) {
    try {
      // UTF-8 byte length without TextEncoder (keeps this usable everywhere).
      const str = key + JSON.stringify(value);
      return encodeURIComponent(str).replace(/%[0-9A-F]{2}/gi, "x").length;
    } catch {
      return Infinity;
    }
  }

  const storage = {
    cache: { ...DEFAULTS },
    overflow: new Set(),

    isSyncKey(key) {
      return SYNC_KEYS.includes(key);
    },

    // Write sync keys to chrome.storage.sync. Any key sync refuses (too large,
    // total quota, write-rate limit, sync unavailable) is kept in local and
    // remembered in syncOverflow so it still persists on this machine and wins
    // on load. A key that later writes to sync fine leaves the overflow list.
    async writeSync(patch) {
      const keys = Object.keys(patch);
      if (!keys.length) return { synced: [], overflowed: [] };
      const sync = syncArea();
      const perItem = (sync && sync.QUOTA_BYTES_PER_ITEM) || 8192;
      const synced = [];
      const overflowed = [];
      const fits = {};
      for (const k of keys) {
        if (sync && itemBytes(k, patch[k]) <= perItem) fits[k] = patch[k];
        else overflowed.push(k);
      }
      if (Object.keys(fits).length) {
        try {
          await sync.set(fits);
          synced.push(...Object.keys(fits));
        } catch (err) {
          // All-or-nothing failed; retry one key at a time so only the key that
          // does not fit falls back to local.
          for (const k of Object.keys(fits)) {
            try {
              await sync.set({ [k]: fits[k] });
              synced.push(k);
            } catch {
              overflowed.push(k);
            }
          }
          console.warn("[Keyline] settings sync write failed:", err && err.message);
        }
      }
      const before = this.overflow.size;
      const hadOverflow = synced.some((k) => this.overflow.has(k));
      synced.forEach((k) => this.overflow.delete(k));
      overflowed.forEach((k) => this.overflow.add(k));
      const localPatch = {};
      overflowed.forEach((k) => (localPatch[k] = patch[k]));
      if (overflowed.length || hadOverflow || this.overflow.size !== before) {
        localPatch[OVERFLOW] = [...this.overflow];
      }
      if (Object.keys(localPatch).length) await chrome.storage.local.set(localPatch);
      if (overflowed.length) {
        const msg = "Some Keyline settings couldn't sync and are saved on this computer only";
        console.warn("[Keyline] " + msg + ":", overflowed.join(", "));
        if (InboxKeys.toast) InboxKeys.toast(msg);
      }
      return { synced, overflowed };
    },

    async load() {
      const sync = syncArea();
      const local = await chrome.storage.local.get([...Object.keys(DEFAULTS), MIGRATED, OVERFLOW]);
      let synced = {};
      if (sync) {
        try {
          synced = (await sync.get(SYNC_KEYS)) || {};
        } catch (err) {
          console.warn("[Keyline] settings sync read failed, using local:", err && err.message);
        }
      }
      this.overflow = new Set(Array.isArray(local[OVERFLOW]) ? local[OVERFLOW] : []);

      // One-time migration: copy this machine's pre-sync settings into sync.
      // A key another machine already synced wins (keyOverrides merges, synced
      // entries winning per command), so installing on a second machine adopts
      // your synced setup instead of clobbering it with that machine's leftovers.
      if (sync && !local[MIGRATED]) {
        const push = {};
        for (const k of SYNC_KEYS) {
          if (!(k in local) || this.overflow.has(k)) continue;
          if (!(k in synced)) push[k] = local[k];
          else if (MERGE_ON_MIGRATE.has(k) && local[k] && typeof local[k] === "object") {
            const merged = { ...local[k], ...synced[k] };
            if (JSON.stringify(merged) !== JSON.stringify(synced[k])) push[k] = merged;
          }
        }
        const { synced: ok } = await this.writeSync(push);
        ok.forEach((k) => (synced[k] = push[k]));
        await chrome.storage.local.set({ [MIGRATED]: true });
      }

      const merged = { ...DEFAULTS };
      for (const k of Object.keys(DEFAULTS)) {
        if (LOCAL_ONLY.has(k) || !sync) {
          if (k in local) merged[k] = local[k];
        } else if (this.overflow.has(k)) {
          if (k in local) merged[k] = local[k];
        } else if (k in synced) {
          merged[k] = synced[k];
        }
      }
      const tabs = normalizeTabs(merged.tabs);
      const tabsChanged = tabs !== merged.tabs;
      this.cache = { ...merged, tabs };
      if (tabsChanged) await this.persist({ tabs });
      return this.cache;
    },

    get(key) {
      return this.cache[key];
    },

    // Keys this machine could not sync (see writeSync).
    unsynced() {
      return [...this.overflow];
    },

    async persist(patch) {
      const syncPatch = {};
      const localPatch = {};
      const useSync = !!syncArea();
      for (const [k, v] of Object.entries(patch)) {
        if (useSync && this.isSyncKey(k)) syncPatch[k] = v;
        else localPatch[k] = v;
      }
      if (Object.keys(localPatch).length) await chrome.storage.local.set(localPatch);
      await this.writeSync(syncPatch);
    },

    async set(patch) {
      this.cache = { ...this.cache, ...patch };
      await this.persist(patch);
      return this.cache;
    },

    // cb(cache, changes) fires for setting changes from any tab, the popup, the
    // options page, or another machine via sync. Each key is read from the area
    // that currently owns it, so a stale copy in the other area is ignored.
    onChange(cb) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" && area !== "sync") return;
        if (area === "local" && changes[OVERFLOW]) {
          const next = changes[OVERFLOW].newValue;
          const prev = this.overflow;
          this.overflow = new Set(Array.isArray(next) ? next : []);
          // A key that just went back to syncing may have had its sync change
          // event arrive before this one (and been ignored as local-owned), so
          // re-read it from sync.
          const back = [...prev].filter((k) => !this.overflow.has(k) && this.isSyncKey(k));
          const sync = syncArea();
          if (back.length && sync) {
            Promise.resolve(sync.get(back))
              .then((vals) => {
                const applied = {};
                for (const k of back) {
                  if (!vals || !(k in vals)) continue;
                  applied[k] = { oldValue: this.cache[k], newValue: vals[k] };
                  this.cache[k] = vals[k];
                }
                if (Object.keys(applied).length) cb(this.cache, applied);
              })
              .catch(() => {});
          }
        }
        const useSync = !!syncArea();
        const applied = {};
        for (const [k, v] of Object.entries(changes)) {
          if (!(k in DEFAULTS)) continue;
          const syncOwned = useSync && this.isSyncKey(k) && !this.overflow.has(k);
          if ((area === "sync") !== syncOwned) continue;
          this.cache[k] = v.newValue === undefined ? DEFAULTS[k] : v.newValue;
          applied[k] = v;
        }
        if (Object.keys(applied).length) cb(this.cache, applied);
      });
    },
  };

  InboxKeys.storage = storage;
  InboxKeys.DEFAULTS = DEFAULTS;
  InboxKeys.storage.LOCAL_ONLY = LOCAL_ONLY;
  InboxKeys.storage.SYNC_KEYS = SYNC_KEYS;
})();
