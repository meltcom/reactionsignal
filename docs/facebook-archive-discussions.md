# Facebook archive discussions

Facebook-only MS Journey cards offer Rate & discuss, app rating summaries, and approved app comment counts. Facebook reactions/comments remain source statistics, separate from in-app discussion activity.

The shared community services enforce the existing point rules: +1 for a first rating, shared with video/reactor rating limits; +3 for useful approved comments/replies; existing Trusted Member daily maximum, moderation, blocking, ownership, duplicate protection and point reversals. Facebook archive IDs remain separate from YouTube reaction-feed IDs. Hidden, removed, unavailable and YouTube-equivalent archive entries cannot receive new ratings or comments. Moderator and personal contribution links open Facebook.

## Release

Apply only `drizzle/0043_ms_archive_ratings.sql` before releasing this change. It adds the archive ratings table and index without modifying existing ratings or catalog records. Inspect production migration history first; do not automatically apply unrelated pending migrations. Then follow AGENTS.md and docs/deployment-safety.md, publish reviewed main with npm run deploy, verify release identity, and check signed-in My Feed plus a Facebook-only Rate & discuss dialog. Test writes belong in an isolated fixture rather than real member accounts.

## Facebook metadata collection

Collection uses the authorized logged-in Chrome session. Save the observed date and source, mark displayed K/M counts as rounded, and leave unavailable values unknown. A reel's Like button displays total reactions; preserve that distinction in source text. Store thumbnail bytes permanently rather than relying on expiring Facebook CDN URLs. Metadata imports must preserve titles, classifications, visibility, YouTube-equivalent decisions, catalog membership and prior metric history. Catalog and observed-data backups stay in ignored output/.

Validation: full build and 260 tests passed, including archive rating isolation/shared caps, private pending comments, approval and reversal points, trusted replies/edits, cross-discussion reply rejection and hidden/removed target checks. Browser collection and production verification are reported separately; passing tests do not establish that all Facebook metadata has been populated.
