# The Warning — Reaction Journey free pilot

This is a **separate, read-only first deployment** for The Warning. It reuses the parent repository, Cloudflare Workers platform, and a reusable band-configured site shell. It does **not** change the Missioned Souls Worker, its D1 database, its YouTube API quota or its member records. No paid subscriptions are enabled.

## Scope and limitations
- Responsive dark-mode landing page and curated reaction catalog.
- Search by title, song or creator; creator filter; newest/oldest/title sorting.
- Direct links to the YouTube creators. No copying videos or hosting streams.
- Initial catalog has four web-discovered reaction links; this is **not** a complete or live-verified reaction catalog.
- This pilot deliberately has **no account sign-in, comments, reactions submission, moderation, scheduled discovery, background scanning, D1 or Supabase**. None should be claimed as working here. Further work is needed for parity with RJ.
- No official band branding or logos are copied; this is explicitly marked unofficial.
- The HTML has `noindex,nofollow` during pilot review; remove it only when approved for public discovery.

## What is shared and how it expands
- `sites/band-site/worker.mjs`, `sites/band-site/public/`: reusable band-site MVP shell.
- `sites/band-site/site-config.mjs`: distinct band names, links, starter catalog and color config.
- `wrangler.the-warning.jsonc`: separate Worker configuration using `SITE_KEY=the-warning`, with no production D1 binding and no Cron trigger.
- Once accepted, migrate the mature RJ catalog, discovery, member and moderator features into the band-aware service with `band_id` authorization. Do not point this pilot at the production D1 database as a shortcut.

## Run and verify locally
At the repository root, with Node.js 22+ and Wrangler 4:
```bash
node --test tests/the-warning-pilot.test.mjs
npx wrangler@4 dev --config wrangler.the-warning.jsonc
```
Open the local URL printed by Wrangler. Verify `/api/health`, `/api/config`, `/api/catalog`, searches, sorts, mobile layout and all four outbound links.

## Deploy to isolated Cloudflare staging
Run from the repository root with an authenticated Cloudflare Wrangler session:
```bash
npx wrangler@4 deploy --config wrangler.the-warning.jsonc
```
This creates/updates Worker `reactionjourney-the-warning`, **not** the existing `reactionsignal` Worker. Confirm the resulting `workers.dev` URL from Wrangler output; do not guess it.

For the requested domain, open Cloudflare **Workers & Pages > reactionjourney-the-warning > Domains > Add Domain** and attach `thewarning.reactionjourney.com` as a Custom Domain after the isolated Worker has passed staging checks. Confirm that the DNS zone and Worker belong to the correct Cloudflare account and that the existing `reactionjourney.com` route is unchanged.

Do not route the subdomain to the existing Missioned Souls Worker. Review the domain's security/visibility settings before publicly sharing it.

## Catalog provenance (manual pilot seeds)
- `QpNtUo4U61Y` — RJS_Reactions — Aug 29, 2026
- `r6n2Ik3aNMM` — ih8grace2 — Aug 29, 2026
- `kcY6wNXfmno` — Highly Combustible Reacts — Aug 18, 2026
- `ACyCAsBSpXg` — MommaOG — Sep 6, 2024

Entries originated from public YouTube search results. URLs, availability and metadata should be checked during deployment and periodically after launch. Do not present these four records as a complete inventory.

## Next iteration before memberships
1. Provision a separate D1 catalog for The Warning; migrate and parameterize performers, matches, channels and song categories.
2. Import verified reaction metadata and add moderator review controls.
3. Add per-band authorization through Supabase and reuse RJ members, ratings and Saved Views.
4. Adapt scheduled discovery and quota tracking with clear shared-project budgets.
5. Verify isolation with cross-band permission tests; then introduce optional subscription features separately.
