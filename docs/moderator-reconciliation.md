# Moderator reconciliation

After deployment, sign in as a moderator and open **Import Workbook**. The new **Reconcile missing reaction videos** section accepts up to 100 `video ID,channel ID` pairs. **Load 74 audited missing IDs** loads the missing records from the October 5 master versus the user-supplied production export.

Select **Check and reconcile** to fetch current public metadata in groups of 50. Existing performer decisions, exclusions, channel holds, video availability and metadata are preserved. Clear matches use the existing metadata recheck recommendation and become CONFIRMED. Known performer matches without strong reaction evidence and possible Shorts become PENDING. Unrelated, nonpublic and conflicting entries are recorded without publication. Description-only uncertain performer matches remain in the receipt for investigation. Metadata does not establish the contents of a video.

Each completed batch stores a receipt for every supplied unique ID. Recent receipts can be viewed and downloaded. Repeating a batch skips existing decisions by exact video ID. If a request fails, retry safely; a completed receipt is not guaranteed for an interrupted request. Concurrent exclusions and performer/channel holds are rechecked inside guarded writes. This feature does not reset historical scan cursors or change existing formats, moderator approvals, account data or comments.

The 74 IDs are candidates, not 74 verified missing reactions. All known IDs remain case-sensitive. Future audit results can be pasted into the same form. This action checks explicit IDs; it does not reconstruct the historical reaction totals of 337 channels with incomplete workbook ID lists.

No new database migration is required: receipts use the existing state table. The server module is copied into the Worker build; the browser action is included in the existing workbook-import bundle. No batch runs at deployment; a moderator must initiate it.

Validation: seven reconciliation tests and nine existing workbook-import tests pass, covering authorization, origin, malformed input, idempotency, receipts, Shorts, unavailable/unrelated videos, unknown reactors, protected formats and exclusions introduced during checking. `npm run build` succeeds. Production execution and browser interaction are not verified from the development workspace.
