# YouTube connection, imports and revocation

Members use Reactors → Connect YouTube. Google grants read-only offline access in a redirect flow. Back on Reaction Journey, a preview opens automatically. Connected members can select Preview subscriptions to check again. Review up to 100 matching reactors per batch; the count of remaining reactors is shown above the list. Confirming imports only selected reactors and automatically displays the next batch. Unselected reactors are skipped for this preview and may be reviewed again later. Finish for now closes a preview while preserving confirmed imports. Connection management is available only while connected and outside an active preview. Imports do not synchronize automatically or change YouTube subscriptions.

Disconnect YouTube and delete imported follows asks for confirmation, immediately removes the tracked follows and connection, cancels pending authorization, and requests Google token revocation. It preserves manually added follows, ratings, favorites and hidden reactors. Retrying revocation uses an encrypted private queue for at most seven days. Members can revoke directly in Google account connections as well. Definitive invalid_grant or scope loss removes the connection and tracked follows; temporary network errors or invalid_client configuration failures do not immediately purge them. Cron checks due connections daily in batches of 20, independent of discovery. Connections unverified for 25 days are removed to bound authorized-data retention, including during Google outages. If scheduling is unavailable, deadlines cannot be guaranteed; monitor production cron.

## Required production configuration

Apply migration 0040 with the normal D1 migration workflow before deploying. Use a dedicated Google OAuth Web application client for the YouTube connection; keep Supabase login configuration unchanged. Enable YouTube Data API v3. Declare youtube.readonly in Data Access and complete Google verification.

Set the public variables GOOGLE_YOUTUBE_CLIENT_ID and YOUTUBE_OAUTH_ORIGIN (exact HTTPS origin, no trailing slash, e.g. https://reactionjourney.com). Add the exact Authorized redirect URI https://reactionjourney.com/api/youtube/subscriptions/callback in that client's Google configuration. The old JavaScript origin alone is insufficient.

Keep both public variables in the production `wrangler.jsonc`, not solely in dashboard settings or a local release file: a normal deployment replaces plain environment variables from source. The build's release checks validate this configuration. Preserve the existing encrypted secrets and encryption key. A callback request with no OAuth state should return 400 (invalid request); 503 means required connection configuration is incomplete. This read-only probe does not create a connection or exercise Google consent.

Store GOOGLE_YOUTUBE_CLIENT_SECRET and YOUTUBE_TOKEN_ENCRYPTION_KEY as Cloudflare encrypted secrets, never source or browser variables. Generate the encryption key with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` and submit directly to the Cloudflare secret input. It is a 32-byte base64url AES-GCM key (43 characters). Do not paste credentials into chat, commit them, or print deployed secrets. Preserve this key securely in the recovery process; replacing it without re-encryption makes existing credentials unreadable. Configure staging separately. Missing configuration fails closed for new imports; manual follows and local disconnect remain available.

Review Cloudflare request logging to avoid retaining OAuth callback query parameters containing codes/state; code is single-use, PKCE-protected and short-lived but should not be logged. Application logs do not include tokens or provider response bodies. Do not record or upload configuration-secret screens in the Google demo. Re-record the consent/import/disconnect flow because the architecture and disclosures changed.

## Data handling and concurrency

The redirect uses random state, a secure HttpOnly SameSite=Lax callback cookie, ten-minute state expiry, one-time server state consumption, and S256 PKCE. State is bound to the initiating site member. Disconnect cancels state even during token exchange; the callback cannot insert a connection after its state is removed. Codes are never sent to other page assets; callbacks send no-referrer and no-store headers and redirect to a safe status URL.

Refresh tokens and temporary PKCE verifiers are AES-GCM encrypted with connection/state identifiers as authenticated context. The browser never receives Google tokens. Subscription responses are processed server-side only on demand; extracted channel IDs are sent to browser memory. No subscription list is persisted. The server refreshes/checks permission before every preview and follow confirmation. Each confirmation includes its connection ID, and atomic inserts require that connection to still exist. A disconnect racing with confirmation cannot recreate orphan imported follows.

Imported follow provenance precedes follow insertion in the same transaction. Activity triggers omit tracked import additions/removals so Google-derived data is not recorded in moderator activity. Unfollow/reset clears provenance, allowing later manual follows to survive disconnect. No ratings or unrelated preferences are deleted. Saved following groups exclude tracked imported follows; group switching selects either a manual group or the dedicated import group; import membership is read from its connection tracking records and is never copied into manual snapshots.

## Existing imports

The old database did not record provenance. Migration 0040 does not guess or mark all existing follows as imported. Historic imported follows and follow activity therefore need member-assisted review; the UI and policy disclose this. Members can individually unfollow them or explicitly use Following → Reset all reactor follows (which also removes manual reactor follows). Support can remove identified historic activity records after identity verification. This legacy remediation remains a launch/review item, not an automatic bulk deletion.

## Validation

Run npm run build and node --test tests/youtube-subscriptions.test.mjs tests/cloudflare.test.mjs tests/social.test.mjs. Tests cover encryption binding, OAuth state/cookie/PKCE replay checks, disconnect during exchange, transient versus definitive failures, account isolation, stale confirmations, provenance, and revocation retries.

Production validation after secrets/redirect setup: connect a Google test account; import selected channels; confirm manual follows survive disconnect; revoke in Google settings and run/wait for the permission-check batch; verify tracked follows/connection are removed. Check consent denied and cancelled, service errors preserving follows, and safe callback URLs. Never use a real member's connection for destructive verification.


### Dedicated YouTube imports group

YouTube imports are saved in a separate system-managed Following group named YouTube imports. Importing does not switch your active group or add reactors to other groups. Select YouTube imports in Following to use those reactors in the Following feed. Re-importing adds newly selected reactors without duplicates. You can remove individual reactors while that group is active; manual groups can independently contain the same reactor. The import group cannot be renamed, deleted, cloned, or overwritten by saving current follows. Disconnecting or revoking YouTube clears tracked imports while preserving manual groups. Older imports without tracking cannot be identified automatically. Existing group contents already lost are not reconstructed.
