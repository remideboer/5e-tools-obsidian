# ADR 0006: Vault adapter for bundled data

## Status

Accepted

## Context

The plugin was desktop-only: `FileSystemAdapter.getBasePath()` plus Node `fs` read bundled JSON and the media cache. Obsidian on iPad has no Node `fs`. A static `import fs` in the bundle stops the plugin from loading. Library, loot, campaigns, and encounters are the mobile use case. Maps, tokens, 3D dice, and the player window stay desktop features.

## Decision

- Bundled `data/` and `search/` are read through `vault.adapter` at `plugin.manifest.dir`. `configureFiveEToolsRoot(plugin)` sets that vault-relative directory as the renderer base URL.
- The image cache is written and read with the same adapter (`readBinary` / `writeBinary`). `getResourcePath` still supplies `<img src>`.
- `getPluginDir()` remains the absolute plugin folder on desktop and is empty on mobile. Map layers, fog, and the dice bundle use it, and they load Node `fs` / `path` only inside those functions.
- On mobile, the map tools show a notice. Entity preview opens in a split leaf. 3D dice no-ops.

## Consequences

- Campaign, encounter, and homebrew notes were already vault files; they did not need a new store.
- Desktop map code still needs a real filesystem path for layers and fog. Do not point those reads at the vault-relative root.
- After this change the plugin manifest is not desktop-only. A top-level Node import will break iPad again.
