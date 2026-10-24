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

These safeguards apply to the checked-in release commands and agent instructions. They cannot prevent a human or another tool with Cloudflare access from bypassing them. The signed-in browser check remains an explicit required step; the command prints it as incomplete rather than claiming it ran automatically.

The `/release.json` identity is available after deploying a build containing these changes. Adding the guards locally does not change the currently running site.

## Reconciled release restrictions
The guarded release now first verifies a clean main (or detached main) checkout against GitHub’s live main ref. A feature branch cannot publish production. The --allow-dirty exception does not bypass the current-main requirement. Source fingerprints include migrations, tests, documentation and deployment instructions as well as runtime code. Rollback references are written before upload, and all local regression tests run before deployment. Builds and deploys do not apply migrations. A signed-in real-browser production check remains a separate required step.

## Consolidated checkout gate
Production releases require current GitHub main (or its detached commit). Local builds and tests remain available on review branches. The production Wrangler configuration also enforces this gate, so a feature branch cannot directly deploy through it. Use separately configured preview environments for branch previews. No build automatically migrates any database.

Validation without publishing: run npm test, npm run deploy:check, and npm run release:check. The latter uses an isolated local SQLite fixture; it is not a production or browser benchmark. Do not run npm run deploy as a test.
