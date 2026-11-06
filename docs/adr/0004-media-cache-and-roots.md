# ADR 0004: Media cache and map index roots

## Status

Accepted

## Context

Entity fluff, tokens, and adventure maps are hosted remotely (`settings.imageBaseUrl`, default `https://5e.tools`). Reference maps are indexed locally in `gendata-maps.json` but images are still remote until cached.

## Decision

- Cache downloads under the plugin install dir: `cache/img/…` for URLs on the image host whose path contains `/img/`.
- `cachedMediaFile` checks disk without download; `cachedMediaPath` downloads if missing.
- Reference catalog loads from `getConfiguredRoot()/data/generated/gendata-maps.json` (installed plugin).
- Adventure menu click loads maps with cache-first fetch and limited concurrency; abandon stale UI updates with a generation token.

## Consequences

- Cache bytes are read and written through the vault adapter ([ADR 0006](0006-vault-adapter-data.md)). `cachedMediaPath` still returns an absolute path on desktop for map code.
- Clearing or relocating the plugin folder drops the media cache.
- Image host / base URL changes affect cache keys and fetch URLs.
- Catalog bugs are often install/allowlist issues, not missing git files.
