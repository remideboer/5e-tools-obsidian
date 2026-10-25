# ADR 0001: Obsidian plugin boundary

## Status

Accepted

## Context

The repo is full 5etools plus an Obsidian plugin. Runtime must not depend on the developer’s git checkout path. Obsidian loads plugins from the vault’s `.obsidian/plugins/` folder.

## Decision

- Bundle the plugin with `node/build-obsidian.js` (esbuild) into `build/obsidian/`, then install into vault(s) via `FIVEETOOLS_DEV_VAULTS`.
- Copy only an **allowlisted** set of `data/` and `search/` files into the install (including `data/generated/gendata-maps.json`).
- At runtime, `configureFiveEToolsRoot` points loaders at the **installed** plugin directory (`plugin.manifest.dir`). JSON and cache bytes go through the vault adapter ([ADR 0006](0006-vault-adapter-data.md)). `getPluginDir` is the desktop absolute path for map files.
- Do not read entity/map indexes from the git working tree in production code paths.

## Consequences

- Missing allowlist entries look like “index not found” in the UI even when the file exists in git.
- After source changes, agents must rebuild/install and the user must reload the plugin.
- Build output under `build/obsidian/` is not the source of truth for commits of feature code (`obsidian/src` is).
