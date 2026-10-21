# Installable Reaction Journey

One responsive web app serves PCs, Android phones/tablets, iPhones and iPads. It uses the existing site, account, permissions and database. Desktop keeps its full sidebar. At widths up to 1100px, four bottom destinations provide Reactions, Reactors, MS Journey and Community; More retains the other pages, moderator pages, preferences and submission. Browser Back now follows page changes.

## Installation

- PC: open reactionjourney.com in Chrome or Edge and use Install app or the address-bar install icon. Supported Safari versions also offer installation.
- Android: open the browser menu and choose Install app or Add to Home screen.
- iPhone/iPad: in Safari, choose Share → Add to Home Screen → Add. Keep Open as Web App enabled if offered. On some versions Share is under the browser menu.
- The Install app button provides device-specific guidance when the browser does not expose an automatic installation prompt. Installation remains optional.

## Limits

An internet connection is required for account data, reactions, community and video playback. Only public installation assets and a generic offline screen are cached. No member HTML, API data, authentication responses or videos are cached by the app. Authentication tokens continue using the existing Supabase session storage. Browser and installed-app sessions may differ, especially on Apple devices; sign in again with the same account if needed. Account data remains shared.

Updates download in the background and offer Update now. Finish unsaved edits before updating. No native app-store package, push notifications or offline editing is included.

## Validation

The automated suite covers manifest/icon packaging, private-request bypass, offline navigation and update/cache isolation in addition to the existing application tests. Physical-device installation, Apple sign-in handoff and external video playback should be checked on actual supported devices before describing those flows as verified.
