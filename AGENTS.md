# Production deployment

- Use `npm run deploy` from this checkout. Never publish by downloading and patching a Worker through the legacy script API, or by deploying a file from `tmp/`.
- A previously uploaded Worker is not proof of the active production version. Check `/deployments`; preserve its active version IDs as the rollback reference.
- Review the exact source changes being published. Dirty workspaces require explicit user authorization for that scope before `npm run deploy -- --allow-dirty`.
- The guarded deployment must rebuild, run release checks, verify the source fingerprint, detect production changes during preparation, and verify the live `/release.json` identity afterward.
- Direct Wrangler deployment rebuilds and runs release gates through `wrangler.jsonc`'s build command. Do not bypass it with `--no-build` or a temporary config.
- After publishing, verify the signed-in live My Feed displays video cards and the requested interface. HTTP 200, a countdown screenshot, or a static preview is insufficient. Report incomplete functional verification explicitly.
- Apply database migrations separately when required; a presentation-only deployment must not automatically run unrelated migrations.
