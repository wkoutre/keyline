# Chrome Web Store submission

Everything you paste into the Chrome Web Store dashboard for Keyline, plus the steps in order. Package: `extension/dist/keyline-<version>.zip`, built by `extension/release.sh`.

## Before the first upload

1. **Put the source on GitHub as a public repo** (for example `wkoutre/keyline`), push `main`, and keep the `upstream` remote pointing at `hadijaveed/inbox-keys`. The privacy policy URL below needs a public page.
2. **Register as a developer** at <https://chrome.google.com/webstore/devconsole>: sign in with the Google account that should own the listing, turn on 2-Step Verification if it isn't already, pay the one-time $5 fee, and verify the contact email.
3. **Account settings:** declare **non-trader** (personal, non-commercial). Set the publisher display name.

## Package

- Run `cd extension && ./release.sh`. It runs the tests and writes `dist/keyline-<version>.zip`.
- Dashboard: **Items, New item**, upload the zip.

## Store listing tab

Chrome Web Store search weighs the name most, then the summary, then the description. Name and summary come from `manifest.json` (`name`, `description`); the description, category and images are edited in the dashboard. Leave other products' names (Superhuman, Shortwave, ...) out of all three: the store's keyword spam policy rejects listings that name other brands to rank for them. The "Superhuman alternative" angle lives off the store (README, launch posts, AlternativeTo).

Search-tuned copy. Apply the name and summary to `manifest.json` only after the current review clears, because a manifest change publishes a new upload and the store rejects an upload while the previous one is still in review.

- **Name** (75 characters max, 64 used): Keyline: Gmail Keyboard Shortcuts, Command Palette & Split Inbox
- **Summary** (132 characters max, 132 used): Keyboard-first Gmail: Cmd+K palette, shortcuts, split inbox, snooze presets and undo send. Free, open source, never reads your mail.
- **Description:**

  > Keyline makes Gmail keyboard-first. Press Cmd+K (Ctrl+K on Windows) for a command palette that runs any Gmail action, then fly through your inbox with single-key shortcuts. No new email app, no new inbox, no account to create: it works inside the Gmail you already use.
  >
  > WHAT YOU GET
  > • Command palette: Cmd/Ctrl+K to search every action, jump to any label, tab or account.
  > • Keyboard shortcuts: j/k to move, e archive, r reply, a reply all, f forward, s star, x select, / search, plus g chords (g i inbox, g t sent, g d drafts). Remap any key.
  > • Instant reply and forward straight from the inbox list.
  > • Split inbox: tabs over Gmail built from any search (unread, important, a label, a sender). Tab cycles them.
  > • Snooze and schedule send presets: later today, tomorrow morning, Monday, or type "fri 3pm".
  > • Remind me if no reply: the conversation comes back on the day you pick, only if nobody answered.
  > • Undo send with Cmd+Z and a countdown.
  > • Focus mode: hide Gmail's side panels with one key.
  > • Multiple Gmail accounts: every signed-in account in the palette by email, switch with g 0 to g 8.
  > • Google Calendar shortcuts: a palette to toggle and focus calendars, c create, t today, d/w/m views, arrows to move.
  > • Five themes, light and dark. Settings sync across your computers through Chrome sync.
  > • Press ? for a cheat sheet of every shortcut.
  >
  > PRIVATE BY DESIGN
  > Keyline never uses the Gmail API, never sees your mail and makes no network requests. There is no server, no analytics and no AI. It works by clicking Gmail's own buttons for you, faster. The only permission is storage, for your settings.
  >
  > FREE AND OPEN SOURCE
  > MIT licensed. Read every line at github.com/wkoutre/keyline. Built on Inbox Keys by Hadi Javeed.
  >
  > Tip: turn on Gmail's own keyboard shortcuts (Gmail Settings, See all settings, Keyboard shortcuts on) for the smoothest experience.

- **Category:** Productivity: Communication (where email tools cluster; Workflow & Planning also fits).
- **Language:** English
- **Icon:** `extension/icons/icon128.png`
- **Screenshots** (up to 5, 1280×800, from a test inbox with no real mail; the first two show in search results, so lead with the strongest):
  1. The Cmd+K palette open over the inbox, caption "Every Gmail action, one keystroke away".
  2. The split-inbox tab bar with the list cursor, caption "Split your inbox into tabs".
  3. The snooze picker with "fri 3pm" typed, caption "Snooze and schedule send in plain words".
  4. The `?` cheat sheet in a non-default theme, caption "Every shortcut, remappable, five themes".
  5. The Google Calendar palette, caption "Keyboard-first Google Calendar too".
- **Small promo tile** (440×280): logo plus "Keyboard-first Gmail". Needed to be featured.
- **Marquee** (1400×560): optional, only used if the store features the item.
- **Official URL / homepage:** the landing page once it exists, otherwise the GitHub repo.
- **Support URL:** `https://github.com/wkoutre/keyline/issues`

## Privacy practices tab

- **Single purpose:** Adds keyboard shortcuts, a command palette, and split-inbox tabs to Gmail and Google Calendar.
- **Permission justifications:**
  - `storage`: Saves the user's settings (shortcut remappings, split-inbox tab definitions, feature toggles) in the browser with chrome.storage, using chrome.storage.sync so the browser's own sync carries them to the user's other computers. No Keyline account, sign-in, or server is involved.
  - Host permission `https://mail.google.com/*`: Content scripts add the command palette, keyboard shortcuts, and tab bar to Gmail and click Gmail's own controls when a shortcut is pressed.
  - Host permission `https://calendar.google.com/*`: Content scripts add the calendar palette and shortcuts to Google Calendar.
- **Remote code:** No, I am not using remote code.
- **Data usage:** check nothing in the "collects" list, then tick all three certifications (no selling data, no unrelated use, no creditworthiness use).
- **Privacy policy URL:** `https://github.com/wkoutre/keyline/blob/main/PRIVACY.md`

## Distribution tab

- **Payments:** Free.
- **Visibility:** **Public**, so it shows up in store search. (It started Unlisted, link only.)
- **Regions:** All regions.

## Submit

Click **Submit for review**. Expect hours to a few days. Keep "publish automatically after review" on.

## Releasing

Releases publish themselves through `.github/workflows/publish.yml`. You never bump the version by hand.

1. Push to `main` (directly or by merging a PR) a change to `extension/manifest.json`, `extension/src/`, or `extension/icons/*.png`. Docs, tests, and tooling changes don't publish.
2. The `bump` job raises the patch version in `manifest.json`, `package.json`, and `package-lock.json`, commits "Release vX.Y.Z" to `main`, and tags it. Pull before your next change.
3. The `build` job checks out that commit, runs the tests, and builds the zip. The `publish` job uploads it and submits it for review.
4. Review still takes hours to a few days. Installed copies update themselves after approval.

For a new major or minor line, set `version` in `extension/manifest.json` to `X.Y.0` in your commit; the release from it is `X.Y.1`. Never lower it.

To release without a code change, start the workflow from the Actions tab (**Run workflow**).

The `publish` job runs in the `chrome-web-store` GitHub environment (Settings, Environments), restricted to the `main` branch, and signs in to Google with keyless Workload Identity Federation. No credential is stored in GitHub. It reads four non-secret repository variables: `CWS_EXTENSION_ID`, `CWS_PUBLISHER_ID`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, and `GCP_SERVICE_ACCOUNT`. Google only issues a token to a run of this repository on `main` in that environment (the provider's attribute condition in the `keyline-cws` project), and the service account `keyline-publisher@keyline-cws.iam.gserviceaccount.com` must be listed under Account, Service accounts in the developer dashboard. If `main` gets branch protection, allow GitHub Actions to push to it, or the `bump` job fails.

Manual fallback: bump `version` yourself, `cd extension && ./release.sh`, then in the dashboard open the item, **Package, Upload new package**, then **Submit for review**.

## Pulling upstream fixes

```bash
git fetch upstream
git merge upstream/main
```

Internal identifiers (`inboxkeys` classes, storage keys, `window.InboxKeys`) were left unchanged so these merges stay clean. Conflicts, if any, will be in `manifest.json`, the popup/options titles, README, and PRIVACY.
