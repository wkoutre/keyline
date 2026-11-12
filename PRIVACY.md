# Keyline Privacy Policy

Last updated: November 12, 2026

Keyline is a Chrome extension that adds a command palette, keyboard shortcuts, split-inbox tabs, and account switching to Gmail and Google Calendar. It is a fork of the open-source Inbox Keys extension.

## What Keyline collects

Nothing.

- No email or calendar content is stored or transmitted. Keyline drives Gmail's and Calendar's existing interface in your browser. It does not use the Gmail or Calendar APIs and has no access tokens.
- No analytics, telemetry, or tracking of any kind.
- No remote servers. The extension makes no network requests of its own.
- No accounts. There is nothing to sign up for.

## What Keyline keeps in memory

The contact sidebar (the `i` key) lists your recent conversations with the person you are reading. It builds that list from the conversation rows Gmail has already shown in the same tab: sender, subject, snippet and date. The list lives only in that tab's memory. It is never written to storage, never synced and never sent anywhere, and it is gone when you close or reload the tab.

## What Keyline stores

Your settings only: shortcut remappings, split-inbox tab definitions, feature toggles, and the email-to-account-index mapping used for account switching. These are stored in your browser with the `chrome.storage` API. Shortcut remappings, tab definitions and toggles use `chrome.storage.sync`, so if you have turned on your browser's own sync, the browser carries them to your other computers the same way it syncs your bookmarks. Keyline has no account and no server, and never sees that data in transit. The account mapping always stays on the computer it was learned on. Removing the extension removes them.

## Permissions

- `storage`: saves your settings in the browser, synced by the browser between your computers when browser sync is on.
- Host access to `mail.google.com` and `calendar.google.com`: required to add the palette, shortcuts, and tab bar to those pages. The extension runs nowhere else.

## Changes

Any change to this policy will appear in this file, with an updated date, in the public source repository.

## Contact

Open an issue on the source repository.
