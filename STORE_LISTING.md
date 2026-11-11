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

- **Name** (from the manifest): Keyline: keyboard shortcuts & command palette for Gmail
- **Summary** (from the manifest description, 132 characters max): Open-source Cmd+K command palette, keyboard shortcuts, split-inbox tabs, and account switching for Gmail and Google Calendar.
- **Description:**

  > Keyline makes Gmail keyboard-first. Press Cmd/Ctrl+K for a command palette that runs any Gmail action, use single-key shortcuts to move through your inbox and conversations, split your inbox into tabs built from Gmail searches, and switch between signed-in accounts with one key. On Google Calendar it adds a palette for toggling calendars and jumping between days, weeks, and months.
  >
  > Privacy by design: Keyline never uses the Gmail API, never sees your mail, and makes no network requests. It works by clicking Gmail's own buttons for you. Your settings stay in your browser.
  >
  > Open source (MIT). A fork of Inbox Keys by Hadi Javeed.

- **Category:** Workflow & Planning (or Productivity: Tools)
- **Language:** English
- **Icon:** `extension/icons/icon128.png`
- **Screenshots:** at least one, 1280×800 or 640×400. Take fresh ones in Gmail with a test inbox (the palette open, the split-inbox tab bar). Don't reuse upstream's marketing images, which show the Inbox Keys name.
- **Small promo tile** (440×280): optional for an unlisted item.

## Privacy practices tab

- **Single purpose:** Adds keyboard shortcuts, a command palette, and split-inbox tabs to Gmail and Google Calendar.
- **Permission justifications:**
  - `storage`: Saves the user's settings (shortcut remappings, split-inbox tab definitions, feature toggles) locally in the browser.
  - Host permission `https://mail.google.com/*`: Content scripts add the command palette, keyboard shortcuts, and tab bar to Gmail and click Gmail's own controls when a shortcut is pressed.
  - Host permission `https://calendar.google.com/*`: Content scripts add the calendar palette and shortcuts to Google Calendar.
- **Remote code:** No, I am not using remote code.
- **Data usage:** check nothing in the "collects" list, then tick all three certifications (no selling data, no unrelated use, no creditworthiness use).
- **Privacy policy URL:** `https://github.com/wkoutre/keyline/blob/main/PRIVACY.md`

## Distribution tab

- **Payments:** Free.
- **Visibility:** **Unlisted**. Anyone with the link can install it, and it doesn't show up in search.
- **Regions:** All regions.

## Submit

Click **Submit for review**. Expect hours to a few days. Keep "publish automatically after review" on.

## Releasing

Releases publish themselves through `.github/workflows/publish.yml`.

1. Bump `version` in `extension/manifest.json` and `extension/package.json`.
2. Push to `main` (directly or by merging a PR).
3. The workflow sees the new version, runs the tests, builds `dist/keyline-<version>.zip`, uploads it, and submits it for review. A push that changes `extension/` without a version bump does nothing.
4. Review still takes hours to a few days. Installed copies update themselves after approval.

To re-run a release by hand, start the workflow from the Actions tab (**Run workflow**); a manual run always uploads and submits the current version. The Web Store only accepts a version higher than the last one uploaded.

The workflow needs five repository secrets: `CWS_EXTENSION_ID`, `CWS_PUBLISHER_ID`, `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, and `CWS_REFRESH_TOKEN`. The OAuth client lives in the `keyline-cws` Google Cloud project.

Manual fallback: `cd extension && ./release.sh`, then in the dashboard open the item, **Package, Upload new package**, then **Submit for review**.

## Pulling upstream fixes

```bash
git fetch upstream
git merge upstream/main
```

Internal identifiers (`inboxkeys` classes, storage keys, `window.InboxKeys`) were left unchanged so these merges stay clean. Conflicts, if any, will be in `manifest.json`, the popup/options titles, README, and PRIVACY.
