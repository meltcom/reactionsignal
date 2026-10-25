# Backend configuration and import safeguards

This review starts from main at 8cb09d7f42c74cc6461c12a5caf6b9b5e0a17881.

## Public authentication configuration

`authConfig` accepts publishable keys and legacy JWT keys whose role is `anon`.
It rejects secret/service-role keys, unsupported roles, malformed values and
whitespace. An invalid configuration is returned publicly as `{configured:false}`;
protected identity lookup fails with 503 before sending any key upstream.
Parsing a legacy key's role is only a public-configuration guard. It does not
authenticate a user or replace Supabase's identity lookup, current identity-cache
bounds, the member allowlist, or moderator checks.

Reference: https://supabase.com/docs/guides/getting-started/api-keys

## Additive seed and discovery-run imports

Initial seeds and discovery-run imports share an insert-only match write. Existing
CONFIRMED, PROBABLE, PENDING and REJECTED matches retain their status and source,
regardless of whether they came from moderation, discovery or a previous import.
Existing exclusions also prevent creation of a new match when its match row is
absent. Both guards execute in the insertion SQL, rather than through a separate
check followed by an unconditional write.

New non-excluded matches are still imported. Existing channel/video metadata and
format-lock handling, run audit records and run-ID replay prevention are retained.
Explicit moderator correction routes remain the way to revise a prior decision;
an automatic seed/import cannot override it. This does not change member YouTube
subscription imports or apply any database migration. It does not reconstruct
historical decisions that might previously have been overwritten.

## Format-recheck diagnostic

The `updated` field counts a result only when its format resolves to SHORT or
FULL_LENGTH and the guarded update succeeds. An unresolved UNKNOWN, wrong channel,
private/missing video, or a row locked/unavailable before the write does not count.
Metadata batching, lease handling and classification rules remain intact.

## Regression review

`tests/backend-safeguards.test.mjs` reproduced all five failures on unmodified main
before the fixes. It now passes using fake credentials, mocked YouTube responses
and in-memory SQLite:

- Publishable and legacy anon configuration is accepted; privileged/malformed
  configuration is suppressed through the actual packaged public endpoint and
  cannot trigger an upstream identity lookup.
- A new import preserves all four existing match statuses and their source,
  retains exclusions and locked formats, adds new confirmed/probable matches, records its audit and
  ledger, and cannot overwrite decisions through a later run or replay.
- Initial seeding preserves rejection/exclusion decisions while adding new data.
- A mixed format batch counts only resolved successful updates, including
  concurrent lock and availability changes; stored match decisions remain intact.

Older regression fixtures now use publishable-shaped fake keys so their original
membership and release assertions exercise a valid configuration.
The historical discovery-import fixture verifies retained decision provenance
and duplicate holds rather than expecting existing records to be retagged.

Validation commands: `npm test`, `npm run deploy:check`, and `git diff --check`.
These tests do not establish real OAuth, provider callback or cron functionality.

## Separate follow-ups

- Verify live scheduler runs, job progress, push subscriptions and operational
  errors without confusing source presence with successful provider execution.
- Verify live YouTube OAuth import, group isolation and disconnect/revocation.
- Decide whether any legacy Shorts/excerpt policy should be adopted; do not run
  the old automatic Shorts data rewrite as part of this change.
- Review the data-specific song-title fallback separately if still needed.

This change prepares source for review. Publishing requires the guarded release
process and an approved release scope; no deployment or remote data change is
performed by these fixes or their tests.
