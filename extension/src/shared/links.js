// Keyline's public links, shared by the content scripts, popup and options
// page. One place to change if the listing or repo ever moves.
(function (root) {
  const STORE = "https://chromewebstore.google.com/detail/ndemgnbgodahfbbachpcefknleljgboj";
  const LINKS = {
    store: STORE,
    // The listing's own reviews tab: one click to the star rating.
    review: STORE + "/reviews",
    // The store's install stats split visits by utm_source.
    share: STORE + "?utm_source=keyline-share",
    feedback: "https://github.com/wkoutre/keyline/issues/new",
    repo: "https://github.com/wkoutre/keyline",
  };
  LINKS.shareText = "Keyline: free keyboard shortcuts and a Cmd+K command palette for Gmail. " + LINKS.share;

  // Popup and options: fill [data-ik-link] anchors. A [data-ik-copy] anchor
  // copies the share text instead of navigating. Rating or sharing ends the
  // in-Gmail rate/share card on every computer (shareNudgeDone syncs).
  LINKS.wire = function (onMessage) {
    const doc = root.document;
    const storage = root.InboxKeys && root.InboxKeys.storage;
    const finish = () => storage && storage.set({ shareNudgeDone: true });
    doc.querySelectorAll("[data-ik-link]").forEach((a) => {
      const url = LINKS[a.dataset.ikLink];
      if (!url) return;
      if (!a.dataset.ikCopy) {
        a.href = url;
        if (a.dataset.ikLink === "review") a.addEventListener("click", finish);
        return;
      }
      a.addEventListener("click", (e) => {
        e.preventDefault();
        finish();
        const clip = root.navigator.clipboard;
        const fail = () => onMessage("Copy this link to share Keyline: " + url);
        if (!clip || typeof clip.writeText !== "function") return fail();
        clip.writeText(LINKS.shareText).then(() => onMessage("Share link copied. Thanks!"), fail);
      });
    });
  };
  if (typeof module !== "undefined" && module.exports) module.exports = LINKS;
  else root.InboxKeys_LINKS = LINKS;
})(typeof window !== "undefined" ? window : globalThis);
