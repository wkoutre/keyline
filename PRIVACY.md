# Keyline Privacy Policy

Last updated: November 10, 2026

Keyline is a Chrome extension that adds a command palette, keyboard shortcuts, split-inbox tabs, and account switching to Gmail and Google Calendar. It is a fork of the open-source Inbox Keys extension.

## What Keyline collects

Nothing.

- No email or calendar content is read, stored, or transmitted. Keyline drives Gmail's and Calendar's existing interface in your browser. It does not use the Gmail or Calendar APIs and has no access tokens.
- No analytics, telemetry, or tracking of any kind.
- No remote servers. The extension makes no network requests of its own.
- No accounts. There is nothing to sign up for.

## What Keyline stores

Your settings only: shortcut remappings, split-inbox tab definitions, feature toggles, and the email-to-account-index mapping used for account switching. These are stored in your browser with the `chrome.storage` API and never leave your machine. Removing the extension removes them.

## Permissions

- `storage`: saves your settings locally.
- Host access to `mail.google.com` and `calendar.google.com`: required to add the palette, shortcuts, and tab bar to those pages. The extension runs nowhere else.

## Changes

Any change to this policy will appear in this file, with an updated date, in the public source repository.

## Contact

Open an issue on the source repository.
