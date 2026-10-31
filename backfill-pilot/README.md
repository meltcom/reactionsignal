# Missioned Souls historical backfill pilot

Release candidate 0.3.0. Local Windows application with a shared-quota RJ broker. The broker Worker source must be reviewed and deployed before live activation. No database schema migration is required.

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

This pilot makes **zero search requests**. It makes at most **300 total general requests per Pacific day**, including failed attempts and retries. Typically a page costs two requests (playlist plus batched metadata), with occasional channel lookup. It scans all uploads, retaining metadata even for unmatched titles, to support review without repeating quota costs. Round-robin channel selection prevents a prolific channel monopolizing the campaign.

The pilot supplements RJ using RJ's existing Google project through `/api/backfill/execute`. The YouTube key stays in the Worker. Configure only the dedicated broker credential in the local launch environment as `RJ_BACKFILL_TOKEN`; do not paste it into chat, source files or screenshots. The optional `RJ_BACKFILL_ORIGIN` defaults to `https://reactionjourney.com`; only that host and this project's staging/preview Worker hosts are accepted. Redirects are rejected.

Use **Check RJ quota readiness** to read the server gate without starting a scan. Start/resume succeeds only when the deployed broker reports verified limits, enabled backfill, a completed tracking baseline day, healthy fresh coverage, and remaining quota. Server defaults leave tracking and activation off and the shared project limit unset. The review policy is at most 300 backfill general calls/day, at least 2,000 remaining general calls reserved for RJ, and no historical searches. External consumers must still be accounted for when assigning the shared limit.

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

Daily review: confirm <=300 requests, zero searches, advancing checkpoints, inspect all errors, inspect candidate and unmatched samples, and confirm fresh RJ channel coverage/latency remain healthy. Weekly review: compare measured days, pages, remaining/exhausted/error channels, duplicate/unmatched yield, candidate yield and failures; sample metadata at increasing page depths. Forecast remaining work only after a measured 2–3 day pilot. No completion date or recall guarantee follows from the estimated 6,300 catalog figure.

## Release gate and rollback

Before production activation: review the sample UI; confirm scope, shared RJ quota coordination, and credentials locally; run `release.py`; review its SHA256 manifest; validate a bounded live page, checkpoint/resume, quota accounting, and both exports; then approve activation. This release candidate has not undergone that live test. Offline tests use fake API responses and consume no YouTube resources.

`release.py` runs regression checks and packages only named source files. It excludes credentials, snapshots, virtual environment and SQLite state. No unrelated RJ changes are included. Retain the package and manifest for rollback. Pause and stop the application before upgrade; copy `data/` to a dated backup. Restore the prior source package and its matching data backup if a schema changes. Do not deploy this Python application with RJ's Worker release command; any future RJ changes must independently follow AGENTS.md and guarded `npm run deploy`.
