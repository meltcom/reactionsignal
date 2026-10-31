# Measurement protocol — release candidate 0.3.0

This records local pilot activity and reviewed effectiveness. It does not activate YouTube scanning, implement historical keyword searches, reserve shared production quota, or import videos into RJ. Shared reservations occur only through the separately deployed broker after its activation gates pass.

## Evidence and provenance

Each upload page attempt creates a measurement batch with an immutable ID, strategy, measurement/matcher versions, running Python source hash, configuration hash/JSON, RJ snapshot hash, reactor, historical cutoff and page depth. Query and date-window fields are included for a future keyword runner; there are no keyword results yet.

Each network attempt is reserved before sending and records its batch, endpoint, quota bucket/units, retry index, start/finish timestamps, HTTP failure code where available and elapsed milliseconds. Transport failures and retries consume the request allowance. Reserved requests with no outcome are **unfinished**, not failed. Legacy attempts have null attribution and remain explicitly legacy. No historical attribution or timing is invented.

Page evidence, encounter dispositions, new records, completion and the channel cursor commit in one SQLite transaction. Replayed pages get distinct batch IDs, and all requests remain charged. Video IDs are globally deduplicated. A repeat does not get a second first-discovery credit.

## Efficiency metrics

- **Encountered:** distinct video IDs returned within each page, including IDs already seen on other pages. Failed/deferred page work remains part of effort totals.
- **Existing IDs:** encountered IDs present in the frozen RJ catalog/moderation snapshot.
- **Repeated IDs:** encountered IDs already in the local evidence ledger, excluding those counted as existing RJ IDs.
- **Metadata IDs requested:** ID count in each reserved metadata attempt, including retries; a planned lookup blocked by the cap is not counted as a request. Batch metadata_ids stores the planned payload size.
- **Metadata IDs avoided:** known or repeated IDs omitted from a metadata request.
- **Metadata requests avoided:** one only when an otherwise nonempty page requires no metadata request. Omitting 45 known IDs from a mixed 50-ID batch saves 45 ID lookups but **zero requests**, because the five remaining IDs still need one request.
- **New records:** first-seen IDs absent from the RJ snapshot, including unmatched or unavailable records; these are not verified additions.
- **Candidates:** first-seen absent IDs with the current name-matching rule. This is not a reaction verification.
- **Verified missing:** IDs whose latest review outcome is verified_missing with evidence and an attested live check after discovery and within 24 hours of review. The reviewer must check public availability, reaction identity, current RJ catalog and moderation. The application records this attestation; it does not automate or independently certify that live check.
- **Verified/request:** latest verified-missing IDs divided by all attempts attributed to their selected discovery batches, including unsuccessful/replayed work. A later correction revises the original discovery cohort. Request-calendar totals remain separate, so an attempt across midnight is not placed into the wrong yield denominator.
- **Timing:** request duration sample count, total request time, p95 and batch duration. Batch duration includes local work and backoff. Do not subtract overlapping durations to infer exact CPU time.
- **Review time:** optional reviewer-supplied seconds, with count of timed events. Missing values are unknown. Corrections remain separate audit events.

## Reviews and sampling

The UI can page through candidate, unmatched, unavailable or all evidence. Select Review, inspect metadata/video and RJ records, choose an outcome, record a reason/evidence and save. Outcomes are verified_missing, false_positive, duplicate, excluded and unresolved. Known RJ records cannot be marked verified missing. Reviews append to history; only the most recent outcome counts in effectiveness totals.

Create saved random samples separately for name-match candidates and unmatched uploads. The program freezes the sorted population, selected IDs, seed, size and creation timestamp. The same seed and unchanged population reproduce the selection. Sample membership is checked when saving reviews. The sample's population must not be silently replaced by later discoveries.

The observed verified-missing fraction describes the reviewed subset. A 95% Wilson interval appears only after **all** sampled IDs have a resolved review; it describes the saved stratum. It is not an overall recall estimate, and an unmatched sample with zero positives does not prove no misses. Duplicate/previously cataloged qualifying reactions are not credited as missing additions. Do not combine overlapping audit samples as independent observations.

## RJ health and shared resources

Export a fresh read-only snapshot using the existing Wrangler login:

```powershell
.\.venv\Scripts\python.exe export_monitor.py --checkout 'C:/Users/meltc/.codex/worktrees/rj-discovery-measurement/Reaction Journey' --out monitor-rj.json
```

The exporter uses four fixed SELECT queries, no production writes or YouTube requests. It includes UTC endpoint counters overlapping the current Pacific day, Pacific search-budget state, 15 days of discovery health/delay observations and current 24-hour eligible-channel coverage. Import the JSON in the UI or launch with `--monitor monitor-rj.json`.

The monitor displays snapshot age, separate health-sample age, observed RJ general-request upper bound and local pilot usage. Full overlapping UTC-day totals intentionally overcount some requests outside the Pacific day. They are not exact Pacific consumption. Other API consumers, actual project quota limits and key/project association remain unknown. The snapshot is not an atomic reservation and cannot prevent concurrent consumption. Snapshots older than 30 minutes are stale; no automatic refresh is installed.

Before the pilot starts, all imported observations are baseline. After its first attributed request, compare pre-pilot and during-pilot coverage minima, failure counts, median and p90 fresh-delay samples. Older/unknown discovery delays are excluded from the fresh-delay calculation. Display sample counts and strategy/settings in the export. These are observational cohorts, often of different lengths, not proof that the pilot caused a change.

**Live activation is gated by the shared RJ broker.** The coordinator code and client are implemented; reviewed deployment, verified project settings, a full baseline day, and bounded live validation remain required. Read-only monitor snapshots alone do not authorize scanning.

## Evaluation schedule

Do a bounded live validation only after activation prerequisites are met. Start the evaluation clock after that validation succeeds. Review after three active days and extend to seven for broader reactor/page-depth coverage. An active day has actual attempts; paused days do not count as exposure.

Daily: validate request accounting and errors; inspect duplicate/candidate/verified yield; review both matching strata; compare fresh RJ coverage and delays; record stale/missing monitoring as a gap. Weekly: compare two completed seven-day periods, measured days, page depths, versions/configurations and reviewed yield. Today is partial and excluded from those weeks. Sparse samples should extend the evaluation, not produce a precise speed or completion claim.

## Data and release checks

Schema changes are additive local SQLite changes. Back up the local campaign before first use. Existing channels, cursors, evidence, snapshots and moderation decisions are preserved. The release includes migration-preservation, retry, interrupted-request, deduplication, sampling, review-correction and period-boundary tests. All tests use controlled responses, never production YouTube calls.

The text export includes the report plus request/batch/encounter/review/sample/monitor audit tables. The PDF button prints the current report and all video result rows; the raw audit tables are in text. Treat exported evidence and review notes as private local files.

## Broker accounting

The attempt count includes local broker transport attempts. A server denial with zero provider units is `blocked`, not a failed YouTube call. Confirmed provider units, ambiguous units and an upper bound are reported separately. Successful calls store the server receipt (request ID, quota day, protocol and units). A lost response may have consumed quota and stays ambiguous. Local attempt limits remain conservative even when server denials consume no provider units. The Worker ledger enforces the shared project allocation across all broker clients. Every batch freezes the last public broker policy snapshot alongside its other configuration.
