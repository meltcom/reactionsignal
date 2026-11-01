# Deployment safety

The October 22, 2026 countdown publish used a downloaded legacy Worker upload as a source of truth without matching it to the active production deployment. The patch checked three presentation assets and preserved bindings, but then uploaded the entire Worker. Matching HTML/CSS did not establish that the bundled backend and every other asset were current. The verification also omitted the signed-in feed. The shortcut in `tmp/publish-concert-countdown.mjs` is retired.

## Supported release

1. Review the source changes and obtain authorization for the exact scope. `npm run deploy` stops on a dirty checkout. Use `npm run deploy -- --allow-dirty` only after those uncommitted changes have been approved.
2. The deployment script records active production version IDs, rebuilds from this checkout, runs release/feed/security tests, and checks source and artifact fingerprints. It stops if production changes while preparing the release.
3. Wrangler's configured build command repeats the build and gates even for direct `wrangler deploy`. Do not bypass the build or use temporary deployment configurations or downloaded bundles.
4. The script verifies that one new Worker version receives 100% of traffic and that the public `/release.json` exactly matches the build's source hash and build timestamp. The source hash covers frontend, backend, dependencies/configuration and packaged asset inputs; the artifact hash detects replacement or corruption of generated files. No credentials are included in release metadata.
5. Open production in an authenticated browser. Confirm My Feed renders actual video cards, the current interface is visible, and the requested change works. A successful upload or HTTP 200 is not functional verification. Save the screenshot and report any verification limitations.

`output/last-deployment.json` records the prior version IDs for recovery and the deployed version/build identity. If the release is faulty, restore the recorded prior version with Wrangler's version deployment command, then verify the signed-in feed again. Do not reconstruct a rollback from the legacy script download endpoint.

Run `npm run deploy:check` for a read-only freshness/integrity check. Database migrations remain separate (`npm run db:migrate`); only run migrations required and authorized for the release.

Artifact fingerprints read every non-directory entry, including file links and OneDrive placeholders. A placeholder's directory-entry type can change during hydration without changing its bytes; filtering only `Dirent.isFile()` can omit a packaged asset and produce a false mismatch. Unreadable entries and directory aliases fail closed. Keep the complete byte seal and all release gates; do not waive an integrity failure based on matching UI assets.

These safeguards apply to the checked-in release commands and agent instructions. They cannot prevent a human or another tool with Cloudflare access from bypassing them. The signed-in browser check remains an explicit required step; the command prints it as incomplete rather than claiming it ran automatically.

The `/release.json` identity is available after deploying a build containing these changes. Adding the guards locally does not change the currently running site.

## Reconciled release restrictions
The guarded release now first verifies a clean main (or detached main) checkout against GitHub’s live main ref. A feature branch cannot publish production. The --allow-dirty exception does not bypass the current-main requirement. Source fingerprints include migrations, tests, documentation and deployment instructions as well as runtime code. Rollback references are written before upload, and all local regression tests run before deployment. Builds and deploys do not apply migrations. A signed-in real-browser production check remains a separate required step.

## Consolidated checkout gate
Production releases require current GitHub main (or its detached commit). Local builds and tests remain available on review branches. The production Wrangler configuration also enforces this gate, so a feature branch cannot directly deploy through it. Use separately configured preview environments for branch previews. No build automatically migrates any database.

Validation without publishing: run npm test, npm run deploy:check, and npm run release:check. The latter uses an isolated local SQLite fixture; it is not a production or browser benchmark. Do not run npm run deploy as a test.

## Final upload check
Wrangler's final build step re-reads production versions after rebuilding and running regression checks, immediately before it returns control for upload. The guarded command supplies the expected versions and an in-memory credential; neither is stored in source. Direct production Wrangler uploads without that context fail closed: use npm run deploy. This narrows the race window; it is not an atomic provider-side lock against simultaneous external deployments.

## Isolated staging release
Run npm run deploy -- --staging from a clean, committed review checkout. This durable configuration targets only reactionsignal-staging and the existing reaction-signal-preview database. It rebuilds, runs all tests and integrity checks, saves production/staging references, verifies the new staging version and live identity, and confirms production is unchanged. No migrations, secrets or production routes are copied. Discovery search and cron schedules are disabled; the existing test-email allowlist is retained. Browser sign-in still uses the existing Supabase service and requires its redirect policy to allow staging. Never relax authorization or paste access tokens to make a staging check pass.
