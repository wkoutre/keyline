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
    gmail: "https://mail.google.com/mail/u/0/#inbox",
  };
  // Donations (Nick's own accounts, published at his request): PayPal by email
  // through PayPal's donate flow, Zelle by phone (copied, Zelle has no link).
  LINKS.paypalEmail = "nick.koutrelakos@gmail.com";
  LINKS.paypal = "https://www.paypal.com/donate/?business=" + encodeURIComponent(LINKS.paypalEmail) + "&currency_code=USD&item_name=" + encodeURIComponent("Support Keyline");
  LINKS.zelle = "(443) 878-8819";
  LINKS.shareText = "Keyline: free keyboard shortcuts and a Cmd+K command palette for Gmail. " + LINKS.share;

  // What a [data-ik-copy] anchor copies, and what it says after.
  const COPIES = {
    share: { text: () => LINKS.shareText, done: "Share link copied. Thanks!", fail: "Copy this link to share Keyline: " + LINKS.share },
    zelle: { text: () => LINKS.zelle, done: "Zelle number copied: " + LINKS.zelle + ". Thank you!", fail: "Zelle: " + LINKS.zelle + ". Thank you!" },
  };

  // Popup and options: fill [data-ik-link] anchors. A [data-ik-copy] anchor
  // copies text instead of navigating ("1" or "share": the share link,
  // "zelle": the Zelle number). Rating or sharing ends the
  // in-Gmail rate/share card on every computer (shareNudgeDone syncs).
  LINKS.wire = function (onMessage) {
    const doc = root.document;
    const storage = root.InboxKeys && root.InboxKeys.storage;
    const finish = () => storage && storage.set({ shareNudgeDone: true });
    doc.querySelectorAll("[data-ik-link]").forEach((a) => {
      const url = LINKS[a.dataset.ikLink];
      if (!url) return;
      const copy = a.dataset.ikCopy && (COPIES[a.dataset.ikCopy] || COPIES.share);
      if (!copy) {
        a.href = url;
        if (a.dataset.ikLink === "review") a.addEventListener("click", finish);
        return;
      }
      a.addEventListener("click", (e) => {
        e.preventDefault();
        if (copy === COPIES.share) finish();
        const clip = root.navigator.clipboard;
        const fail = () => onMessage(copy.fail);
        if (!clip || typeof clip.writeText !== "function") return fail();
        clip.writeText(copy.text()).then(() => onMessage(copy.done), fail);
      });
    });
  };
  if (typeof module !== "undefined" && module.exports) module.exports = LINKS;
  else root.InboxKeys_LINKS = LINKS;
})(typeof window !== "undefined" ? window : globalThis);
