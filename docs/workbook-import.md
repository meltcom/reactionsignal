# Moderator workbook imports

After installation, sign in as a configured moderator and open **Import Workbook** in the moderator navigation.

1. Choose the reconciled Missioned Souls `.xlsx` master (up to 10 MB).
2. Select **Preview import**. The workbook is read in your browser; only selected public channel/video metadata is sent to the application. `Updated Master` supplies channels; the newest `Video Import YYYY-MM-DD` sheet supplies videos. Other tabs are not imported. The preview lists new, existing, excluded/rejected, and protected videos. New channels are listed separately.
3. Select **Import new records**. The server compares with live rows again and atomically applies missing records with a receipt. Probable reactions and uncertain formats receive `PENDING` status and appear in the existing discovery review workflow. Existing matches retain their status and source.
4. Read or download the receipt. Recent imports and receipts remain available to the moderator who uploaded them. Repeating an application returns its original receipt. Uploading the same workbook again safely skips existing IDs.

Previews expire after 24 hours. Re-upload to create a fresh preview. Maximum normalized payload: 1,000 channels and 1,000 videos. Channel/video IDs must be valid and each video channel must exist in Updated Master. Identical duplicate IDs are collapsed; conflicting rows reject the upload. Rejected, duplicate, and non-countable workbook rows are omitted. Unsupported workbook layouts fail with a visible error.

Existing exclusions and rejected matches block new reactions. Unavailable videos, channel-ID conflicts, and channels in explicitly protected discovery scopes are held. Existing titles, channel names, formats/format locks, availability, timestamps, scan cursors, ratings, comments, accounts, and exclusions are not overwritten. A new confirmed match can make an ordinary `other` or `review` channel eligible through the existing discovery trigger; paused, retired, official, and other protected scopes are preserved.

## Installation

This feature is separate from the older draft master-data import. It does **not** apply that SQL or import any workbook during deployment.

Merge this feature PR into the production source branch, then let the existing Cloudflare build run `npm run deploy`. If builds are not connected, run `npm ci` followed by `npm run deploy` from the repository once, authenticated to the correct Cloudflare account. The deploy command applies `0028_workbook_import_20261006.sql` to create the import audit/staging tables before deploying the Worker. Existing migrations must already match the current production schema.

After deployment, sign in as a moderator, navigate to Import Workbook, upload the October 5 master, and verify its preview before importing. A member account must not see the moderator navigation or access the import API.

## Validation

Nine targeted tests pass: moderator/anonymous/member authorization, same-origin/content-type checks, preview without catalog writes, probable-to-review handling, exclusions/discovery changes after preview, preservation of unavailable/locked/retired records, owner/expiry enforcement, input validation and newest-sheet parsing, 1,000-row bounded query batches, and rollback/retry. The real October 5 workbook parses as 410 channels and 34 videos.

A local simulation using the uploaded pre-import production backup previews 0 new channels, 2 new matches, 29 existing matches, 2 excluded matches, and 1 protected existing match. The two additions are `lurboAHW7nA` (CONFIRMED) and `ZzrTBxg3AZs` (PENDING for review). Applying the same preview twice adds nothing further.

The complete repository test suite has 22 existing failures on both the unchanged baseline and this feature branch, with no new failing test names. These include outdated Worker-name, seeded-catalog, and expanded-schema expectations. Build and feature checks pass. Browser interaction and production deployment have not been verified from this workspace.
