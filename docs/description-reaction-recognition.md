# Explicit description-only reaction evidence

VI3ION's public videos `itA_AfI5q5s` and `Nj7MlcL6b6Q` have generic titles but explicitly say `REACTING TO ... Missioned Souls` in their descriptions. The former rule required reaction wording in the title for description-only identity. Both examples therefore failed automatic matching despite the explicit narrative. They have already been added through a separately audited evidence review; this change must not republish or overwrite those decisions.

## Scope

The shared approval helper now accepts a narrowly phrased statement about the current reaction: `REACTING TO ...`, or first-person `I/we ... react/reacting to ...`, optionally prefixed by `Today` or `In this video`. The complete performer alias must appear in the same plain-text sentence, at most 240 characters. Unicode line separators are respected. A bare imperative `React to ...` is not a statement about the current video.

The new path excludes tags, URLs and credits, generic copyright boilerplate, third-party or quoted statements, future plans, negation and incidental comparisons. Interview, profile, tribute and promotional title framing cannot gain approval through this new path. These are conservative metadata rules, not proof that the entire video was watched or that descriptions are truthful.

The existing exact-title and title-plus-description paths retain their behavior. The broker's existing description prefilter is extracted into the shared helper without changing that prefilter's matching expression. Fresh discovery, automatic matching, classification review and historical publication use the shared approval helper. Existing public-metadata, channel-identity, performer-review policy, exclusions, moderator/manual decisions, historical cutoff and publication audit guards remain in place.

No migration, quota change, scanner activation, campaign reset or Python client update is required. An offline replay of the archived installed Python recognizer already identifies both examples as strong description-based candidates. This server fix allows matching to agree with that retained evidence. It does not recover videos that search never returned or automatically revisit all previously rejected records.

## Validation

- Two captured positive fixtures preserve the exact titles, relevant narrative excerpts, channel identity and watch-page hashes; no contact, donation or account data is needed in the repository fixtures.
- Negative cases cover tag/link-only identity, split sentences and lines, boilerplate, requests, future intent, other-artist context, quotes, substring identity and nonreaction framing.
- Integration checks cover fresh discovery, historical classification, review recommendations, public/channel/manual-policy protections, cutoff handling and preservation of an excluded counterpart.
- An exploratory replay of 848 retained advisory proposals found no changed evidence decisions. Those records contain description excerpts and are not a labeled precision/recall benchmark.

Full build/regression results and source identity are recorded separately in the review output. This preparation does not stage or deploy the application, call YouTube, or alter catalog data. Before any later release, follow AGENTS.md and docs/deployment-safety.md, recheck current source/deployment identities and complete the required signed-in staging/production checks. Do not repeat earlier browser checks as proof of a new build.
