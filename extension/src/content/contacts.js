// Contact sidebar: who you are reading (or have the cursor on) and your recent
// conversations with them, toggled with "i".
//
// No Gmail API, no server, no new permission. Everything comes from Gmail's own
// DOM:
// - The person: the focused message's sender chip (span.gD[email][name]), its
//   avatar (img.ajn[data-hovercard-id=<email>], outside the .gE header), and the
//   other people on the conversation (span.g2 / span.gD chips).
// - Recent conversations: list rows (tr.zA) this tab has rendered. Gmail keeps
//   the list in the DOM while a conversation is open, and we index every row we
//   see into an IN-MEMORY map (never saved to extension storage, never sent anywhere), so
//   the history grows as you move through inbox, labels and searches. A
//   background Gmail search is not possible without the API: verified live
//   (Nov 2026) that a hidden same-origin Gmail iframe drives the PARENT tab's
//   URL, and a sandboxed one refuses to boot. So the sidebar is honest about
//   its source, and "All mail with them" runs the real Gmail search.
window.InboxKeys = window.InboxKeys || {};

(function () {
  const MAX_INDEX = 3000;
  const MAX_RECENT = 8;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // threadKey -> record. Map keeps insertion order; re-seen rows move to the end.
  const index = new Map();
  let root = null;
  let shownKey = "";
  let pollTimer = null;
  let scanTimer = null;
  let observer = null;

  function gmail() {
    return InboxKeys.gmail;
  }

  function clean(s) {
    return String(s == null ? "" : s).replace(/[\u00a0\u202f\u2009]/g, " ").replace(/\s+/g, " ").trim();
  }

  function personOf(el) {
    if (!el || typeof el.getAttribute !== "function") return null;
    const email = clean(el.getAttribute("email")).toLowerCase();
    if (!EMAIL_RE.test(email)) return null;
    const name = clean(el.getAttribute("name") || el.textContent) || email;
    return { email, name };
  }

  // Gmail's date tooltip ("Tue, Nov 10, 2026, 5:35 PM") → epoch ms, or 0.
  function parseDate(title) {
    const t = clean(title);
    if (!t) return 0;
    const direct = Date.parse(t);
    if (!Number.isNaN(direct)) return direct;
    // Drop the weekday and the comma before the time, which some engines refuse.
    const m = t.match(/([A-Z][a-z]{2,8})\s+(\d{1,2}),\s*(\d{4}),?\s*(\d{1,2}:\d{2})\s*([AP]M)?/i);
    if (!m) return 0;
    const alt = Date.parse(`${m[1]} ${m[2]}, ${m[3]} ${m[4]}${m[5] ? " " + m[5] : ""}`);
    return Number.isNaN(alt) ? 0 : alt;
  }

  // One list row → { key, legacyId, permId, subject, snippet, when, whenText, unread, people }.
  function parseRow(row) {
    if (!row || typeof row.querySelector !== "function") return null;
    const permEl = row.querySelector("[data-thread-id]");
    const legacyEl = row.matches && row.matches("[data-legacy-thread-id]") ? row : row.querySelector("[data-legacy-thread-id]");
    const permId = permEl ? clean(permEl.getAttribute("data-thread-id")).replace(/^#/, "") : "";
    const legacyId = legacyEl ? clean(legacyEl.getAttribute("data-legacy-thread-id")) : "";
    const subjectEl = row.querySelector(".bog");
    const subject = clean(subjectEl ? subjectEl.textContent : "");
    const key = permId || legacyId || "";
    if (!key || !subject) return null;
    const people = [];
    const seen = new Set();
    for (const chip of row.querySelectorAll("span[email]")) {
      const p = personOf(chip);
      if (p && !seen.has(p.email)) {
        seen.add(p.email);
        people.push(p);
      }
    }
    if (!people.length) return null;
    const snippetEl = row.querySelector(".y2");
    const dateEl = row.querySelector("td.xW span[title], .xW span[title]");
    const whenTitle = dateEl ? dateEl.getAttribute("title") : "";
    return {
      key,
      permId,
      legacyId,
      subject,
      snippet: clean(snippetEl ? snippetEl.textContent : "").replace(/^[-–—]\s*/, ""),
      when: parseDate(whenTitle),
      whenText: clean(dateEl ? dateEl.textContent : "") || clean(whenTitle),
      unread: !!(row.classList && row.classList.contains("zE")),
      people,
    };
  }

  function remember(rec) {
    if (!rec) return;
    index.delete(rec.key);
    index.set(rec.key, rec);
    while (index.size > MAX_INDEX) index.delete(index.keys().next().value);
  }

  function scan(scope) {
    const s = scope || document;
    const sel = (gmail() && gmail().SEL && gmail().SEL.listRow) || "tr.zA";
    let n = 0;
    for (const row of s.querySelectorAll(sel)) {
      const rec = parseRow(row);
      if (rec) {
        remember(rec);
        n++;
      }
    }
    return n;
  }

  // The open conversation's ids, so "recent" never lists the thread you're in.
  function openThreadIds() {
    const ids = new Set();
    const h = document.querySelector('[role="main"] h2.hP, h2.hP');
    if (h) {
      for (const a of ["data-thread-perm-id", "data-legacy-thread-id"]) {
        const v = clean(h.getAttribute(a)).replace(/^#/, "");
        if (v) ids.add(v);
      }
    }
    const hash = String(location.hash || "");
    const last = hash.split("/").pop();
    if (last) ids.add(last);
    return { ids, subject: h ? clean(h.textContent) : "" };
  }

  // Conversations with `email` from the index, newest first.
  function recentWith(email, opts) {
    const target = String(email || "").toLowerCase();
    if (!target) return [];
    const o = opts || {};
    const exclude = o.exclude || new Set();
    const out = [];
    let order = 0;
    for (const rec of index.values()) {
      order++;
      if (exclude.has(rec.key) || exclude.has(rec.permId) || exclude.has(rec.legacyId)) continue;
      if (!rec.people.some((p) => p.email === target)) continue;
      out.push({ rec, order });
    }
    out.sort((a, b) => b.rec.when - a.rec.when || b.order - a.order);
    return out.slice(0, o.limit || MAX_RECENT).map((x) => x.rec);
  }

  // ---- who ----------------------------------------------------------------

  function avatarFor(email) {
    const imgs = document.querySelectorAll('[role="main"] img[data-hovercard-id], [role="main"] img[jid]');
    for (const img of imgs) {
      const id = clean(img.getAttribute("data-hovercard-id") || img.getAttribute("jid")).toLowerCase();
      const src = img.getAttribute("src") || "";
      if (id === email && /^https:\/\//.test(src)) return src;
    }
    return "";
  }

  // Everyone on the open conversation except you and the contact.
  function othersOnThread(email) {
    const me = String((gmail() && gmail().currentEmail && gmail().currentEmail()) || "").toLowerCase();
    const out = [];
    const seen = new Set([email, me]);
    for (const chip of document.querySelectorAll('[role="main"] .gE span[email], [role="main"] span.gD[email], [role="main"] span.g2[email]')) {
      const p = personOf(chip);
      if (!p || seen.has(p.email)) continue;
      seen.add(p.email);
      out.push(p);
    }
    return out;
  }

  // The person the sidebar is about, or null. Thread: the focused message's
  // sender (the last message's when no card is focused). List: the cursor
  // row's sender.
  function currentContact() {
    const g = gmail();
    if (!g) return null;
    const ctx = g.getContext();
    let who = null;
    let where = "";
    if (ctx === "threadView" || (g.inThread && g.inThread())) {
      const card = InboxKeys.threadnav && InboxKeys.threadnav.currentCard ? InboxKeys.threadnav.currentCard() : null;
      who = g.senderOfCard(card) || g.senderOfCard(null);
      where = "thread";
    } else {
      const row = InboxKeys.listnav && InboxKeys.listnav.cursorRow ? InboxKeys.listnav.cursorRow() : null;
      who = row ? g.senderOfRow(row) : null;
      where = "list";
      const rec = row ? parseRow(row) : null;
      if (who && rec) return finish(who, where, rec.key);
    }
    return finish(who, where, "");
  }

  function finish(who, where, rowKey) {
    if (!who) return null;
    const email = String(who.email || "").toLowerCase();
    const name = clean(who.name) || email;
    return { email, name: name === "me" ? email : name, where, rowKey };
  }

  // ---- render -------------------------------------------------------------

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function initials(name, email) {
    const src = clean(name && name !== email ? name : email.split("@")[0]);
    const parts = src.split(/[\s._-]+/).filter(Boolean);
    return ((parts[0] || "?")[0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
  }

  function domainOf(email) {
    const m = String(email || "").match(/@([^@\s]+)$/);
    return m ? m[1].toLowerCase() : "";
  }

  function searchWith(email) {
    return gmail().search(`from:${email} OR to:${email}`);
  }

  // Open a recent conversation: click its row when Gmail still renders it,
  // otherwise route to it by id through Gmail's hash router.
  function openRecord(rec) {
    const g = gmail();
    const sel = (g.SEL && g.SEL.listRow) || "tr.zA";
    for (const row of document.querySelectorAll(sel)) {
      const r = parseRow(row);
      if (r && r.key === rec.key && g.isVisible && g.isVisible(row)) {
        const target = row.querySelector(".bog") || row;
        return g.realClick(target);
      }
    }
    const id = rec.legacyId || rec.permId.replace(/^thread-f:/, "");
    if (!id) return false;
    g.setHash("all/" + id);
    return true;
  }

  function placement() {
    // Sit left of Gmail's own right-hand side panel (Calendar/Keep/Tasks rail)
    // and below the top bar, so nothing of Gmail's is covered but the reading pane edge.
    const rail = document.querySelector('[role="complementary"][aria-label="Side panel"]');
    const main = document.querySelector('[role="main"]');
    let right = 0;
    if (rail && gmail().isVisible && gmail().isVisible(rail)) {
      const r = rail.getBoundingClientRect();
      if (r.width > 0 && r.left > 0) right = Math.max(0, window.innerWidth - r.left);
    }
    let top = 64;
    if (main) {
      const m = main.getBoundingClientRect();
      if (m.top > 0) top = m.top;
    }
    return { right, top };
  }

  function render(contact) {
    if (!root) return;
    const body = root.querySelector(".inboxkeys-contact-body");
    body.textContent = "";
    if (!contact) {
      body.appendChild(el("div", "inboxkeys-contact-empty", "Open a conversation or move the cursor to a row to see who it's from."));
      return;
    }
    const { email, name } = contact;

    const head = el("div", "inboxkeys-contact-head");
    const src = avatarFor(email);
    if (src) {
      const img = el("img", "inboxkeys-contact-avatar");
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.src = src;
      head.appendChild(img);
    } else {
      head.appendChild(el("div", "inboxkeys-contact-avatar inboxkeys-contact-initials", initials(name, email)));
    }
    const who = el("div", "inboxkeys-contact-who");
    who.appendChild(el("div", "inboxkeys-contact-name", name));
    who.appendChild(el("div", "inboxkeys-contact-email", email));
    head.appendChild(who);
    body.appendChild(head);

    const actions = el("div", "inboxkeys-contact-actions");
    const btn = (label, title, fn) => {
      const b = el("button", "inboxkeys-contact-btn", label);
      b.type = "button";
      b.title = title;
      b.addEventListener("click", (e) => {
        e.preventDefault();
        fn();
      });
      actions.appendChild(b);
      return b;
    };
    btn("All mail with them", `Search from:${email} OR to:${email}`, () => searchWith(email));
    const domain = domainOf(email);
    if (domain) btn("@" + domain, `Search from:${domain}`, () => gmail().search("from:" + domain));
    btn("Copy email", "Copy the address", () => {
      const done = () => InboxKeys.toast && InboxKeys.toast("Copied " + email);
      try {
        const p = navigator.clipboard && navigator.clipboard.writeText(email);
        if (p && p.then) p.then(done, () => InboxKeys.toast && InboxKeys.toast("Couldn't copy", { kind: "warn" }));
        else done();
      } catch (_) {
        if (InboxKeys.toast) InboxKeys.toast("Couldn't copy", { kind: "warn" });
      }
    });
    body.appendChild(actions);

    if (contact.where === "thread") {
      const others = othersOnThread(email);
      if (others.length) {
        body.appendChild(el("div", "inboxkeys-contact-section", "Also on this conversation"));
        const list = el("div", "inboxkeys-contact-people");
        for (const p of others.slice(0, 8)) {
          const chip = el("button", "inboxkeys-contact-chip", p.name && p.name !== p.email ? p.name : p.email);
          chip.type = "button";
          chip.title = p.email + " (show all mail with them)";
          chip.addEventListener("click", () => searchWith(p.email));
          list.appendChild(chip);
        }
        body.appendChild(list);
      }
    }

    scan();
    const { ids } = contact.where === "thread" ? openThreadIds() : { ids: new Set() };
    if (contact.rowKey) ids.add(contact.rowKey);
    const recent = recentWith(email, { exclude: ids });
    body.appendChild(el("div", "inboxkeys-contact-section", "Recent conversations"));
    if (!recent.length) {
      body.appendChild(el("div", "inboxkeys-contact-empty", "None in the lists you've opened in this tab yet."));
    } else {
      const list = el("div", "inboxkeys-contact-threads");
      for (const rec of recent) {
        const item = el("button", "inboxkeys-contact-thread" + (rec.unread ? " is-unread" : ""));
        item.type = "button";
        const top = el("div", "inboxkeys-contact-thread-top");
        top.appendChild(el("span", "inboxkeys-contact-thread-subject", rec.subject));
        if (rec.whenText) top.appendChild(el("span", "inboxkeys-contact-thread-date", rec.whenText));
        item.appendChild(top);
        if (rec.snippet) item.appendChild(el("div", "inboxkeys-contact-thread-snippet", rec.snippet));
        item.addEventListener("click", () => openRecord(rec));
        list.appendChild(item);
      }
      body.appendChild(list);
    }
    const more = el("button", "inboxkeys-contact-more", "Search all mail with " + (name !== email ? name.split(" ")[0] : email) + " →");
    more.type = "button";
    more.addEventListener("click", () => searchWith(email));
    body.appendChild(more);
  }

  function keyOf(contact) {
    if (!contact) return "none";
    return contact.email + "|" + contact.where + "|" + (contact.rowKey || "") + "|" + location.hash + "|" + index.size;
  }

  function refresh(force) {
    if (!root) return;
    const { right, top } = placement();
    root.style.right = right + "px";
    root.style.top = top + "px";
    const contact = currentContact();
    const k = keyOf(contact);
    if (!force && k === shownKey) return;
    shownKey = k;
    render(contact);
  }

  function isOpen() {
    return !!root;
  }

  function open() {
    if (root) return true;
    root = el("aside", "inboxkeys-contact");
    root.setAttribute("aria-label", "Contact");
    const bar = el("div", "inboxkeys-contact-bar");
    bar.appendChild(el("span", "inboxkeys-contact-title", "Contact"));
    const close = el("button", "inboxkeys-contact-close");
    close.type = "button";
    close.title = "Close (i)";
    close.appendChild(el("kbd", null, "i"));
    close.addEventListener("click", () => toggle(false));
    bar.appendChild(close);
    root.appendChild(bar);
    root.appendChild(el("div", "inboxkeys-contact-body"));
    document.body.appendChild(root);
    shownKey = "";
    refresh(true);
    // Follow the cursor / open conversation. Events cover the common moves
    // at once; the poll catches Gmail re-rendering on its own. Chrome throttles
    // timers hard in a hidden or occluded window, so the poll alone can lag.
    pollTimer = setInterval(() => refresh(false), 400);
    window.addEventListener("hashchange", soon);
    window.addEventListener("keydown", soon, true); // window: the engine consumes keys at document
    window.addEventListener("click", soon, true);
    return true;
  }

  // Re-check shortly after a key, click or navigation, once Gmail has reacted.
  let soonTimers = [];
  function soon() {
    if (!root) return;
    soonTimers.forEach(clearTimeout);
    soonTimers = [60, 400, 1200].map((ms) => setTimeout(() => refresh(false), ms));
  }

  function close() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    soonTimers.forEach(clearTimeout);
    soonTimers = [];
    window.removeEventListener("hashchange", soon);
    window.removeEventListener("keydown", soon, true);
    window.removeEventListener("click", soon, true);
    if (root) root.remove();
    root = null;
    shownKey = "";
    return true;
  }

  // Toggle and remember the choice, so the sidebar stays put across conversations.
  function toggle(force) {
    const want = typeof force === "boolean" ? force : !root;
    if (want) open();
    else close();
    if (InboxKeys.storage && InboxKeys.storage.set) {
      try {
        const p = InboxKeys.storage.set({ contactSidebar: want });
        if (p && p.catch) p.catch(() => {});
      } catch (_) {}
    }
    return true;
  }

  // Index list rows as Gmail renders them (debounced), so recent conversations
  // accumulate even while the sidebar is closed. In-memory only.
  function init() {
    scan();
    if (typeof MutationObserver === "function" && !observer) {
      observer = new MutationObserver(() => {
        if (scanTimer) return;
        scanTimer = setTimeout(() => {
          scanTimer = null;
          scan();
        }, 600);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
    if (InboxKeys.storage && InboxKeys.storage.get && InboxKeys.storage.get("contactSidebar")) open();
  }

  InboxKeys.contacts = {
    init,
    toggle,
    open,
    close,
    isOpen,
    refresh,
    scan,
    parseRow,
    parseDate,
    recentWith,
    currentContact,
    _index: index,
  };
})();
