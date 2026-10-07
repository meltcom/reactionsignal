# Import YouTube subscriptions

Members open **Reactors → Import / re-import YouTube subscriptions → Connect YouTube**. Google asks them to choose the account/channel and grant YouTube read permission. The preview lists catalog reactors they subscribe to; selected reactors are followed only after **Follow selected reactors**. Up to 100 can be selected per confirmation; remaining matches stay available. Existing follows, hidden reactors, ratings, and YouTube subscriptions are preserved. Use **Import / re-import YouTube subscriptions** again for new subscriptions or another account. Each run reads the current list and adds only the selected matches; it never removes existing follows. This is an on-demand import, not a background synchronization.

In **Following**, **Reset all reactor follows** and **Reset all song follows** clear those follow types separately. **Master Reset** also clears hidden reactors and reactor ratings. It preserves **video ratings**, performer follows, favorites, watch status, account settings, earned points, and YouTube subscriptions. Members must confirm each reset. Re-import can rebuild selected reactor follows afterward.

## Google and Cloudflare setup

1. In the intended Google Cloud project, enable **YouTube Data API v3**. Imports consume this OAuth client's project quota, which may be shared with discovery if the same project is used. `subscriptions.list` costs 1 unit per request; imports read 50 subscriptions per page (roughly ceil(subscriptions / 50), minimum 1).
2. Configure the Google Auth Platform app branding, verified domain, homepage, support contact, privacy policy and terms as Google requires. Publish a suitable policy covering YouTube data and this import before public launch. Request only `https://www.googleapis.com/auth/youtube.readonly` for the import. Keep the application in Testing and add designated test users until production access and any required Google verification are complete.
3. Create an OAuth **Web application** client (or use an appropriate existing one). Add **Authorized JavaScript origin** `https://reactionjourney.com`. Add any separately approved testing origin. This uses Google Identity Services' popup token model; the import does not need a redirect URI or client secret. Do not alter Supabase's existing login callback.
4. Set Cloudflare Worker `reactionjourney` variable **GOOGLE_YOUTUBE_CLIENT_ID** to the public client ID ending in `.apps.googleusercontent.com`, or add it to the production `wrangler.jsonc` vars and deploy. Keep configuration in sync with Workers Builds so later deploys preserve it. Client IDs are public; do not supply a client secret, access token, refresh token, or service account key. Never use a privileged Supabase key.
5. Deploy and check with a Google test user on the actual authorized origin. Google can return `origin_mismatch`, `access_denied`, or verification/testing restrictions if the console configuration is incomplete. Missing/invalid client ID leaves a clear setup message and never opens Google authorization.

## Data handling

The Google library loads only after the member starts import. A short-lived token is held in browser memory and used directly against Google's HTTPS API in the Authorization header; it is cleared when reads finish. Cancellation aborts reading, clears preview state, and prevents late callbacks from changing the preview. Sign-out/account changes reload or reset the flow. Neither token nor the complete subscriptions list is sent to Reaction Journey's backend, logs, or browser persistent storage. Only selected catalog channel IDs are posted with the member's existing authenticated site session. Server checks same-origin JSON, limits 100 IDs, verifies current catalog membership, ignores duplicates and rechecks hidden state atomically when adding follows. Unknown subscriptions are counted but not retained or added to the catalog.

Google's read-only YouTube scope is broader than subscriptions alone; the implementation calls only `subscriptions.list`. Members may revoke the OAuth grant in [Google account connections](https://myaccount.google.com/connections). Revoking Google permission does not remove imported follows, which members can unfollow on Reaction Journey.

## Release verification

- Build: `npm run build`.
- Focused checks: `node --test tests/youtube-subscriptions.test.mjs`.
- Test consent granted/declined, popup closed/blocked, a YouTube channel with no subscriptions and an account with more than 50 subscriptions.
- Preview should skip existing follows and hidden reactors, count unmatched channels, deduplicate IDs, and allow selections to be changed.
- Confirm, refresh and sign back in: selected follows persist. Re-import adds no duplicates. A different site member sees only their own follows.
- Hide a selected reactor in another tab before confirmation: server skips it. Existing ratings, hidden state and other follows stay intact.
- Cancel during pagination: no follows are changed. An API error or expired token gives a retry message and no partial preview. Review browser network requests: Google token only to Google; backend request contains selected IDs only.
- Remove configuration or deny permission: manual follows remain usable. Test quota failures with fixtures rather than consuming production quota.

The local automated checks cover pagination, duplicate IDs, malformed pages, quota/expiry/cancellation errors, preview exclusions, origin/authentication validation, account isolation, unknown IDs and additive import. Actual Google consent remains a manual release gate requiring configured OAuth credentials and a permitted test account.

References: [GIS token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [subscriptions.list](https://developers.google.com/youtube/v3/docs/subscriptions/list), [OAuth verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification).
