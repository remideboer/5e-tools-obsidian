# ADR 0004: Media cache and map index roots

## Status

Accepted

## Context

Entity fluff, tokens, and adventure maps are hosted remotely (`settings.imageBaseUrl`, default `https://5e.tools`). Reference maps are indexed locally in `gendata-maps.json` but images are still remote until cached.

## Decision

- Cache downloads under the plugin install dir: `cache/img/…` for URLs on the image host whose path contains `/img/`.
- ToV creature art is vault-local (`5etools/_homebrew/img/tov-*.png`), not bundled in the plugin or git repo.
- `cachedMediaFile` checks disk without download on desktop; `cachedMediaExists` checks the vault cache on desktop and iPad. `cachedMediaPath` downloads if missing and still returns an absolute path for map scenes.
- Reference catalog loads from `{plugin}/data/generated/gendata-maps.json` through the vault adapter. Images are cached the same way on desktop and iPad. "Use as map" still creates a desktop scene.
- Adventure menu click loads maps with cache-first fetch and limited concurrency; abandon stale UI updates with a generation token.

## Consequences

- Cache bytes are read and written through the vault adapter ([ADR 0006](0006-vault-adapter-data.md)). `cachedMediaPath` still returns an absolute path on desktop for map code.
- Clearing or relocating the plugin folder drops the media cache.
- Image host / base URL changes affect cache keys and fetch URLs.
- Catalog bugs are often install/allowlist issues, not missing git files.
