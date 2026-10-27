# Obsidian plugin architecture

Docs for the **5etools Obsidian plugin** under `obsidian/`. They help humans and AI agents learn the boundaries, modules, and key flows without reading every file.

Upstream 5etools (`js/`, `data/`) is only covered where the plugin depends on it. Source of truth for behavior remains the code.

## Read order

1. [architecture.md](architecture.md) — system context, containers, runtime roots
2. [modules.md](modules.md) — ESM module map and views
3. [sequences.md](sequences.md) — open scene, tokens, player paint, reference maps
4. [adr/](adr/) — decisions that should not be “rediscovered” in every change

## When to open an ADR

| Topic | ADR |
|-------|-----|
| Build, install dir, data root | [0001](adr/0001-obsidian-plugin-boundary.md) |
| Vault `scene.json`, layers, tokens | [0002](adr/0002-map-scene-storage.md) |
| Player window rendering / pan performance | [0003](adr/0003-player-window-bitmaps.md) |
| Media cache, image URLs, map index | [0004](adr/0004-media-cache-and-roots.md) |
| Upstream `data/` sync | [0005](adr/0005-upstream-data-sync.md) |
| Mobile vault-adapter reads | [0006](adr/0006-vault-adapter-data.md) |
| D&D Beyond character cards | [0007](adr/0007-ddb-characters.md) |

## Build and install

From the repo root:

```powershell
$env:FIVEETOOLS_DEV_VAULTS = "C:\Users\remid\Documents\Obsidian Vault"
node node/build-obsidian.js
```

The running plugin is the **installed vault copy** (`.obsidian/plugins/5etools`), not the git checkout. Reload the plugin in Obsidian after install.

## Upstream data sync

Pull only content from the 5etools mirror (not Obsidian code):

```powershell
npm run sync:upstream-data
# review staged data/, then commit
$env:FIVEETOOLS_DEV_VAULTS = "C:\Users\remid\Documents\Obsidian Vault"
npm run sync:upstream-data:install
```

See [ADR 0005](adr/0005-upstream-data-sync.md).

## Agent note

Project rule `.cursor/rules/architecture-docs.mdc` asks agents to read these docs before changes under `obsidian/` or `node/build-obsidian.js`, and to update them when architecture changes.
