const $ = (id) => document.getElementById(id);
const FIELDS = {
  enabled: "checkbox",
  hotkeysEnabled: "checkbox",
  tabsEnabled: "checkbox",
  calendarEnabled: "checkbox",
  gmailNativeShortcuts: "checkbox",
  autoAdvance: "checkbox",
};
const DEFAULT_ON = new Set(["enabled", "hotkeysEnabled", "tabsEnabled", "calendarEnabled", "autoAdvance"]);
const settings = window.InboxKeys.storage;

function renderSyncStatus() {
  const el = $("sync-status");
  if (!el) return;
  const unsynced = settings.unsynced();
  el.textContent = unsynced.length
    ? `Saved on this computer only (could not sync): ${unsynced.join(", ")}`
    : "";
}

function flashSaved() {
  $("saved").textContent = "Saved";
  clearTimeout(flashSaved._t);
  flashSaved._t = setTimeout(() => ($("saved").textContent = ""), 1200);
}

async function load() {
  // Settings go through the content scripts' storage module, so the options
  // page reads and writes the same areas (chrome.storage.sync for preferences,
  // local for per-machine data) as Gmail and Calendar.
  const s = await settings.load();
  // Keep the cache current while the page is open (Gmail, the popup or another
  // computer may change settings), so read-modify-write edits start fresh.
  if (!load.listening) {
    settings.onChange((cache, changes) => {
      renderSyncStatus();
      if (changes && changes.theme) renderThemes(cache.theme);
    });
  }
  load.listening = true;
  for (const [k, kind] of Object.entries(FIELDS)) {
    const el = $(k);
    if (!el) continue;
    if (kind === "checkbox") el.checked = s[k] ?? DEFAULT_ON.has(k);
    else el.value = s[k] ?? "";
  }
  renderSyncStatus();
  renderThemes(s.theme);
  renderAccounts(s.accountNames || {});
  renderTabs(s.tabs);
  keymapOverrides = s.keyOverrides || {};
  renderKeymap();
  paletteHotkey = normalizePalette(s.paletteHotkey);
  renderPaletteHotkey();
}

// ---- Theme ----------------------------------------------------------------
// One card per theme (src/shared/theme.js). Clicking applies it to this page at
// once and saves it; Gmail and Calendar tabs pick it up through storage.onChange.

function renderThemes(current) {
  const T = window.InboxKeys.theme;
  const wrap = $("themes");
  if (!T || !wrap) return;
  const cur = T.apply(current);
  wrap.textContent = "";
  for (const t of T.THEMES) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "theme-card" + (t.id === cur ? " active" : "");
    card.dataset.theme = t.id;
    card.setAttribute("role", "radio");
    card.setAttribute("aria-checked", t.id === cur ? "true" : "false");
    const [bg, text, accent] = t.swatch;
    const preview = document.createElement("span");
    preview.className = "theme-preview";
    preview.style.setProperty("--sw-bg", bg);
    preview.style.setProperty("--sw-text", text);
    preview.style.setProperty("--sw-accent", accent);
    preview.innerHTML = `<span class="theme-preview-bar"></span><span class="theme-preview-dot"></span>`;
    const head = document.createElement("span");
    const name = document.createElement("span");
    name.className = "theme-name";
    name.textContent = t.name;
    const insp = document.createElement("span");
    insp.className = "theme-inspired";
    insp.textContent = t.inspired ? `${t.inspired}-inspired` : "Default";
    head.append(name, insp);
    const note = document.createElement("span");
    note.className = "theme-note";
    note.textContent = t.note;
    card.append(preview, head, note);
    card.addEventListener("click", async () => {
      await T.set(t.id, settings);
      renderThemes(t.id);
      flashSaved();
    });
    wrap.appendChild(card);
  }
}

// ---- Command palette hotkey ----------------------------------------------
// One modified key (Cmd/Ctrl/Option + key), stored as storage.paletteHotkey.
// Recorded here with the same rules the content scripts match with (keymap.js).

let paletteHotkey = "Mod+K";
let paletteRecording = false;
const PALETTE_HINT = $("paletteHotkeyHint") ? $("paletteHotkeyHint").innerHTML : "";

function normalizePalette(v) {
  const KM = window.InboxKeys_KEYMAP;
  return KM && typeof KM.normalizePaletteHotkey === "function" ? KM.normalizePaletteHotkey(v) : String(v || "Mod+K");
}

function renderPaletteHotkey(error) {
  const cell = $("paletteHotkeyCell");
  if (!cell) return;
  cell.classList.toggle("km-recording", paletteRecording);
  cell.innerHTML = paletteRecording
    ? `<span class="km-listening">Press a shortcut…</span>`
    : keyChips(paletteHotkey);
  const KM = window.InboxKeys_KEYMAP;
  $("paletteHotkeyReset").disabled = paletteHotkey === ((KM && KM.PALETTE_DEFAULT) || "Mod+K");
  const hint = $("paletteHotkeyHint");
  hint.classList.toggle("palette-key-error", !!error);
  if (error) hint.textContent = error;
  else hint.innerHTML = PALETTE_HINT;
}

function startPaletteRecording() {
  if (paletteRecording) return;
  cancelRecording();
  paletteRecording = true;
  renderPaletteHotkey();
  window.addEventListener("keydown", onPaletteRecordKey, true);
  setTimeout(() => window.addEventListener("mousedown", onPaletteRecordOutside, true), 0);
}

function stopPaletteRecording(error) {
  paletteRecording = false;
  window.removeEventListener("keydown", onPaletteRecordKey, true);
  window.removeEventListener("mousedown", onPaletteRecordOutside, true);
  renderPaletteHotkey(error);
}

function onPaletteRecordOutside(e) {
  if ($("paletteHotkeyCell").contains(e.target)) return;
  stopPaletteRecording();
}

function onPaletteRecordKey(e) {
  if (!paletteRecording) return;
  e.preventDefault();
  e.stopPropagation();
  const KM = window.InboxKeys_KEYMAP;
  if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey) {
    stopPaletteRecording();
    return;
  }
  const binding = KM.paletteBindingFromEvent(e);
  if (!binding) return; // lone modifier: keep listening
  const problem = KM.paletteHotkeyProblem(binding, keymapOverrides);
  if (problem) {
    stopPaletteRecording(problem);
    return;
  }
  savePaletteHotkey(binding);
}

async function savePaletteHotkey(binding) {
  paletteHotkey = normalizePalette(binding);
  await settings.set({ paletteHotkey });
  stopPaletteRecording();
  flashSaved();
}

// ---- Keyboard shortcut editor -------------------------------------------
// Reads the shared catalog (window.InboxKeys_KEYMAP) + keyOverrides and lets you
// rebind any non-fixed command. Bindings persist as keyOverrides[id] = ["e"].

let keymapOverrides = {}; // { commandId: ["e"] }  in-memory mirror of storage
let recording = null; // active recorder state, or null

// Effective keys for a command: its override if present, else defaultKeys.
function effKeys(cmd) {
  const KM = window.InboxKeys_KEYMAP;
  if (KM && typeof KM.keysFor === "function") return KM.keysFor(cmd.id, keymapOverrides) || [];
  return keymapOverrides[cmd.id] || cmd.defaultKeys || [];
}

// Render a single binding ("g i") as separate [g][i] chips.
function keyChips(binding) {
  const display = window.InboxKeys_KEYMAP && typeof InboxKeys_KEYMAP.displayBinding === "function"
    ? InboxKeys_KEYMAP.displayBinding(binding)
    : String(binding || "");
  return display
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `<kbd>${escapeHtml(part)}</kbd>`)
    .join("");
}

function renderKeymap() {
  const wrap = $("keymap");
  const KM = window.InboxKeys_KEYMAP;
  if (!KM || !Array.isArray(KM.commands)) {
    wrap.innerHTML = `<p class="muted">Shortcut catalog not loaded. Reload the extension (chrome://extensions → reload) and reopen this page.</p>`;
    return;
  }
  const filter = ($("keymapSearch").value || "").trim().toLowerCase();
  // Group commands by their group label, preserving catalog order.
  const groups = [];
  const byGroup = new Map();
  for (const cmd of KM.commands) {
    const g = cmd.group || "Other";
    if (!byGroup.has(g)) {
      byGroup.set(g, []);
      groups.push(g);
    }
    byGroup.get(g).push(cmd);
  }

  wrap.innerHTML = "";
  let shown = 0;
  for (const g of groups) {
    const rows = byGroup.get(g).filter((cmd) => {
      if (!filter) return true;
      const keys = effKeys(cmd);
      const displayKeys = window.InboxKeys_KEYMAP && typeof InboxKeys_KEYMAP.displayBinding === "function"
        ? keys.map((key) => InboxKeys_KEYMAP.displayBinding(key))
        : keys;
      const hay = (cmd.title + " " + g + " " + keys.join(" ") + " " + displayKeys.join(" ")).toLowerCase();
      return hay.includes(filter);
    });
    if (!rows.length) continue;

    const head = document.createElement("div");
    head.className = "km-group";
    head.textContent = g;
    wrap.appendChild(head);

    for (const cmd of rows) {
      shown++;
      wrap.appendChild(buildKeymapRow(cmd));
    }
  }
  if (!shown) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = filter ? "No shortcuts match your filter." : "No shortcuts.";
    wrap.appendChild(empty);
  }
}

function buildKeymapRow(cmd) {
  const row = document.createElement("div");
  row.className = "km-row";
  row.dataset.id = cmd.id;

  const title = document.createElement("div");
  title.className = "km-title";
  title.textContent = cmd.title;
  if (cmd.fixed) {
    const tag = document.createElement("span");
    tag.className = "km-builtin";
    tag.textContent = "built-in";
    title.appendChild(tag);
  }
  row.appendChild(title);

  const keysCell = document.createElement("div");
  keysCell.className = "km-keys";
  const eff = effKeys(cmd);
  if (cmd.fixed) {
    keysCell.classList.add("km-fixed");
    keysCell.innerHTML = eff.length
      ? eff.map(keyChips).join('<span class="km-or">or</span>')
      : '<span class="km-none">—</span>';
  } else {
    keysCell.classList.add("km-editable");
    keysCell.title = "Click to record a new shortcut";
    keysCell.innerHTML = eff.length
      ? eff.map(keyChips).join('<span class="km-or">or</span>')
      : '<span class="km-none">not set</span>';
    keysCell.addEventListener("click", () => startRecording(cmd, keysCell, row));
  }
  row.appendChild(keysCell);

  const tools = document.createElement("div");
  tools.className = "km-tools";
  if (!cmd.fixed) {
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "km-reset";
    reset.title = "Reset to default";
    reset.textContent = "↺";
    const isOverridden = Array.isArray(keymapOverrides[cmd.id]);
    reset.disabled = !isOverridden;
    reset.addEventListener("click", (e) => {
      e.stopPropagation();
      resetBinding(cmd.id);
    });
    tools.appendChild(reset);
  }
  row.appendChild(tools);

  return row;
}

// Returns { id, title } of the FIRST other command whose effective keys
// already include `binding`, or null when free.
function findCollision(binding, selfId) {
  const KM = window.InboxKeys_KEYMAP;
  for (const cmd of KM.commands) {
    if (cmd.id === selfId) continue;
    if (effKeys(cmd).includes(binding)) return cmd;
  }
  return null;
}

// --- Recording a keystroke / chord ---------------------------------------

function startRecording(cmd, cell, row) {
  cancelRecording(); // only one recorder at a time
  recording = { cmd, cell, row, parts: [], chordTimer: null, banner: null };
  cell.classList.add("km-recording");
  cell.innerHTML = `<span class="km-listening">Listening for keys…</span>`;
  // Capture-phase so we beat any page handlers; prevent the key reaching inputs.
  window.addEventListener("keydown", onRecordKey, true);
  // Clicking elsewhere (blur) commits whatever's been captured so far.
  setTimeout(() => window.addEventListener("mousedown", onRecordOutside, true), 0);
}

function renderRecordingChips() {
  if (!recording) return;
  const chips = recording.parts.map((p) => `<kbd>${escapeHtml(p)}</kbd>`).join("");
  const arming = recording.chordTimer ? '<span class="km-listening"> …</span>' : "";
  recording.cell.innerHTML = chips + arming || `<span class="km-listening">Listening for keys…</span>`;
}

function onRecordKey(e) {
  if (!recording) return;
  e.preventDefault();
  e.stopPropagation();

  const key = e.key;
  if (key === "Escape") {
    cancelRecording();
    return;
  }
  if (key === "Enter") {
    commitRecording();
    return;
  }
  // Ignore lone modifier presses; we capture them as part of the chord below.
  if (key === "Shift" || key === "Control" || key === "Alt" || key === "Meta") return;

  const token = keyToken(e);
  if (!token) return;

  // Chord mode: a leading bare "g" arms ~800ms to capture a second key.
  if (recording.parts.length === 0 && token === "g") {
    recording.parts.push("g");
    renderRecordingChips();
    recording.chordTimer = setTimeout(() => {
      // No second key in time → commit the lone "g".
      recording.chordTimer = null;
      commitRecording();
    }, 800);
    return;
  }

  if (recording.parts.length && recording.parts[0] === "g" && recording.chordTimer) {
    clearTimeout(recording.chordTimer);
    recording.chordTimer = null;
    recording.parts.push(token);
    renderRecordingChips();
    commitRecording();
    return;
  }

  // Single (possibly modified) key → commit immediately.
  recording.parts = [token];
  renderRecordingChips();
  commitRecording();
}

// Normalize a keydown into a binding token matching the catalog's style
// (single chars like "e", "#", "/", "0"; modified keys like "Shift+G").
function keyToken(e) {
  let k = e.key;
  if (k === " ") k = "Space";
  if (k.length === 1) {
    const mods = [];
    if (e.metaKey) mods.push("Mod");
    if (e.ctrlKey) mods.push("Ctrl");
    if (e.altKey) mods.push("Alt");
    // Shift only matters when it changes a letter; the produced char already
    // reflects symbols, so only tag Shift for letters.
    if (e.shiftKey && /[a-zA-Z]/.test(k)) {
      mods.push("Shift");
      k = k.toUpperCase();
    }
    return mods.length ? mods.join("+") + "+" + k : k;
  }
  return k; // named keys (Tab, ArrowUp…) kept verbatim
}

function onRecordOutside(e) {
  if (!recording) return;
  if (recording.cell.contains(e.target)) return; // clicks inside the cell are fine
  if (recording.banner && recording.banner.contains(e.target)) return;
  // Blur commits, mirroring the spec.
  commitRecording();
}

function teardownRecording() {
  if (!recording) return;
  window.removeEventListener("keydown", onRecordKey, true);
  window.removeEventListener("mousedown", onRecordOutside, true);
  if (recording.chordTimer) clearTimeout(recording.chordTimer);
}

function cancelRecording() {
  if (!recording) return;
  teardownRecording();
  recording = null;
  renderKeymap(); // restore the cell to its committed state
}

function commitRecording() {
  if (!recording) return;
  const { cmd, parts } = recording;
  if (recording.chordTimer) {
    clearTimeout(recording.chordTimer);
    recording.chordTimer = null;
  }
  if (!parts.length) {
    cancelRecording();
    return;
  }
  const binding = parts.join(" ");
  const clash = findCollision(binding, cmd.id);
  if (clash) {
    showCollisionBanner(binding, clash);
    return; // wait for Replace / Cancel
  }
  teardownRecording();
  recording = null;
  saveBinding(cmd.id, binding);
}

function showCollisionBanner(binding, clash) {
  if (!recording) return;
  // Stop listening for keys while the user decides, but keep recorder state.
  window.removeEventListener("keydown", onRecordKey, true);
  if (recording.chordTimer) {
    clearTimeout(recording.chordTimer);
    recording.chordTimer = null;
  }
  recording.cell.innerHTML = recording.parts.map((p) => `<kbd>${escapeHtml(p)}</kbd>`).join("");

  const banner = document.createElement("div");
  banner.className = "km-collision";
  banner.innerHTML =
    `<span>${keyChips(binding)} is already bound to <strong>${escapeHtml(clash.title)}</strong></span>` +
    `<span class="km-collision-actions"><button type="button" class="btn-ghost km-replace">Replace</button>` +
    `<button type="button" class="btn-ghost km-cancel">Cancel</button></span>`;
  recording.row.appendChild(banner);
  recording.banner = banner;

  banner.querySelector(".km-replace").addEventListener("click", () => {
    const id = recording.cmd.id;
    teardownRecording();
    recording = null;
    // Replace: take the key here, and strip it from the other command so the
    // binding stays unique. (Other command falls back to its remaining keys.)
    replaceBinding(id, binding, clash.id);
  });
  banner.querySelector(".km-cancel").addEventListener("click", () => {
    cancelRecording();
  });
}

// --- Persistence ----------------------------------------------------------

async function saveBinding(id, binding) {
  keymapOverrides = { ...keymapOverrides, [id]: [binding] };
  await settings.set({ keyOverrides: keymapOverrides });
  renderKeymap();
  flashSaved();
}

// Bind `binding` to `id`, and remove it from `otherId`'s effective keys so the
// chord stays unambiguous.
async function replaceBinding(id, binding, otherId) {
  const KM = window.InboxKeys_KEYMAP;
  const other = KM.commands.find((c) => c.id === otherId);
  const next = { ...keymapOverrides, [id]: [binding] };
  if (other) {
    const remaining = effKeys(other).filter((k) => k !== binding);
    next[otherId] = remaining; // may be [] → other command becomes unbound
  }
  keymapOverrides = next;
  await settings.set({ keyOverrides: keymapOverrides });
  renderKeymap();
  flashSaved();
}

async function resetBinding(id) {
  const next = { ...keymapOverrides };
  delete next[id];
  keymapOverrides = next;
  await settings.set({ keyOverrides: keymapOverrides });
  renderKeymap();
  flashSaved();
}

async function resetAllBindings() {
  cancelRecording();
  keymapOverrides = {};
  await settings.set({ keyOverrides: {} });
  renderKeymap();
  flashSaved();
}

function renderTabs(tabs) {
  const wrap = $("tabs");
  const list = tabs || [];
  if (!list.length) {
    wrap.innerHTML = `<p class="muted">No tabs yet.</p>`;
    return;
  }
  wrap.innerHTML = list
    .map(
      (t) =>
        `<div class="acct"><span class="idx">${escapeHtml(t.name)}</span><code>${
          t.type === "inbox" ? "inbox (default view)" : escapeHtml(t.query || "")
        }</code></div>`
    )
    .join("");
}

function renderAccounts(names) {
  const wrap = $("accounts");
  const entries = Object.entries(names).sort((a, b) => a[0] - b[0]);
  if (!entries.length) {
    wrap.innerHTML = `<p class="muted">No accounts learned yet. Visit each Gmail account once.</p>`;
    return;
  }
  wrap.innerHTML = "";
  entries.forEach(([idx, email]) => {
    const row = document.createElement("div");
    row.className = "acct";
    row.innerHTML = `<span class="idx">u/${idx}</span><input data-idx="${idx}" value="${escapeHtml(email)}" />`;
    wrap.appendChild(row);
  });
  wrap.querySelectorAll("input").forEach((inp) =>
    inp.addEventListener("change", async () => {
      const cur = { ...(settings.get("accountNames") || {}) };
      cur[inp.dataset.idx] = inp.value;
      await settings.set({ accountNames: cur });
      flashSaved();
    })
  );
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Persist on any change.
Object.entries(FIELDS).forEach(([k, kind]) => {
  const el = $(k);
  if (!el) return;
  el.addEventListener("change", async () => {
    const val = kind === "checkbox" ? el.checked : el.value.trim();
    await settings.set({ [k]: val });
    renderSyncStatus();
    flashSaved();
  });
});

// Palette hotkey wiring.
$("paletteHotkeyCell").addEventListener("click", startPaletteRecording);
$("paletteHotkeyCell").addEventListener("keydown", (e) => {
  if (!paletteRecording && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    startPaletteRecording();
  }
});
$("paletteHotkeyReset").addEventListener("click", () => {
  const KM = window.InboxKeys_KEYMAP;
  savePaletteHotkey((KM && KM.PALETTE_DEFAULT) || "Mod+K");
});

// Keymap toolbar wiring.
$("keymapSearch").addEventListener("input", renderKeymap);
$("resetAll").addEventListener("click", resetAllBindings);

load();
