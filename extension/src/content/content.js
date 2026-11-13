// Bootstrap: load settings, then wire up the palette, hotkeys, accounts, and
// the split-inbox tab bar once Gmail's app is ready.
(async function () {
  const { storage, hotkeys, accounts, palette, tabs } = InboxKeys;

  await storage.load();

  // Theme first, so the tab bar and everything after paints in it.
  if (InboxKeys.theme) InboxKeys.theme.init(storage);

  if (InboxKeys.focus) InboxKeys.focus.init(storage);

  hotkeys.install();
  if (InboxKeys.undoSend) InboxKeys.undoSend.start();
  tabs.init();
  if (InboxKeys.contacts) InboxKeys.contacts.init();

  // Learn the current account, and re-check as Gmail re-renders / navigates.
  const learn = () => accounts.rememberCurrent().catch(() => {});
  learn();
  let last = location.href;
  setInterval(() => {
    if (location.href !== last) {
      last = location.href;
      learn();
    }
  }, 1500);
  // Gmail mutates the DOM heavily after load; one delayed pass catches the avatar.
  setTimeout(learn, 4000);

  // React to settings changes from the popup/options pages live.
  storage.onChange(() => {});

  // Let the popup/background drive the content script via messages.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "inboxkeys:open-palette") palette.show();
    if (msg && msg.type === "inboxkeys:open-tabs-config") tabs.openConfig();
  });

  // Dev-only: an unpacked build with the dev-autoreload flag reloads itself
  // when its files change (see src/background/dev-reload.js). Ask once; keep
  // asking only if the worker says dev mode is on. A Web Store build answers
  // { dev: false } and nothing else ever runs.
  devAutoReload();

  console.log("[Keyline] ready on", location.host);

  function devAutoReload() {
    let timer = null;
    const ask = () => {
      try {
        chrome.runtime.sendMessage({ type: "inboxkeys:dev-check" }, (res) => {
          if (chrome.runtime.lastError || !res || !res.dev) {
            if (timer) clearInterval(timer);
            timer = null;
            return;
          }
          if (!timer) timer = setInterval(ask, 3000);
        });
      } catch (_) {
        // Extension context invalidated: this build was reloaded under us.
        if (timer) clearInterval(timer);
        timer = null;
      }
    };
    ask();
  }
})();
