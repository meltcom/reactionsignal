MS Journey is part of Reaction Journey at https://reactionjourney.com/#missioned-souls. The verified source is https://github.com/meltcom/reactionsignal; wrangler.jsonc names the Worker reactionjourney and its callback uses reactionjourney.com.

Private testing: only authenticated moderators can open the MS Journey navigation item or read/write /api/missioned-souls. Ordinary members receive HTTP 403 even when requesting the endpoint directly. The rest of Reaction Journey retains its existing membership settings. Public release requires a separate access change.

The starter has three verified official video links, not a complete catalog. Open Catalog updates and category review, then Refresh official YouTube catalog to start collection. Each invocation scans up to 200 uploads and persists its continuation cursor. The existing 15-minute scheduler resumes initiated scans AFTER reaction discovery and rechecks. After completing a pass, it waits 24 hours before the next daily pass. It does not spend YouTube quota until a moderator starts collection. Configure the existing YOUTUBE_API_KEY server secret; no key is exposed to the browser. No new D1 migrations are required.

Official uploads use channels.list, playlistItems.list and videos.list, keeping the reaction search query unchanged. Refreshes preserve reviewed categories and daily view history. Suggested categories require human review. Facebook-only and other videos need manual links or an import; YouTube cannot collect those sources.

The optional standard-library script processes saved metadata offline:
    python scripts/seed_missioned_souls.py --input saved-videos.json --output catalog.json
For an online complete uploads import, set YOUTUBE_API_KEY in your environment and run:
    python scripts/seed_missioned_souls.py --youtube --output catalog.json
Import the JSON through the MS Journey maintenance controls. Large catalogs are split into 1000-record files. The hosted collector can populate the official uploads without the seed script.

Period rankings show observed views gained in the latest 24 hours, 7 days, or 30 days. They require a statistic no older than 48 hours and a baseline within six hours of the boundary. These are not historical first-day performance rankings. Missing history leaves a ranking empty until enough snapshots accumulate. Category assignments overlap; OPM includes Shorts when the checkbox is selected.

The latest transparent MS JOURNEY logo includes a small, faint cross on the highest peak. Keep the established compact banner and enlarged logo.
