# Bounded UNKNOWN-format recovery preview

This standalone CLI prepares proposals for 1–12 explicitly selected Missioned
Souls records. It has no database connection, database writes, deployed endpoint
or apply mode. It does not change match decisions, exclusions, locks, unavailable
flags or performer status. PR #55 remains a separate safeguard change.

## Local credential

Use an existing YouTube Data API key in the YOUTUBE_API_KEY environment variable
or a project-root .dev.vars file containing:

```text
YOUTUBE_API_KEY="YOUR_EXISTING_KEY"
```

.dev.vars and its variants are ignored by Git. Do not paste keys in chat, put them
in command arguments, commit them, or loosen existing key restrictions. If a key
is restricted to Cloudflare's environment, use a separately reviewed local key
configuration rather than weakening the production key. Cloudflare's stored
secret is not readable by this CLI. The key is sent only to Google's API in a
request header and is omitted from reports and errors.

## Input and execution

Input is a JSON array exported through a read-only catalog query, containing
id, title, channel_id, performer_id, performer_status, match_status, match_source,
format, available, format_locked and excluded. The CLI rejects rows outside the
active, approved, available, unlocked, non-excluded Missioned Souls UNKNOWN scope.
Use the explicitly reviewed pilot IDs; do not silently expand to the inactive
Nene Royal catalog or other new records.

```powershell
node scripts/preview-format-recovery.mjs --input output/format-recovery-pilot.json
```

One videos.list request fetches snippet, contentDetails, status and real player
dimensions for the selected IDs. Public status and expected channel must match.
The existing videoFormat classifier then produces SHORT, FULL_LENGTH or an
unresolved outcome using fresh evidence only. Cached duration is not substituted.
Missing/private videos, channel conflicts, malformed responses, network errors
and quota failures do not produce unsafe or partial proposals. Missing duration
or format evidence remains unresolved for review.

Output defaults to output/format-recovery-fresh-preview.json. A different output
must remain a separate JSON file under output/. The report preserves the input
snapshot guards for review, but the database must be re-read before any future
apply implementation because moderation may have changed since export.

Regression tests cover scope bounds, single-call batching, credential handling,
identity/privacy checks, missing evidence, response errors, immutable input and
the absence of an apply mode. No live credentials are required for tests.

References:
- https://developers.google.com/youtube/data/reference/rest/v3/videos/list
- https://developers.google.com/youtube/data/reference/rest/v3/videos

Later classification writes require a separately reviewed guarded recovery step
with current database checks, audit history and explicit approval. Scheduler/OAuth
verification, inactive-catalog cleanup and legacy Shorts policy remain separate.
