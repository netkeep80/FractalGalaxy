# Project versioning

FractalGalaxy has two deliberately separate version concepts.

- **Project version** — the user-visible repository/web version in `version.json`.
- **E0_VERSION** — the compatibility identifier of the current E0 procedural experiment/protocol.

They must not be conflated.

## Canonical project version

`version.json` is the canonical project version record:

```json
{
  "version": "0.0.2"
}
```

`package.json.version` must always contain the same value. The normal suite rejects disagreement.

The project version is plain SemVer `MAJOR.MINOR.PATCH`. The current automatic policy increments only PATCH. MAJOR/MINOR changes require a separate Author decision and corresponding policy change.

## Merge rule

Every merged pull request into `main` increments PATCH exactly once.

The merge workflow is serialized with the `project-version-main` concurrency group. It refreshes `origin/main` immediately before each attempt, runs `scripts/bump-version.mjs`, verifies the version tests and pushes only `version.json` and `package.json`.

If another merge changes `main` before the bot can push, it retries from the new `origin/main`; therefore two queued merges produce two increments rather than losing one.

The generated version commit is a direct metadata commit, not another pull request, and does not recursively trigger the merge workflow.

## Bootstrap

Before this policy, `package.json` contained `0.0.1` and no canonical `version.json` existed.

The installation PR carries `0.0.2`, so its own merge counts as the first increment. The workflow checks the PR's pre-merge base SHA: if `version.json` did not exist there, it recognizes the bootstrap and does not apply a second increment.

## GitHub Pages

Pages publishes `version.json` at the site root. The Studio loads it with `cache: no-store` and displays:

```text
v0.0.2 · e0-prototype-1
```

The exact project version changes over time; the protocol identifier changes only when its own compatibility contract changes.

Because pushes made by the standard Actions token do not normally cascade into ordinary push-triggered workflows, the version-bump workflow explicitly dispatches `pages.yml` after a successful metadata push. Pages itself also watches `version.json`, which covers ordinary human/main changes and makes the dependency explicit.
