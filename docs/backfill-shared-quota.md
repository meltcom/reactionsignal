## Optional evening catch-up release

The user authorized catch-up up to 9,500 shared general units between 20:00 and midnight America/Los_Angeles. Production opt-in BACKFILL_CATCHUP_ENABLED=1 and Python 0.6.0 opt-in RJ_BACKFILL_CATCHUP=1 are coordinated. The broker uses a 500-unit admission buffer and an explicit 9,500 shared admission ceiling during that window only. Earlier charges remain charged and the same health, eligibility, search prohibition, replay and concurrency protections apply. Outside that window the 5,000 backfill ceiling and 2,000 admission reserve apply. RJ may subsequently consume the buffer. Server request audit records identify catch-up reservations.

The Python dashboard monitor checks every 30 seconds during the evening window and only resumes a previously started, armed, quota-stopped campaign. Manual Pause disarms it. Completed sweeps and unknown-response/auth errors do not trigger catch-up. The monitor is tied to the running server and does not install a new scheduler; the existing normal midnight resume remains. Midnight restores normal limits per request. No production migration or campaign reset. The four-hour window cannot guarantee all usable units will be consumed; observe actual catch-up progress and shared usage before changing pacing.

## Current authorized release: 5,000-unit ceiling

The user authorized 5,000 backfill general units per Pacific day, replacing the previous 1,000 ceiling. The shared cap remains 10,000, with at least 2,000 remaining units required when admitting backfill, zero backfill search calls, and unchanged discovery-health gates. RJ is not capped at 2,000 and may consume the reserve after backfill stops. Server and Python 0.5.1 must be upgraded together. Previously charged usage is retained. No migration, campaign reset, scheduler change or candidate-recognition expansion is included. Historical rollout notes below retain their original limits.

# Shared RJ quota coordinator — review scope

Source base: current main 465ec80. No production deployment, activation or migration is implied by this document.

## Exact release scope

- Add a narrow `/api/backfill/status` and `/api/backfill/execute` broker for the standalone catalog pilot. The broker accepts a dedicated `BACKFILL_API_TOKEN` secret; it does not reuse the broader discovery token, expose the YouTube key, mutate catalog decisions or import candidates.
- Track all production Worker general YouTube list requests: recent/history discovery, notifications, metadata/channel refresh, format checks, community/reconciliation, official-channel scans/playlists and connected subscription reads. OAuth token exchanges, RSS and keyword searches do not use this general bucket.
- Use one D1 transactional compare-and-increment for combined general and backfill counts, before each provider request. No new schema migration is required: only isolated `youtube-quota-v1:*` and `backfill-upload-playlist:*` state keys are added. Request tickets retain outcomes for eight days; scheduled cleanup removes at most 200 expired tickets per invocation.
- The Python client uses the broker instead of a direct YouTube key. It keeps local checkpoints, evidence and review history. Server denials preserve the reactor cursor and do not mark the reactor unavailable.
- No frontend member-app changes. No change to fresh search's existing 40-attempt allowance or its scheduling/rotation. Historical keyword search remains a later change; this broker explicitly forbids search.

## Limits and defaults

The finalized limits are **10,000 shared general units per Pacific day**, **300 backfill general requests maximum**, at least **2,000 remaining general units reserved for RJ**, and **zero backfill search calls**. Google Cloud Console confirmed project `missioned-souls-tracker` has 10,000 general units/day and a separate 100 searches/day allocation on October 30, 2026. RJ retains its existing 40-search daily allowance. The user confirmed the remaining key association and shared-consumer verification before authorizing finalization and staging. A new key in the same project does not create quota, and a second project must not be used to supplement this application's quota.

Tracking and quota verification ship **on**, with backfill activation **off** (`BACKFILL_ENABLED=0`). Staging has no scheduled discovery and uses the separate preview database. Its ledger does not coordinate with the production ledger, so staging must not run YouTube backfill alongside production. Staging checks are limited to authenticated application behavior and broker admission/denial without provider calls. In tracking-only mode RJ remains operational and is counted without imposing an unverified global limit. With a verified configured limit, RJ can use the full shared limit; backfill stops at the earlier of its own daily allowance and shared limit minus the reserve. This guarantees the configured reservation floor, not unlimited primary usage or immunity from outside clients.

Backfill also requires a discovery-health sample no older than 30 minutes, at least 95% eligible-channel recent coverage, and a succeeded/partial run. Missing, stale, failed or insufficient coverage blocks backfill. This is an admission check before every request. It cannot cancel work already admitted before a later health change.

The initial instrumentation day blocks backfill. Known legacy UTC request counters are carried conservatively that day; subsequent fully tracked Pacific days start at zero and count requests as they are reserved. Do not bypass this baseline check or disable tracking while backfill is enabled. After a rollback or instrumentation gap, stop backfill and establish a fresh baseline before reenabling it.

Requests, timeouts, failed upstream calls and ambiguous responses are never refunded. Repeating the same request UUID within a Pacific day cannot reserve or send twice; a replay returns 409 rather than caching large metadata bodies in D1. A new retry UUID is a separately charged attempt. Server denials have zero provider units; lost responses remain explicitly ambiguous in the local report. All transmitted provider calls use the existing Worker key.

## Activation sequence after review

1. Re-read current AGENTS.md and deployment-safety.md. Reconfirm current main and active provider versions before any deployment. Stage the finalized source once after checking the staging migration baseline and signed-in moderator browser readiness; use the existing guarded release process.
2. Quota limits and the public OAuth client were checked in Google Cloud Console; the user confirmed the remaining key/consumer checks. The configured shared general cap is 10,000, with backfill capped at 300 and blocked at 8,000 combined usage. If an outside consumer resumes, stop backfill and revise the shared cap before enabling it.
3. Deploy the reviewed source with `npm run deploy` after merge, without unrelated local changes or migrations. Verify release identity and the signed-in feed. Initially keep `BACKFILL_ENABLED=0`; tracking is enabled in the reviewed configuration to measure its overhead through a complete baseline day.
4. Establish the dedicated broker credential privately through the normal secret mechanism and set the same credential only in the local pilot's `RJ_BACKFILL_TOKEN` launch environment. Never paste it into chat, commit it or include it in screenshots. Keep staging and production credentials separate. Configure the verified shared limit/reserve/allowance; enable only after the baseline and signed-in health checks pass.
5. Validate one bounded live page, its server receipt, aggregate counters, cursor resume, fresh discovery and both exports before starting the multi-day evaluation. Local tests and HTTP 200 are not evidence of production effectiveness.

Manual scripts such as `scripts/preview-format-recovery.mjs` and the old Python scanner execute outside the Worker gateway. Stop them during the pilot or explicitly budget their usage. The coordinator cannot discover every external consumer by itself. This limitation must remain visible in monitoring.

## Verification and recovery

### November 2 operating pilot allowance

The user authorized accelerating the catalog backfill after reviewing the two-unit diagnostic bottleneck and the 300-unit operating ceiling. This release changes only the production backfill ceiling from 2 to 300 general requests per Pacific day. Already charged requests remain charged; the release does not reset the ledger. Keep the shared 10,000-unit cap, 2,000-unit RJ reserve, zero backfill searches, discovery-health admission, existing credential and staging backfill denial unchanged. No migrations, discovery scheduling changes, new campaign snapshot, cutoff changes or catalog imports are included.

The installed 0.4.0 client already batches up to 50 unknown video IDs, skips known IDs, caches uploads playlists and saves each page checkpoint. The frozen campaign contains 437 eligible reactors, all with uploads playlists cached; current live RJ coverage includes additional reactors, which require a later campaign. Preserve this campaign rather than resetting it to include them.

After the guarded release and its signed-in workflow verification, perform one bounded uploads-page call sequence with at most two additional provider requests. Reconcile server receipts and counters, reopen the saved checkpoint without repeating the page, and validate text/PDF reports before starting the seven-day operating pilot. Review the first completed 24 hours to adjust the forecast. The seven days contribute to the actual backfill; they are not a throwaway trial. No scheduler or automatic daily restart is included. The UI must remain open, and a cap pause needs manual resume after the Pacific reset.

### November 2 bounded fixture check

After the complete November 1 Pacific tracking baseline, production broker admission is enabled with a temporary **two-unit daily backfill ceiling** for the authorized missing-metadata check. The shared 10,000-unit cap, 2,000-unit RJ reserve, zero backfill search allowance and current-health gate remain unchanged. The 300-unit figure above remains the reviewed maximum for a later pilot, not this diagnostic's active allowance. Staging remains disabled and must not call YouTube.

The diagnostic requests only the saved 11 Bobcat and 22 BluebonnetBob IDs in two videos.list batches, with no automatic retries, catalog imports, full scanner or scheduler. Retain UUID receipts, raw responses, metadata hashes and a single-use local journal; reconcile both receipts and the daily backfill delta. An ambiguous attempt must be investigated without automatic retransmission. The server ceiling resets each Pacific day; it is not a permanent one-time budget. No multi-day scanner is authorized by this configuration. Revisit activation and the ceiling through the guarded workflow before any broader run.

The baseline establishes quota accounting and recent-check coverage, with substantial RSS degradation during parts of the day and sparse discovery-delay samples. It does not establish recall or stable RSS reliability. Recheck fresh health immediately before capture. One two-batch diagnostic does not replace the separate bounded uploads-page, checkpoint/resume and export checks required before a multi-day evaluation.

Tests exercise atomic competing reservations, idempotency, independent daily cap, the RJ reserve, Pacific reset, conservative initial carryover, health admission, network failures, legacy-client double-count prevention, broker authorization and playlist binding. Existing release/regression tests remain required. No live search/scan is part of the automated tests.

Provider-path regression checks also run the real gateway and broker inside `workerd`, using isolated local D1 state and mocked outbound responses. Node-only fetch mocks do not validate Workers request options. Workers rejects `redirect: 'error'` before sending; use `manual`, retain the charged HTTP outcome, and reject broker redirects without parsing their bodies or forwarding `Location` or credentials. The October 31 initial rollout was restored to the recorded known-good version after this runtime mismatch was detected. Retain those failed reservations and establish a fresh complete tracking baseline after recovery before enabling backfill.

If backfill affects fresh coverage, set `BACKFILL_ENABLED=0` first. Preserve counters, evidence and bindings. Use the recorded provider rollback version if the application release itself is faulty, verify the signed-in feed, and reestablish a full tracking baseline before resuming. Configuration changes must use the guarded release/configuration workflow and must not silently alter unrelated production settings.
