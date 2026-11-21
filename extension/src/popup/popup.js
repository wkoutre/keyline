const $ = (id) => document.getElementById(id);
const TOGGLES = ["enabled", "hotkeysEnabled", "tabsEnabled"];
const DEFAULT_ON = new Set(["enabled", "hotkeysEnabled", "tabsEnabled"]);
// Same storage module the content scripts use (sync for settings, local for
// per-machine data).
const settings = window.InboxKeys.storage;
const LINKS = window.InboxKeys_LINKS;

function say(msg) {
  $("note").textContent = msg;
  clearTimeout(say._t);
  say._t = setTimeout(() => ($("note").textContent = ""), 4000);
}

function showEnabled(on) {
  document.body.classList.toggle("off", !on);
  $("enabled-label").textContent = on ? "On" : "Off";
}

async function init() {
  const s = await settings.load();
  if (window.InboxKeys.theme) window.InboxKeys.theme.apply(s.theme);
  TOGGLES.forEach((k) => ($(k).checked = s[k] ?? DEFAULT_ON.has(k)));
  showEnabled($("enabled").checked);

  // Show the user's palette key (remappable in settings), e.g. "Cmd+K".
  const KM = window.InboxKeys_KEYMAP;
  if (KM && typeof KM.normalizePaletteHotkey === "function") {
    const key = KM.displayBinding(KM.normalizePaletteHotkey(s.paletteHotkey));
    $("palette-key").textContent = key;
    $("palette-key-2").textContent = key;
  }
  $("zelle-num").textContent = LINKS.zelle;
  const manifest = chrome.runtime && chrome.runtime.getManifest ? chrome.runtime.getManifest() : null;
  $("version").textContent = manifest && manifest.version ? "v" + manifest.version : "";

  // Account email for the active Gmail tab; elsewhere, point at Gmail.
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    const url = (tab && tab.url) || "";
    if (!/mail\.google\.com/.test(url)) {
      document.body.classList.add("not-gmail");
      $("away").hidden = false;
      return;
    }
    const m = url.match(/\/mail\/u\/(\d+)\//);
    const idx = m ? m[1] : "0";
    const names = s.accountNames || {};
    $("account").textContent = names[idx] || `Gmail account ${idx}`;
  });
}

document.addEventListener("change", (e) => {
  const k = e.target.id;
  if (!TOGGLES.includes(k)) return;
  settings.set({ [k]: e.target.checked });
  if (k === "enabled") showEnabled(e.target.checked);
});

// Actions that run inside the active Gmail tab.
function relay(payload) {
  chrome.runtime.sendMessage({ type: "inboxkeys:relay", payload }, (res) => {
    if (res && !res.ok) say("Open a Gmail tab first.");
    else window.close();
  });
}

$("open-palette").addEventListener("click", () => relay({ type: "inboxkeys:open-palette" }));
$("open-tabs").addEventListener("click", () => relay({ type: "inboxkeys:open-tabs-config" }));
$("open-help").addEventListener("click", () => relay({ type: "inboxkeys:open-cheatsheet" }));
$("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());

$("donate-toggle").addEventListener("click", () => {
  const open = $("donate").hidden;
  $("donate").hidden = !open;
  $("donate-toggle").setAttribute("aria-expanded", String(open));
});

init();
LINKS.wire(say);
