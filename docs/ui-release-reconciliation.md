# UI release reconciliation

This branch is based on merged PR #44 (0f59b9794254f3c9f9da64e0aca0f2595c467ef9). Its weighted discovery search, bounded official RSS hint refresh, daily limits and pagination are retained.

The source now contains the approved compact sign-in and responsive logo, feed filters/Shorts and official uploads, corrected reactor sorting, Following groups, MS Journey playlists/year browsing, Help/About, YouTube import controls and authenticated PDF guides. Supporting server code and assets are tracked with their UI.

Run npm test before release. npm run build includes tests/release-ui.test.mjs, which checks the packaged UI features, asset inclusion, guide-route authorization and PR #44 query weighting. A full build should never be deployed from a stale source snapshot merely to update one feature. Commit and review all intended changes first.

Reconciliation itself does not deploy, run remote migrations, refresh catalogs, or alter member data.

## October 20 restoration

PR #45 did not include the later direct production UI releases. Rebuilding its tracked source during PR #15 therefore replaced compact cards, app/web navigation, Following behavior, and feed performance fixes with older assets.

Recovered presentation assets from the verified October 20 `performance-release-assets.json` snapshot in the Reaction Journey working checkout. The snapshot incorporates the approved compact cards and watch-status release (local commit e746fc1), later filter/Following improvements, and the performance release verified in the "Fix YouTube import error message" chat. The readable YouTube import source retains catalog-ready and cached-return handling. Optimized WebP assets are now packaged by the normal build.

Preserve PR #15's visibility controls, member filtering, recovery fixes, and moderator help on top of this snapshot. Backend source, migrations, discovery rules, and production configuration are unchanged by this restoration.

Release verification now checks compact playback cards, watch labels, app navigation, optimized image sizes, and MS Journey controls. Behavioral regressions cover deferred community loading, indexed lookups, selected-sort work, unchanged-card refreshes, Following scope and empty groups. Keep future presentation releases in tracked source; never treat a merged PR as proof that later direct releases have been reconciled.
