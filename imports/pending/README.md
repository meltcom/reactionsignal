# Pending October 5 master import

Source: Missioned_Souls_Master_410_Reconciled_2026-10-05.xlsx, Updated Master and Video Import 2026-10-05 sheets.

Scope: 410 unique channel IDs; 34 unique full-length videos (29 CONFIRMED, 5 PROBABLE). Tax07ARtEUQ is omitted as a possible duplicate. Evidence is search-results-only; incomplete channel scans remain incomplete.

Target: Cloudflare D1 reaction-signal-catalog, binding DB. Supabase supplies authentication.

This SQL is outside drizzle, so normal deployment migrations do not apply it. No production import has been applied by this change.

INSERT OR IGNORE preserves every existing channel, video and match row, including moderator decisions, format locks, unavailable flags, scan cursors and timestamps. Existing exclusions block new videos and matches. Existing metadata is retained. Live channel totals may exceed 410 due to later discoveries. Existing pending/probable statuses are not promoted by this import. This conservative payload adds missing records; it does not refresh existing metadata or channel snapshot statistics.

Validation: payload IDs/counts checked against workbook; SQLite simulation inserts 410 channels and 34 videos; repeat application preserves moderator rejection/source, locked Short format, unavailable flag, channel name/check timestamp and an excluded video. No live database verification performed.

Before explicit application: inspect live schema and migration history; export a D1 backup; compare new/existing/excluded IDs against live rows. Apply through authorized Cloudflare D1 access, then verify counts and preservation of decisions/exclusions. Keep SQL staged until live preflight is complete.
