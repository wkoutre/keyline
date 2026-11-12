// Undo send. Gmail already holds every sent message for its own "Undo Send"
// cancellation period (Settings > General: 5, 10, 20 or 30 seconds) and shows
// a "Message sent  Undo" snackbar meanwhile. Keyline adds, with no server and
// no new permission (the hold is Gmail's own):
//   • Mod+Z outside a text field, and "Undo send" in Cmd+K, click that
//     snackbar's Undo (gmail.undoSend), so the draft comes back.
//   • A countdown chip while the window is open: "Sent · Cmd+Z to undo · 8s".
//     Clicking it undoes too. The seconds come from the window Keyline last
//     saw for this account (set from Cmd+K, or read on Gmail's settings page);
//     unknown, the chip shows no number. It closes when Gmail drops the Undo.
//   • "Undo send window: N seconds" rows in Cmd+K that change Gmail's own
//     setting: open Settings > General, pick N, Save Changes.
window.InboxKeys = window.InboxKeys || {};

(function () {
  const { gmail, storage } = InboxKeys;
  const POLL_MS = 250;

  let chip = null; // { el, start } while Gmail's send Undo is showing
  let learnedVisit = false; // read the settings select once per settings visit
  let timer = null;

  function accountKey() {
    const email = gmail.currentEmail && gmail.currentEmail();
    return email ? String(email).toLowerCase() : "u/" + gmail.accountIndex();
  }

  // The window Keyline last saw for this account, or null when unknown.
  function windowSeconds() {
    const map = storage.get("undoSendWindows") || {};
    const n = map[accountKey()];
    return gmail.UNDO_SEND_CHOICES.includes(n) ? n : null;
  }

  function rememberWindow(seconds) {
    if (!gmail.UNDO_SEND_CHOICES.includes(seconds)) return;
    const key = accountKey();
    const map = Object.assign({}, storage.get("undoSendWindows") || {});
    if (map[key] === seconds) return;
    map[key] = seconds;
    storage.set({ undoSendWindows: map });
  }

  function modLabel() {
    const KM = window.InboxKeys_KEYMAP;
    return KM && typeof KM.displayBinding === "function" ? KM.displayBinding("Mod+Z") : "Cmd+Z";
  }

  function chipText(now) {
    const secs = windowSeconds();
    const base = `Sent · ${modLabel()} to undo`;
    if (!secs) return base;
    const left = Math.max(0, Math.ceil(secs - (now - chip.start) / 1000));
    return `${base} · ${left}s`;
  }

  function showChip(now) {
    const el = document.createElement("div");
    el.className = "inboxkeys-undosend inboxkeys-toast inboxkeys-toast--in";
    el.setAttribute("role", "button");
    el.title = "Undo send";
    el.addEventListener("click", () => {
      gmail.undoSend();
      hideChip();
    });
    document.documentElement.appendChild(el);
    chip = { el, start: now };
    el.textContent = chipText(now);
  }

  function hideChip() {
    if (chip) chip.el.remove();
    chip = null;
  }

  // One pass: follow Gmail's send snackbar with the chip, and learn the
  // window from Settings > General when it is on screen. Cheap on purpose
  // (an id lookup, plus a select scan only on the settings page): it runs
  // every POLL_MS.
  function tick(now = Date.now()) {
    if (storage.get("enabled") === false) {
      hideChip();
      return;
    }
    const undo = document.querySelector(gmail.SEL.sendUndo);
    const open = !!(undo && gmail.isVisible(undo));
    if (open && !chip) showChip(now);
    else if (!open && chip) hideChip();
    else if (chip) {
      const secs = windowSeconds();
      if (secs && now - chip.start >= secs * 1000) hideChip();
      else chip.el.textContent = chipText(now);
    }

    if (/^#settings\/general\b/.test(location.hash || "")) {
      if (!learnedVisit) {
        const sel = gmail.undoSendSelect();
        const secs = sel && gmail.undoSendSelectSeconds(sel);
        if (secs) {
          rememberWindow(secs);
          learnedVisit = true;
        }
      }
    } else {
      learnedVisit = false;
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => tick(), POLL_MS);
  }

  // Change Gmail's own Undo Send setting: Settings > General, pick the value,
  // Save Changes. Gmail then returns to the mail view by itself; if it stays on
  // settings we go back to where the user was.
  function setWindow(seconds) {
    if (!gmail.UNDO_SEND_CHOICES.includes(seconds)) return false;
    const prev = location.hash || "#inbox";
    const back = /^#settings\b/.test(prev) ? "#inbox" : prev;
    const toast = (msg, kind) => InboxKeys.toast && InboxKeys.toast(msg, { kind: kind || "info" });
    learnedVisit = true; // don't mistake our own unsaved pick for the saved value
    gmail.setHash("settings/general");
    gmail.waitFor(
      gmail.undoSendSelect,
      (sel) => {
        if (gmail.undoSendSelectSeconds(sel) === seconds) {
          rememberWindow(seconds);
          toast(`Undo send window is already ${seconds} seconds`);
          location.hash = back;
          return;
        }
        gmail.setSelectSeconds(sel, seconds);
        gmail.waitFor(
          gmail.settingsSaveButton,
          (btn) => {
            rememberWindow(seconds);
            gmail.realClick(btn);
            toast(`Undo send window set to ${seconds} seconds`);
            setTimeout(() => {
              if (/^#settings\b/.test(location.hash || "")) location.hash = back;
            }, 1500);
          },
          () => toast("Gmail control not found: Save Changes (Undo Send)", "warn"),
          12,
          100
        );
      },
      () => toast("Gmail control not found: Undo Send setting", "warn"),
      50,
      120
    );
    return true;
  }

  InboxKeys.undoSend = { tick, start, setWindow, windowSeconds, rememberWindow, hideChip };
})();
