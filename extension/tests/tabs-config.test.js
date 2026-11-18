const assert = require("node:assert/strict");
const { tryLoadContentScripts } = require("./helpers.js");

if (!tryLoadContentScripts("")) {
  console.log("tabs config tests skipped (jsdom not installed - run: npm install)");
  process.exit(0);
}

function load() {
  const w = tryLoadContentScripts('<div role="main"></div>');
  w.InboxKeys.storage.cache = {
    ...w.InboxKeys.DEFAULTS,
    tabs: w.InboxKeys.DEFAULTS.tabs.map((tab) => ({ ...tab })),
    keyOverrides: {},
  };
  return w;
}

function openModal(w, pane) {
  w.InboxKeys.tabs.openConfig(pane);
  return w.document.querySelector(".inboxkeys-cfg");
}

function click(w, el) {
  el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
}

function input(w, el, value) {
  el.value = value;
  el.dispatchEvent(new w.Event("input", { bubbles: true }));
}

function keydown(w, key, opts = {}) {
  w.document.dispatchEvent(
    new w.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      metaKey: !!opts.metaKey,
      ctrlKey: !!opts.ctrlKey,
      altKey: !!opts.altKey,
      shiftKey: !!opts.shiftKey,
    })
  );
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

(async () => {
  {
    const w = load();
    const modal = openModal(w);

    assert.ok(modal, "settings modal should render");
    assert.ok(modal.querySelector('[data-settings-tab="tabs"]'), "settings modal should have a tabs section tab");
    assert.ok(modal.querySelector('[data-settings-tab="shortcuts"]'), "settings modal should have a keyboard shortcuts section tab");
    assert.equal(modal.querySelector('[data-settings-panel="tabs"]').hidden, false, "tabs settings should be the default full modal view");
    assert.equal(modal.querySelector('[data-settings-panel="shortcuts"]').hidden, true, "shortcut settings should not share the same view by default");
    click(w, modal.querySelector('[data-settings-tab="shortcuts"]'));
    assert.equal(modal.querySelector('[data-settings-panel="tabs"]').hidden, true, "tabs panel should hide when shortcuts tab is active");
    assert.equal(modal.querySelector('[data-settings-panel="shortcuts"]').hidden, false, "shortcut settings should be a full modal tab view");
    assert.ok(modal.querySelector('.inboxkeys-shortcut-search[type="search"]'), "shortcuts should be searchable");
    assert.ok(modal.querySelector('[data-id="archive"]'), "shortcut list should include command rows");
  }

  {
    const w = load();
    const modal = openModal(w, "shortcuts");
    input(w, modal.querySelector(".inboxkeys-shortcut-search"), "star");

    const rows = Array.from(modal.querySelectorAll(".inboxkeys-shortcut-row"));
    assert.ok(rows.length >= 1, "search should leave matching shortcut rows");
    assert.ok(rows.some((row) => /star/i.test(row.textContent)), "search should match shortcut titles");
    assert.equal(rows.some((row) => /Compose new email/i.test(row.textContent)), false, "search should filter unrelated shortcuts");
    assert.match(modal.querySelector(".inboxkeys-shortcut-count").textContent, /shown/);
  }

  {
    const w = load();
    const modal = openModal(w, "shortcuts");
    input(w, modal.querySelector(".inboxkeys-shortcut-search"), w.InboxKeys_KEYMAP.modLabel().toLowerCase());

    const rows = Array.from(modal.querySelectorAll(".inboxkeys-shortcut-row"));
    assert.ok(rows.some((row) => /(Cmd|Ctrl)\+U/.test(row.textContent)), "search should match visible Command/Ctrl shortcut labels");
  }

  {
    const w = load();
    const modal = openModal(w, "shortcuts");
    const archiveRow = modal.querySelector('[data-id="archive"]');
    click(w, archiveRow.querySelector(".inboxkeys-shortcut-keys"));
    keydown(w, "q");

    assert.deepEqual(w.InboxKeys.storage.get("keyOverrides"), {}, "recording should not persist until Save is clicked");

    click(w, modal.querySelector(".inboxkeys-cfg-save"));
    await flush();

    assert.equal(w.InboxKeys.storage.get("keyOverrides").archive[0], "q", "Save should persist the recorded shortcut");
  }

  {
    const w = load();
    const modal = openModal(w, "shortcuts");
    const archiveRow = modal.querySelector('[data-id="archive"]');
    click(w, archiveRow.querySelector(".inboxkeys-shortcut-keys"));
    keydown(w, "e", { ctrlKey: true });

    click(w, modal.querySelector(".inboxkeys-cfg-save"));
    await flush();

    assert.equal(w.InboxKeys.storage.get("keyOverrides").archive[0], "Ctrl+e", "recorder should persist Ctrl plus letter shortcuts");
  }

  {
    const w = load();
    const modal = openModal(w, "shortcuts");
    const fixed = modal.querySelector('[data-id="attach-file"] .inboxkeys-shortcut-keys');

    assert.equal(fixed.disabled, true, "engine-owned shortcuts should be read-only");
    assert.equal(/Mod/.test(fixed.textContent), false, "visible shortcut chips should not show abstract Mod");
    assert.match(fixed.textContent, /(Cmd|Ctrl)\+U/, "visible shortcut chips should show platform-specific Command/Ctrl text");
  }

  {
    const w = load();
    const modal = openModal(w, "shortcuts");
    const archiveRow = modal.querySelector('[data-id="archive"]');
    click(w, archiveRow.querySelector(".inboxkeys-shortcut-keys"));
    keydown(w, "0");

    click(w, modal.querySelector(".inboxkeys-cfg-save"));
    await flush();

    assert.equal(w.InboxKeys.storage.get("keyOverrides").archive, undefined, "reserved fixed shortcuts should not be stolen");
  }

  {
    const w = load();
    w.InboxKeys.storage.cache = {
      ...w.InboxKeys.storage.cache,
      keyOverrides: { archive: ["q"], compose: ["x"] },
    };
    const modal = openModal(w, "shortcuts");

    click(w, modal.querySelector(".inboxkeys-shortcut-reset-all"));
    click(w, modal.querySelector(".inboxkeys-cfg-save"));
    await flush();

    assert.equal(Object.keys(w.InboxKeys.storage.get("keyOverrides")).length, 0, "reset all should clear shortcut overrides on Save");
  }

  {
    const w = load();
    const settings = w.InboxKeys.commands.all().find((cmd) => cmd.id === "inboxkeys-settings");
    const shortcuts = w.InboxKeys.commands.all().find((cmd) => cmd.id === "shortcuts-config");

    assert.ok(settings, "Command palette should include a Keyline settings command");
    assert.equal(settings.title, "Keyline settings…", "the palette settings command is branded Keyline");
    assert.ok(shortcuts, "Command palette should include a keyboard shortcuts settings command");

    shortcuts.run();
    const modal = w.document.querySelector(".inboxkeys-cfg");
    assert.ok(modal, "settings command should open the in-Gmail settings modal");
    assert.equal(modal.querySelector(".inboxkeys-cfg-title").textContent, "Keyline settings", "settings modal title is branded Keyline");
    assert.doesNotMatch(modal.outerHTML, />[^<]*Inbox ?Keys|"[^"]*Inbox ?Keys[^"]*"/, "settings modal text and labels never say InboxKeys");
    const gear = w.document.querySelector(".inboxkeys-tab-gear");
    if (gear) assert.equal(gear.getAttribute("aria-label"), "Configure Keyline tabs");
    assert.equal(modal.querySelector('[data-settings-panel="shortcuts"]').hidden, false, "keyboard shortcuts command should open the shortcuts tab");
  }

  {
    const w = load();
    assert.equal(/Mod/.test(w.InboxKeys_KEYMAP.displayBinding("Mod+K")), false, "display helper should not expose Mod");
    assert.match(w.InboxKeys_KEYMAP.displayBinding("Mod+K"), /^(Cmd|Ctrl)\+K$/);
    w.InboxKeys.palette.show();
    assert.equal(/Mod/.test(w.document.querySelector(".inboxkeys-prompt").textContent), false, "Command K prompt should not show Mod");
  }

  // Save shows a checkmark first, then closes the modal after savedCloseMs.
  {
    const w = load();
    w.InboxKeys.tabs.savedCloseMs = 30;
    let toasts = [];
    w.InboxKeys.toast = (m) => toasts.push(m);
    let sets = 0;
    const realSet = w.InboxKeys.storage.set.bind(w.InboxKeys.storage);
    w.InboxKeys.storage.set = (patch) => { sets++; return realSet(patch); };
    const modal = openModal(w, "shortcuts");
    click(w, modal.querySelector('[data-id="archive"] .inboxkeys-shortcut-keys'));
    keydown(w, "q");
    const save = modal.querySelector(".inboxkeys-cfg-save");
    click(w, save);
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(w.InboxKeys.storage.get("keyOverrides").archive[0], "q", "Save persists before the checkmark");
    assert.ok(w.document.querySelector(".inboxkeys-cfg"), "modal stays open while the checkmark shows");
    assert.equal(save.dataset.state, "saved");
    assert.ok(save.classList.contains("inboxkeys-cfg-save--saved"), "Save turns into the saved state");
    assert.ok(save.querySelector("svg.inboxkeys-cfg-save-check path"), "a checkmark replaces the label");
    assert.equal(save.getAttribute("aria-label"), "Saved", "screen readers hear Saved");
    assert.equal(modal.querySelector(".inboxkeys-cfg-cancel").disabled, true, "Cancel can't undo a finished save");
    assert.deepEqual(toasts, [], "the checkmark replaces the old toast");

    assert.equal(sets, 1);
    click(w, save);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(sets, 1, "a second click during the checkmark doesn't save again");

    await new Promise((r) => setTimeout(r, 60));
    assert.equal(w.document.querySelector(".inboxkeys-cfg"), null, "modal closes on its own after the checkmark");

    // A fresh modal starts with a plain Save button and isn't closed by a stale timer.
    const again = openModal(w, "shortcuts");
    const save2 = again.querySelector(".inboxkeys-cfg-save");
    assert.equal(save2.textContent, "Save");
    assert.equal(save2.dataset.state, undefined);
    w.close();
  }

  // Esc during the checkmark closes right away, and the pending timer can't
  // close a modal opened afterwards.
  {
    const w = load();
    w.InboxKeys.tabs.savedCloseMs = 30;
    const modal = openModal(w, "tabs");
    click(w, modal.querySelector(".inboxkeys-cfg-save"));
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(w.document.querySelector(".inboxkeys-cfg"), "checkmark showing");
    keydown(w, "Escape");
    assert.equal(w.document.querySelector(".inboxkeys-cfg"), null, "Esc closes immediately");
    openModal(w, "tabs");
    await new Promise((r) => setTimeout(r, 60));
    assert.ok(w.document.querySelector(".inboxkeys-cfg"), "the old timer doesn't close the new modal");
    w.close();
  }

  // A failed write keeps the modal open, restores Save, and says so.
  {
    const w = load();
    const toasts = [];
    w.InboxKeys.toast = (m) => toasts.push(m);
    w.InboxKeys.storage.set = async () => { throw new Error("quota"); };
    const origWarn = console.warn;
    console.warn = () => {};
    const modal = openModal(w, "shortcuts");
    const save = modal.querySelector(".inboxkeys-cfg-save");
    click(w, save);
    await new Promise((r) => setTimeout(r, 0));
    console.warn = origWarn;
    assert.ok(w.document.querySelector(".inboxkeys-cfg"), "modal stays open on failure");
    assert.equal(save.dataset.state, undefined, "Save is clickable again");
    assert.equal(save.classList.contains("inboxkeys-cfg-save--saved"), false, "no checkmark on failure");
    assert.match(toasts.join(" "), /Couldn't save/);
    w.close();
  }

  // Reduced motion drops the morph and draw animation, not the checkmark.
  {
    const fs = require("node:fs");
    const css = fs.readFileSync(require("node:path").join(__dirname, "../src/content/palette.css"), "utf8");
    const rm = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    assert.ok(rm.length > 40, "palette.css has a reduced-motion block");
    assert.match(rm, /inboxkeys-cfg-save[^}]*transition: none/);
    assert.match(rm, /inboxkeys-cfg-save-check path[^}]*animation: none/);
  }

  console.log("tabs config tests passed");
})();
