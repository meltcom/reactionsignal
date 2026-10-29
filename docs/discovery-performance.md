# Fresh discovery measurement release

This release keeps the 15-minute scheduler, daily channel coverage, active-channel allocation, existing moderation decisions, seven-day overlapping query windows and 12/6/2 query-window rotation. It does not introduce a historical backfill campaign.

## Search changes

- Search spacing is `max(15, 1440/dailyLimit)` minutes; the next scheduled run picks up due work. At 20/day the interval is 72 minutes (normally 75 minutes on the existing cron); at 40 it is 36 minutes (normally 45). This is budget-aware pacing, not a guarantee that every quota slot is used.
- The authorized production cap is 40 attempts/day. The Missioned Souls Tracker console showed 100 search calls/day and 10,000 general queries/day. The deployed key's project association and external consumers have not been independently verified; monitor project-wide usage and quota errors during the rollout.
- Every outgoing search attempt, including retries and network failures, reserves a slot before requesting YouTube. Caps reset on Pacific calendar days, including DST. The first measured day conservatively carries recorded searches from both overlapping legacy UTC days; carryover is a reservation, not an observed measurement attempt. Other processes using the same Google project are not included in RJ's counters.
- Promotional announcements, sneak peeks, vlogs and livestream labels are excluded from new song hints. Hashtags are stripped; by-artist and dash-artist titles are parsed. Existing saved cursors retain their query/window until finished, so an old malformed term may finish before clean hints take effect.

## Stored evidence (migration 0044)

- `discovery_search_pages`: immutable identity, run, performer, strategy, effective settings, query, publication bounds, page depth, start/end, result counts, outcomes and errors. Page depth 0 explicitly means unknown for a pre-release continuation. A started page without an end record indicates interruption; it is not a completed zero-yield page.
- `discovery_search_attempts`: one reservation per attempted API request, Pacific quota date, HTTP/network outcome and duration. The attempt row is created before network I/O; a process terminated between those steps remains conservatively counted with status started.
- `discovery_search_results`: returned video IDs, channel, decision snapshot, new-to-performer flag, first newly eligible reactor attribution and delay. Existing, excluded, rejected and not-cataloged results are distinguishable. A not-cataloged result is not automatically a rejection: missing/private/unrelated metadata can produce it. An exclusion remains excluded even if no video row exists.
- `discovery_observations`: retains existing first-insert/source data and gains strategy/page attribution. Legacy records are labeled legacy; no historical query history is invented.
- `discovery_health_samples`: per-discovery-run eligible/successful-24h coverage, latest RSS health, run status/time, API calls and measured D1 rows. RSS is sampled before this cycle's optional polling, so it reflects the latest persisted feed checks, not a synchronized end-to-end health transaction.

Records are retained; this release adds no automatic deletion. Raw settings and outcomes are historical snapshots and are not rewritten when a moderator later changes a decision. Missing page-result records after an interrupted run remain a measurement limitation; first-insert observations still retain the page ID. These logs measure observed first discoveries, not recall across every YouTube video or causal improvement.

## Moderator report

Open My Feed → Discovery status & catalog coverage → Load daily & weekly discovery report. It uses the moderator-only, authenticated GET `/api/discovery/performance` endpoint, fetched on demand rather than every status poll. Responses are private/no-store.

The report shows 15 Pacific calendar dates including partial today. Weekly summaries compare the last seven completed Pacific dates with the preceding seven. Displayed measured-day and sample counts make incomplete periods visible. Initial weeks cannot be treated as full before/after comparisons. Fresh delay means 0–24 hours from publication to first discovery; older finds and unknown/premiere timings are separate. Median uses the middle pair for even samples, and p90 uses nearest rank.

Per-query results group by strategy **and settings** so cap changes are not silently pooled. Qualifying discoveries are new CONFIRMED/PROBABLE performer matches at discovery time; pending matches are recorded separately in raw results. Source discovery counts can include pending first-insert catalog videos, so they are not interchangeable with qualifying-query counts. Weekly medians are calculated from raw observations, never averaged from daily medians.

## Release and rollback

Apply only additive migration `0044_discovery_measurement.sql` separately after verifying each target's ledger. Do not run unrelated migrations. The preceding application remains compatible with the added nullable/default columns and tables; rolling back the Worker does not require deleting measurement data. Do not reverse the migration by dropping tables during an incident.

Run the full suite, artifact checks and isolated release checks; stage the committed branch with `npm run deploy -- --staging`, inspect staging and relevant regression results, then merge the reviewed change. Production deploys only current clean main with `npm run deploy`. Record active versions before release and verify live build identity and signed-in feed afterward. Verify the moderator report using a real authorized moderator session; never expand moderator access or extract browser tokens to make verification pass.
