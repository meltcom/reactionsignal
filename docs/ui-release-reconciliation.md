# UI release reconciliation

This branch is based on merged PR #44 (0f59b9794254f3c9f9da64e0aca0f2595c467ef9). Its weighted discovery search, bounded official RSS hint refresh, daily limits and pagination are retained.

The source now contains the approved compact sign-in and responsive logo, feed filters/Shorts and official uploads, corrected reactor sorting, Following groups, MS Journey playlists/year browsing, Help/About, YouTube import controls and authenticated PDF guides. Supporting server code and assets are tracked with their UI.

Run npm test before release. npm run build includes tests/release-ui.test.mjs, which checks the packaged UI features, asset inclusion, guide-route authorization and PR #44 query weighting. A full build should never be deployed from a stale source snapshot merely to update one feature. Commit and review all intended changes first.

Reconciliation itself does not deploy, run remote migrations, refresh catalogs, or alter member data.
