# Reaction Signal — Cloudflare deployment

A member-gated reaction catalog with YouTube discovery, upload notifications, comments, chat, member reports and moderator removal tools. This package hosts the full application directly on Cloudflare Workers. It does not require the private Sites relay.

## Your configuration

- GitHub repository: https://github.com/meltcom/RSScript
- Worker name: `reaction-signal`
- D1 database name: `reaction-signal-catalog`
- D1 database ID: `331e0607-6cf1-4e5c-864e-8b2179e750df`
- Database binding: `DB`
- Scheduled handler: every 15 minutes, configured in `wrangler.jsonc`
- Initial member allowlist: `meltcom@gmail.com`

Confirm that the supplied Database ID belongs to the named D1 database in the same Cloudflare account used for deployment. This package has not been deployed to your account or uploaded to GitHub.

## Upload to GitHub

1. Extract the ZIP.
2. Open the `RSScript` repository on GitHub and choose **uploading an existing file** (or **Add file → Upload files** once it has a commit).
3. Drag the extracted **contents** into the upload area, including the `server`, `scripts`, `db`, `drizzle` and `tests` folders. Keep `package.json`, `README.md` and `wrangler.jsonc` at the repository root; do not add a parent folder.
4. Commit the files to `main`.
5. Confirm that those three root files and the folders are visible on GitHub. Uploading the ZIP itself does not unpack the project and is not sufficient.

Only source files and a bundled historical catalog are included. Credentials, account sessions, private Site metadata, installed dependencies and build output are excluded. The public repository will expose the bundled catalog's public video/channel metadata and prior catalog corrections; never upload real secret values.

## Cloudflare build settings

Use **Workers & Pages**, not a static-only Pages deployment:

| Setting | Value |
| --- | --- |
| Application / Worker name | `reaction-signal` |
| Repository | `meltcom/RSScript` |
| Production branch | `main` |
| Root directory | Leave blank (repository root) |
| Build command | `npm run build` |
| Deploy command | `npm run deploy` |
| Preview builds | Disable during setup |

Workers Builds installs the project dependencies. The deploy script applies the six schema migrations to your D1 database before uploading the Worker. If migrations fail, deployment stops. The Cloudflare build API token needs **Account → D1 → Edit** as well as its Worker deployment permissions, scoped to your account. Cloudflare's automatically generated build token may not include D1 permission; add it or choose an appropriately scoped token. Keep that token in Cloudflare's build settings, never GitHub source.

The project requires Node.js 22.13 or newer for its SQLite-based tests. If the build uses an older version, set its build environment variable `NODE_VERSION` to `22` or another supported newer version.

Cloudflare's Worker name must match `reaction-signal` in the configuration. If you already created the application with a different name, change the configuration's `name` to match before deploying.

## Runtime settings

After the first deployment, open the Worker → **Settings → Variables and Secrets**. Runtime settings are separate from build settings.

| Name | Type | Value |
| --- | --- | --- |
| `YOUTUBE_API_KEY` | Secret | Your restricted YouTube Data API key |
| `SUPABASE_URL` | Variable | Your Supabase project's HTTPS URL |
| `SUPABASE_PUBLISHABLE_KEY` | Variable | Your Supabase publishable key; never a service-role key |
| `COMMUNITY_MODERATOR_EMAILS` | Secret or variable | `meltcom@gmail.com`, plus any designated moderator emails |
| `YOUTUBE_PUSH_CALLBACK_URL` | Variable | `https://YOUR-WORKER.workers.dev/api/youtube/push` |
| `DISCOVERY_TOKEN` | Secret | A strong random token, only if you need protected manual HTTP discovery |

The database and scheduled handler are wired in `wrangler.jsonc`. Native scheduled discovery does not need `DISCOVERY_TOKEN`. No OpenAI key is needed.

Configure Supabase's Site URL and allowed redirects for the new Worker origin. Configure email confirmation/password recovery and Google OAuth separately. The public welcome page is reachable, but the member allowlist initially limits catalog access to `meltcom@gmail.com`. Add invited users to `MEMBER_EMAIL_ALLOWLIST` in the configuration before opening access more widely. Keep moderators on that allowlist too. To intentionally open sign-up later, set the allowlist to an empty string. Changes to values managed in `wrangler.jsonc` should be made in GitHub so future deployments preserve them.

## Data and cutover

An empty database first receives the bundled reconciled snapshot from `data.json` and `import-run.json`, using repeatable insert-only initialization. This is **not a complete export of the live private Site database** and is not guaranteed to include the user's latest master workbook. Live member accounts, comments, chat, preferences, reports, performer edits and corrections are not migrated by this package.

Keep the current private Site until its live database is exported and reconciled with this new catalog. Do not run both discoveries indefinitely against the same YouTube project: both consume its shared quota. Subsequent code deployments retain D1 data; do not delete/reset the database to update code.

## Verify before launch

1. Confirm deployment and database migrations succeed.
2. Confirm the welcome page opens anonymously, while `/data.json` and `/api/status` reject anonymous requests.
3. Verify your email and sign in. Confirm Moderator Queue appears only for designated moderators and an uninvited verified account cannot browse the catalog.
4. Add the YouTube key and callback URL; choose **Connect / renew channel notifications** in Moderator Queue. Registered subscriptions become active only after the hub's verification succeeds.
5. Observe a real upload. Clear full-length matches publish automatically and create one moderator inbox notice. Short or ambiguous matches remain held. Notifications are in the website, not email.
6. Test Keep, Remove and member removal requests. Check that exclusions survive another scan or notification.
7. Observe actual Cron Events and discovery history. A scheduled handler existing in source is not evidence that a successful unattended run happened.
8. Test mobile use, password recovery, backup/restore and the live-data migration before inviting more users.

## Development

- `npm ci`
- `npm run build`
- `npm test`
- `npm run dev` (uses Wrangler's local D1 during development)

Cloudflare documentation:
- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- https://developers.cloudflare.com/d1/reference/migrations/
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
