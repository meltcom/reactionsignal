## Current allowance: 5,000 units

The daily ceiling is 5,000 within the shared 10,000 general-unit project allocation. Admission still stops at 8,000 combined usage to preserve 2,000 units for RJ at admission time. RJ may continue using its reserve afterward. Earlier usage remains charged; no reset or recognition-policy change is included.

# Missioned Souls historical backfill pilot

With `RJ_BACKFILL_AUTO_PUBLISH=1`, each normal scanner run first processes saved unresolved candidates in channel batches of up to 50. A local publication ledger checkpoints published, existing, excluded and skipped results. Explicit local review outcomes are preserved. The broker audit is checked before submission and after each successful batch, so interrupted runs can recover existing server additions. Audit lookups cost zero YouTube units. Metadata rechecks use the same daily allowance and shared reserve as the upload scan.

The dashboard reports pending and processed saved candidates. Received receipts and audit-confirmed publications are deduplicated by video ID and attributed to their Pacific publication day. Original candidate metadata and review history are preserved. The new local ledger is created automatically when opening an existing campaign.

Automatic publication requires both `BACKFILL_AUTO_PUBLISH=1` on the RJ Worker and `RJ_BACKFILL_AUTO_PUBLISH=1` in the Python launch environment. The Worker evaluates fresh metadata from the existing quota-metered request. It adds only public historical reactions on eligible channels and preserves existing RJ records and exclusions. Every addition has a server audit entry. Python's daily and weekly `published` counts reflect received broker receipts.

For a bounded release check, stop the local pilot first and use its normal credential environment to run `python pilot.py --data data --publish-saved VIDEO_ID ...` with up to ten saved unresolved IDs. The command rechecks those IDs under the existing quota gates and reports the confirmed additions. A lost response may leave the server audit ahead of the local receipt count. Check the server audit before retrying or reporting final totals.

Release candidate 0.5.1. The client identifies itself as `ReactionJourneyBackfillPilot/0.5.1`; Cloudflare rejects the default Python user agent on the live staging hostname. Local Windows application with a shared-quota RJ broker. The broker Worker source must be reviewed and deployed before live activation. No database schema migration is required.

## Shared candidate recognition

New metadata is assessed with the same versioned Missioned Souls candidate policy used by RJ. Singular names and explicitly channel-scoped weak hints produce **review candidates**, never automatic reaction approvals. Original-link/credits lines, tag-only descriptions, substring lookalikes and names assembled across fields do not qualify. Candidate evidence retains policy/version hashes, matched field/reason and the metadata hash. Existing catalog decisions and already-seen rows keep their stored classification.

The source policy lives at `server/candidate-policy.json`; the reviewed ZIP includes that exact file beside `candidate_recognition.py`. Measurement batches record the new matcher version and policy hash without rewriting older batches or frozen campaign settings. No scanner is started by building or installing the package.

To audit previously retained metadata without network access or database changes, run `python replay_candidates.py --database data/campaign.sqlite3 --output candidate-audit-v1.json`. Use a fresh output filename for each audit. This emits proposals only; it does not reclassify stored rows, alter review decisions, reset cursors or import records. Content labels and related-video/excerpt relationships still require independent evidence.

## Launch and preview

Directory: `C:/Users/meltc/OneDrive/Documents/ChatGPT/Reaction Journey/backfill-pilot`.

Double-click `launch.cmd`, then open http://127.0.0.1:8765/. Sample view: http://127.0.0.1:8767/?sample (current review server). Sample figures are illustrative. Keep the terminal running. Pause before closing; an interrupted page is safely replayed on resume. The application runs only while the local server is open. It does not install a scheduler.

For a new installation: `python -m venv .venv`, then `.venv\Scripts\python.exe -m pip install -r requirements.txt`. Python 3.12 or later is required. Timezone data is pinned because Windows Python does not include the IANA timezone database.

## Database snapshot

`export_snapshot.py` runs two fixed SELECT queries through the existing Wrangler login. It exports channel identity, scope and uploads playlists, plus existing video decisions and exclusions. It never modifies RJ or calls YouTube. Use a current reviewed RJ checkout:

```powershell
.\.venv\Scripts\python.exe export_snapshot.py --checkout 'C:/Users/meltc/.codex/worktrees/rj-discovery-measurement/Reaction Journey' --out snapshot-rj.json
.\.venv\Scripts\python.exe pilot.py --snapshot snapshot-rj.json
```

Stop an existing local server before the second command. Import a snapshot only once per campaign. Subsequent launches omit `--snapshot`. Keep the snapshot and data directory private. A campaign freezes eligible channels and its upper publication cutoff. Other/retired channels are excluded, as is the official MS channel. New RJ reactors require a subsequent campaign. The complete channel snapshot preserves their scope for review.

## Quota and credentials

This pilot makes **zero search requests**. It makes at most **5,000 total general requests per Pacific day**, including failed attempts and retries. Typically a page costs two requests (playlist plus batched metadata), with occasional channel lookup. It scans all uploads, retaining metadata even for unmatched titles, to support review without repeating quota costs. Round-robin channel selection prevents a prolific channel monopolizing the campaign.

The pilot supplements RJ using RJ's existing Google project through `/api/backfill/execute`. The YouTube key stays in the Worker. Configure only the dedicated broker credential in the local launch environment as `RJ_BACKFILL_TOKEN`; do not paste it into chat, source files or screenshots. The optional `RJ_BACKFILL_ORIGIN` defaults to `https://reactionjourney.com`; only that host and this project's staging/preview Worker hosts are accepted. Redirects are rejected.

Use **Check RJ quota readiness** to read the server gate without starting a scan. Start/resume succeeds only when the deployed broker reports verified limits, enabled backfill, a completed tracking baseline day, healthy fresh coverage, and remaining quota. The finalized configuration enables tracking and quota verification with a 10,000-unit shared general limit; backfill activation remains off until the baseline and health gates pass. The policy permits at most 5,000 backfill general calls/day, reserves at least 2,000 remaining general units for RJ, and permits no historical searches. Staging uses an independent ledger and must not make backfill provider calls alongside production. External consumers must remain stopped or explicitly budgeted.

The broker uses a single atomic reservation for both shared and backfill counters. A replayed request ID cannot send twice. A blocked request pauses the campaign and preserves its cursor. A lost response remains ambiguous and is never refunded. Tracking-only rollout precedes activation so incomplete legacy counters cannot authorize a scan. See the repository's `docs/backfill-shared-quota.md` for the complete release/activation sequence.

The reactor scan list shows every eligible reactor, its status, saved pages, unique uploads checked, review candidates, last saved page time and errors. The activity panel shows the current reactor, page and request phase; when idle it explicitly says no reactor is being scanned. Queue order follows the runner's oldest-checkpoint-first order.

At the cap, manually resume after midnight Pacific. A failed request counts even if the network timed out. Transient failures retry up to three attempts with backoff. Authentication, permission, invalid-token and unavailable-playlist errors pause processing and mark the affected channel for review. Other queued channels can continue on resume. Error channels are not silently declared complete. Resolve the cause and use a new campaign for rescanning; there is deliberately no cursor reset button.

## Results and completeness

Every returned public upload is deduplicated by video ID. Existing RJ moderation/exclusions take precedence. A Missioned Souls mention in title/description marks a review candidate; it does not establish a reaction or justify importing it. All unmatched metadata remains in SQLite and full text exports. Review those records for song-only titles, spelling variants, Shorts, compilations, interviews and missed identity evidence. A playlist sweep cannot recover private/deleted videos or guarantee semantic recall. Exhausted means no next page, not all reactions verified.

No automatic imports. Before any later import, refresh live availability, current RJ decisions and exclusions. Never use a campaign's historical snapshot as current write authorization.

Text export includes all records with raw metadata, the report, and measurement/review audit tables. PDF uses the browser print dialog: choose Save as PDF. The PDF button expands the report to every result before opening the print dialog; the text export also includes raw metadata.

## Performance checks

See [MEASUREMENTS.md](MEASUREMENTS.md) for precise metric definitions, review/sampling workflow, version attribution, and read-only RJ health monitoring.

The dashboard refreshes every four seconds. All quota dates use America/Los_Angeles, including daylight saving changes. Daily measurements: attempted requests, confirmed failed requests (unfinished attempts are reported separately), committed pages, unique uploads examined, and new review candidates. Existing decision counts and unmatched/unavailable counts are in exported totals. A page checkpoint and its evidence commit together; failed pages do not advance.

Weekly comparisons cover yesterday through seven days ago versus the preceding seven completed days. Show measured days as well as totals and candidates per request. Missing days contribute zero and do not imply normal operation. Candidate counts are not eligible additions. Local review outcomes, evidence, review time and correction history are now recorded. Production additions and Shorts relationships still require a later approved import workflow.

Daily review: confirm <=5,000 requests, zero searches, advancing checkpoints, inspect all errors, inspect candidate and unmatched samples, and confirm fresh RJ channel coverage/latency remain healthy. Weekly review: compare measured days, pages, remaining/exhausted/error channels, duplicate/unmatched yield, candidate yield and failures; sample metadata at increasing page depths. Forecast remaining work only after a measured 2–3 day pilot. No completion date or recall guarantee follows from the estimated 6,300 catalog figure.

## Release gate and rollback

Before production activation: review the sample UI; confirm scope, shared RJ quota coordination, and credentials locally; run `release.py`; review its SHA256 manifest; validate a bounded live page, checkpoint/resume, quota accounting, and both exports; then approve activation. This release candidate has not undergone that live test. Offline tests use fake API responses and consume no YouTube resources.

`release.py` runs regression checks and packages only named source files. It excludes credentials, snapshots, virtual environment and SQLite state. No unrelated RJ changes are included. Retain the package and manifest for rollback. Pause and stop the application before upgrade; copy `data/` to a dated backup. Restore the prior source package and its matching data backup if a schema changes. Do not deploy this Python application with RJ's Worker release command; any future RJ changes must independently follow AGENTS.md and guarded `npm run deploy`.
