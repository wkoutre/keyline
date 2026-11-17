// Rate and share: a one-time, dismissible "Enjoying Keyline?" card plus
// palette rows to rate, share or send feedback at any time.
//
// The card is earned, never a popup on install: it waits until you have run
// USES Keyline commands AND first used Keyline at least DAYS ago, shows only
// in the inbox list (never while you write or read), at most once per page,
// and never covers anything modal. "Later" asks again in LATER_DAYS once;
// any other answer ends it for good. The usage counter is a number in
// chrome.storage.local and never leaves the browser; the "done" flag syncs so
// rating on one computer stops the card on the others.
window.InboxKeys = window.InboxKeys || {};

(function () {
  const { storage } = InboxKeys;
  const L = window.InboxKeys_LINKS || {};
  const USES = 40;
  const DAYS = 5;
  const LATER_DAYS = 21;
  const DAY = 24 * 60 * 60 * 1000;
  const SHOW_DELAY = 1500;

  let shownThisPage = false;
  let pending = null;
  let card = null;

  function state() {
    const s = storage.get("shareNudge");
    return s && typeof s === "object" ? s : {};
  }
  function save(patch) {
    const next = { ...state(), ...patch };
    storage.set({ shareNudge: next });
    return next;
  }
  function done() {
    return storage.get("shareNudgeDone") === true;
  }
  function finish() {
    if (!done()) storage.set({ shareNudgeDone: true });
  }

  function eligible(s, now) {
    if (done()) return false;
    if ((s.uses || 0) < USES) return false;
    if (!s.since || now - s.since < DAYS * DAY) return false;
    if (s.until && now < s.until) return false;
    return true;
  }

  // Called once per Keyline command run (palette or hotkey).
  function count(now = Date.now()) {
    if (done()) return;
    const s = state();
    const next = save({ uses: (s.uses || 0) + 1, since: s.since || now });
    if (!shownThisPage && !pending && eligible(next, now)) {
      // Let the command finish (and Gmail re-render) before deciding.
      pending = setTimeout(() => {
        pending = null;
        maybeShow();
      }, SHOW_DELAY);
    }
  }

  function maybeShow(now = Date.now()) {
    if (shownThisPage || card || !eligible(state(), now)) return false;
    const ctx = InboxKeys.gmail && InboxKeys.gmail.getContext ? InboxKeys.gmail.getContext() : "unknown";
    // Only on the calm surface. Elsewhere the next command tries again.
    if (ctx !== "inboxList") return false;
    show(state().uses || USES);
    return true;
  }

  function open(url) {
    if (url) window.open(url, "_blank", "noopener");
  }

  function rate() {
    open(L.review);
    finish();
  }

  function copyShare() {
    finish();
    const text = L.shareText || L.share || "";
    const fallback = () => InboxKeys.toast("Copy this link to share Keyline: " + (L.share || L.store), { timeout: 8000 });
    try {
      const clip = navigator.clipboard;
      if (!clip || typeof clip.writeText !== "function") return fallback();
      return Promise.resolve(clip.writeText(text)).then(
        () => InboxKeys.toast("Link copied. Thanks for sharing Keyline!"),
        fallback
      );
    } catch (_) {
      fallback();
    }
  }

  function feedback() {
    open(L.feedback);
  }

  function later(now = Date.now()) {
    const s = state();
    // One "later" only; the second time it stops asking.
    if ((s.laters || 0) >= 1) finish();
    else save({ laters: (s.laters || 0) + 1, until: now + LATER_DAYS * DAY });
  }

  function close() {
    if (card) card.remove();
    card = null;
  }

  function show(uses) {
    shownThisPage = true;
    close();
    card = document.createElement("div");
    card.className = "inboxkeys-nudge";
    // Not role=dialog: getContext treats a showing dialog as modalOpen, and
    // this card must not switch your shortcuts off.
    card.setAttribute("role", "region");
    card.setAttribute("aria-label", "Enjoying Keyline?");
    card.innerHTML = `
      <div class="inboxkeys-nudge-title">Enjoying Keyline?</div>
      <div class="inboxkeys-nudge-body"></div>
      <div class="inboxkeys-nudge-actions">
        <button type="button" class="inboxkeys-nudge-primary" data-act="rate">Rate Keyline</button>
        <button type="button" data-act="share">Copy share link</button>
      </div>
      <div class="inboxkeys-nudge-footer">
        <button type="button" class="inboxkeys-nudge-link" data-act="feedback">Send feedback</button>
        <span class="inboxkeys-nudge-spacer"></span>
        <button type="button" class="inboxkeys-nudge-link" data-act="later">Later</button>
        <button type="button" class="inboxkeys-nudge-link" data-act="never">No thanks</button>
      </div>`;
    card.querySelector(".inboxkeys-nudge-body").textContent =
      `You've run ${uses} commands with it. It's free and made by one developer who reads every review and issue. A rating helps other people find it.`;
    card.addEventListener("click", (e) => {
      const btn = e.target.closest && e.target.closest("[data-act]");
      if (!btn) return;
      const act = btn.getAttribute("data-act");
      if (act === "rate") rate();
      else if (act === "share") copyShare();
      else if (act === "feedback") {
        // Feedback is not an answer to the ask: keep the card.
        feedback();
        return;
      } else if (act === "later") later();
      else finish();
      close();
    });
    document.documentElement.appendChild(card);
  }

  function commands() {
    const contexts = InboxKeys_KEYMAP.DEFAULT_CONTEXTS;
    return [
      { id: "keyline-rate", title: "Rate Keyline on the Chrome Web Store", group: "Keyline", keys: [], contexts, run: rate },
      { id: "keyline-share", title: "Share Keyline (copy link)", group: "Keyline", keys: [], contexts, run: copyShare },
      { id: "keyline-feedback", title: "Send feedback or report a bug", group: "Keyline", keys: [], contexts, run: feedback },
    ];
  }

  if (InboxKeys.commands && InboxKeys.commands.register) commands().forEach((c) => InboxKeys.commands.register(c));

  InboxKeys.share = { count, maybeShow, eligible, later, rate, copyShare, feedback, close, USES, DAYS, LATER_DAYS };
})();
