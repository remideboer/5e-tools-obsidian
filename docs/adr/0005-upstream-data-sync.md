# ADR 0005: Upstream → Obsidian sync (content + site sources)

## Status

Accepted

## Context

This repo is a fork of [5etools-mirror-3/5etools-src](https://github.com/5etools-mirror-3/5etools-src.git) with an Obsidian plugin layer. Upstream often adds JSON content and new source abbreviations. Merging the whole upstream tree would fight Obsidian commits. The vault plugin still receives data only through the allowlisted Obsidian build (ADR 0001).

`SourceUtil.isSiteSource` is `!!Parser.SOURCE_JSON_TO_FULL[source]`. If search/data reference a source that is missing from those maps, the DataLoader treats it as missing homebrew and entity opens return null (“No JSON found”).

## Decision

- Keep a git remote `upstream` pointing at the mirror.
- Sync with `node/sync-upstream-obsidian.js` (`npm run sync:upstream-obsidian`):
  1. `git checkout <upstream-ref> --` for **`data/`** and **`search/index.json`** only (no full merge/rebase of JS).
  2. Merge **missing** `Parser.SRC_*` / `SOURCE_JSON_TO_FULL` / `_ABV` / `_DATE` entries and selected source-set membership from upstream `js/parser.js` into local `js/parser.js` (idempotent).
  3. Warn when top-level `data/` names are outside `copyBundledData`, and when search sources are still unknown to Parser.
- Refuse to run if those sync paths have local uncommitted changes.
- Do not auto-commit; the developer reviews and commits.
- Refresh the Obsidian install with `build-obsidian.js` when `FIVEETOOLS_DEV_VAULTS` is set or `--install` is passed (`npm run sync:upstream-obsidian:install`).
- `npm run sync:upstream-data` remains an alias of the same script.

## Consequences

- Upstream JS/CSS/site behavior is not pulled wholesale; only Parser site-source registrations needed for new content to load.
- Content appears in git immediately after sync; Obsidian sees allowlisted paths only after build/install and plugin reload.
- Local edits under `data/`, `search/index.json`, or `js/parser.js` must be committed or stashed before sync.
