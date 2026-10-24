# ADR 0005: Upstream data sync (content only)

## Status

Accepted

## Context

This repo is a fork of [5etools-mirror-3/5etools-src](https://github.com/5etools-mirror-3/5etools-src.git) with an Obsidian plugin layer. Upstream often adds JSON content. Merging the whole upstream tree would fight Obsidian commits; only the content trees need regular updates. The vault plugin still receives data only through the allowlisted Obsidian build (ADR 0001).

## Decision

- Keep a git remote `upstream` pointing at the mirror.
- Sync **only** `data/` and `search/index.json` via `node/sync-upstream-data.js` (`npm run sync:upstream-data`), using `git checkout <upstream-ref> --` (no full merge/rebase).
- Refuse to run if those paths have local uncommitted changes.
- Do not auto-commit; the developer reviews and commits.
- Refresh the Obsidian install with `build-obsidian.js` when `FIVEETOOLS_DEV_VAULTS` is set or `--install` is passed (`npm run sync:upstream-data:install`).
- Warn when new top-level `data/` names are outside `copyBundledData` so the allowlist can be extended.

## Consequences

- Upstream JS/CSS/site changes are not pulled by this path.
- Content appears in git immediately after sync; Obsidian sees allowlisted paths only after build/install and plugin reload.
- Local edits under `data/` or `search/index.json` must be committed or stashed before sync.
