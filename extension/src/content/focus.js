// Focus mode: hide Gmail's chrome (the folder/label pane, the Mail/Chat/Meet
// rail, the right side-panel rail and its open panel) so the message list or the
// open conversation has the window to itself. We only set attributes (one on
// <html>, one on each pane to hide) and palette.css does the hiding, so no Gmail
// element is moved or removed and turning it off is instant and lossless. No
// server, no new permission.
//
// What gets hidden (verified live, Nov 2026): below the header Gmail lays out
// one flex row whose children are the Mail/Chat/Meet rail (the page's only
// role=navigation), the folder/label pane (no role, no label), a zero-height
// hover overlay, the main column holding role=main, and the right side-panel
// rail (role=complementary "Side panel"). Only the rail and side panel have
// stable hooks, so we find the row structurally: walk up from the visible
// role=main until the parent also holds one of those landmarks, then mark every
// OTHER child of that row with data-keyline-focus-hide. The main column then
// takes the freed width on its own (it's a flex row). Gmail re-renders, so the
// marking is refreshed on navigation and whenever the row's children change
// (a childList observer on the row only, never the whole document). The
// header (search, settings, account) stays: "/" search must keep working.
//
// The state is storage.focusMode (syncs like other settings), so a reload, a new
// tab, or another machine comes back the way you left it. While it is on, a small
// pill sits in the corner naming the key that leaves it, so hidden navigation is
// never a mystery; clicking the pill also exits.
window.InboxKeys = window.InboxKeys || {};

(function () {
  const ATTR = "data-keyline-focus";
  const PILL_ID = "keyline-focus-pill";
  const HIDE = "data-keyline-focus-hide";
  const LANDMARKS = '[role="navigation"], [role="complementary"][aria-label="Side panel"]';
  let store = null;
  let observer = null;
  let observedRow = null;

  function root() {
    return document.documentElement;
  }

  function isOn() {
    return root().getAttribute(ATTR) === "on";
  }

  function exitKeyLabel() {
    const KM = window.InboxKeys_KEYMAP;
    if (!KM || typeof KM.keysFor !== "function") return "";
    const keys = KM.keysFor("focus-mode", (store && store.get("keyOverrides")) || {});
    if (!keys.length) return "";
    return typeof KM.displayBinding === "function" ? KM.displayBinding(keys[0]) : keys[0];
  }

  function renderPill(on) {
    let pill = document.getElementById(PILL_ID);
    if (!on) {
      if (pill) pill.remove();
      return;
    }
    if (!pill) {
      pill = document.createElement("button");
      pill.id = PILL_ID;
      pill.type = "button";
      pill.className = "keyline-focus-pill";
      pill.addEventListener("click", () => set(false));
      document.body.appendChild(pill);
    }
    const key = exitKeyLabel();
    pill.textContent = key ? `Focus mode · ${key} to exit` : "Focus mode · click to exit";
    pill.title = "Leave focus mode";
  }

  function visible(el) {
    const g = InboxKeys.gmail;
    return g && typeof g.isVisible === "function" ? g.isVisible(el) : true;
  }

  // The row child that holds the visible role=main, or null if Gmail's layout
  // isn't the one we know (then we hide nothing rather than guess).
  function mainColumn() {
    const mains = Array.from(document.querySelectorAll('[role="main"]'));
    const main = mains.find(visible) || mains[0];
    if (!main) return null;
    let col = main;
    while (col.parentElement && col.parentElement !== document.body && col.parentElement !== document.documentElement) {
      const row = col.parentElement;
      const outside = Array.from(row.querySelectorAll(LANDMARKS)).some((el) => !col.contains(el));
      if (outside) return col;
      col = row;
    }
    return null;
  }

  // The chrome to hide: every sibling of the main column (never Keyline's own UI).
  function chromePanes() {
    const col = mainColumn();
    if (!col) return [];
    return Array.from(col.parentElement.children).filter(
      (el) => el !== col && !/^(SCRIPT|STYLE|LINK)$/.test(el.tagName) && !String(el.className || "").includes("inboxkeys-")
    );
  }

  function unmark() {
    for (const el of document.querySelectorAll("[" + HIDE + "]")) el.removeAttribute(HIDE);
  }

  function watch(row) {
    if (row === observedRow) return;
    if (observer) observer.disconnect();
    observer = null;
    observedRow = row;
    if (row && typeof MutationObserver === "function") {
      observer = new MutationObserver(() => { if (isOn()) mark(); });
      observer.observe(row, { childList: true });
    }
  }

  function mark() {
    const col = mainColumn();
    watch(col ? col.parentElement : null);
    const panes = chromePanes();
    for (const el of document.querySelectorAll("[" + HIDE + "]")) if (!panes.includes(el)) el.removeAttribute(HIDE);
    for (const el of panes) if (!el.hasAttribute(HIDE)) el.setAttribute(HIDE, "");
    return panes.length;
  }

  function onNav() {
    if (isOn()) mark();
  }

  // Apply without persisting (used for init and for changes from other tabs).
  function apply(on) {
    if (on) {
      root().setAttribute(ATTR, "on");
      mark();
    } else {
      root().removeAttribute(ATTR);
      unmark();
      watch(null);
    }
    renderPill(!!on);
    // Gmail sizes its list and thread panes from window size; nudge it to
    // re-layout into the space we just freed (or took back).
    try {
      window.dispatchEvent(new Event("resize"));
    } catch (_) {}
    return !!on;
  }

  function set(on) {
    apply(on);
    if (store) store.set({ focusMode: !!on }).catch(() => {});
    return !!on;
  }

  function toggle() {
    const on = set(!isOn());
    if (InboxKeys.toast) InboxKeys.toast(on ? "Focus mode on" : "Focus mode off");
    return on;
  }

  function init(storage) {
    store = storage;
    window.addEventListener("hashchange", () => setTimeout(onNav, 50));
    apply(!!storage.get("focusMode"));
    storage.onChange((cache, changes) => {
      if (changes && "focusMode" in changes) apply(!!cache.focusMode);
      else if (changes && "keyOverrides" in changes) renderPill(isOn());
    });
  }

  InboxKeys.focus = { ATTR, HIDE, isOn, set, toggle, apply, init, mark, chromePanes };
})();
