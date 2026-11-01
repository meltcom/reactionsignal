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

Tests exercise atomic competing reservations, idempotency, independent daily cap, the RJ reserve, Pacific reset, conservative initial carryover, health admission, network failures, legacy-client double-count prevention, broker authorization and playlist binding. Existing release/regression tests remain required. No live search/scan is part of the automated tests.

Provider-path regression checks also run the real gateway and broker inside `workerd`, using isolated local D1 state and mocked outbound responses. Node-only fetch mocks do not validate Workers request options. Workers rejects `redirect: 'error'` before sending; use `manual`, retain the charged HTTP outcome, and reject broker redirects without parsing their bodies or forwarding `Location` or credentials. The October 31 initial rollout was restored to the recorded known-good version after this runtime mismatch was detected. Retain those failed reservations and establish a fresh complete tracking baseline after recovery before enabling backfill.

If backfill affects fresh coverage, set `BACKFILL_ENABLED=0` first. Preserve counters, evidence and bindings. Use the recorded provider rollback version if the application release itself is faulty, verify the signed-in feed, and reestablish a full tracking baseline before resuming. Configuration changes must use the guarded release/configuration workflow and must not silently alter unrelated production settings.
