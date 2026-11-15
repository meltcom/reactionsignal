# Seven-day RJ discovery trial

Scope authorized November 14: RSS recovery/backoff, faster checks for active
reactors with failed feeds, 60 RJ search attempts/day with aligned pacing,
dedicated new-reactor queries, retained catch-up, and cohort measurements.
Python backfill, member contribution handling, identity/classification policy,
and existing quota reserves are unchanged. No database migration is required.

The first production discovery run with DISCOVERY_SEARCH_TRIAL=20261114 and
search enabled atomically creates discovery-trial:20261114 in state. Its start
is immutable, its expiry is exactly seven 24-hour periods later, and after
expiry the effective cap returns to 40, the original lane mix/pacing returns,
and the recent-check batch returns to seven. A redeploy never restarts it.
Staging keeps search at zero and cannot initialize the trial.

During the trial one shared atomic attempt counter (including retries and manual
searches) allows at most 60 per Pacific day. Twenty-four-minute slots on the
existing 15-minute cron permit approximately 60 daily opportunities, without
duplicate slots or resetting previous daily use. Failures and runtime budgets
may reduce achieved volume. The lane cycle allocates seven fresh first pages,
one new-reactor first page, and two catch-up pages. Separate cursors preserve
fixed catch-up windows/tokens and rotations; new-reactor queries include first
time, reacts, reagindo, and the Missioned Soul singular variant.

Recent-upload batches grow to ten. At least five slots are available to the
oldest overdue eligible channels; up to five serve active reactors (confirmed
publication in 14 days), with failed RSS feeds due at 30 minutes versus the
usual hour. All eligible channels retain their daily coverage path, API retry
accounting, and exclusions. Shared run deadlines/call limits still apply.

RSS failures retain last success, last attempt, HTTP status, duration, error and
consecutive failures under rss-health:CHANNEL. Retries start at 15 minutes,
double with jitter, and cap at six hours. Retry-After on 429/503 is honored up to
that cap. Success resets the streak. The existing 30-minute poll interval and
40-channel/20-second bounded batch remain; early 404s no longer prevent later
healthy channels being probed. Redirect, body-size, feed and channel checks
remain enforced. RSS errors never retire a channel or disable upload coverage.

The moderator daily/weekly report adds the fixed trial versus preceding-seven-
day comparison, matched channel/source/format strata, discovery median/p90,
first catalog-publication median/p90 and processing delay, frozen qualifying
search yield/attempt, new qualifying reactors by day, measured discovery API
calls and minimum full-channel upload coverage. These are observed different
uploads, not a randomized experiment. Report partial periods and sample sizes.

First catalog visibility is stored once for new v5 observations under
discovery-publication:VIDEO, after direct ingestion or automatic resolution;
upstream publish time and discovery time remain separate. Older records are
never given invented publication timestamps. Baseline format is current catalog
format when frozen channel/format identity is unavailable. Legacy publication
delay cannot be compared; it is explicitly missing. Reporting excludes Python
backfill and member submissions. Recorded API calls are not provider-wide quota.

Evaluate after seven days using the report and matched sample sizes. Keep
existing daily coverage, inspect any degradation, distinguish rejected/pending
candidates from qualifying reactions, and verify project-wide search quota in
Google Cloud separately from RJ's local cap. RSS failures may depend on network
location; backoff reduces wasted retries rather than guaranteeing endpoint repair.

Validation: regression tests cover trial expiry, staging isolation, 60 pacing
slots/day, lane/cursor preservation, active failed-feed priority with daily
coverage, bounded Retry-After/backoff and first-publication/matched reporting.
Use the guarded staging and production release commands and signed-in browser
checks described in deployment-safety.md. No unrelated migrations or settings.
