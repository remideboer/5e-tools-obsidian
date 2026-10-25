# System architecture

## Context

The Obsidian plugin embeds a slice of 5etools (search index, entity JSON, fluff) and adds GM tools: library browsing, battle maps with fog and tokens, campaigns, encounters, and dice. Library, loot, campaigns, and encounters run on desktop and mobile. Bundled JSON and the image cache use the vault adapter ([ADR 0006](adr/0006-vault-adapter-data.md)). Map scenes, tokens, and the player window still use the desktop filesystem.

```mermaid
flowchart TB
  user[GM_in_Obsidian]
  players[Players_at_table]
  user --> obsidian[Obsidian]
  obsidian --> plugin[FiveETools_plugin]
  plugin --> vault[Vault_notes_maps_campaigns]
  plugin --> install[Plugin_install_dir]
  install --> data[Bundled_data_and_search]
  install --> cache[Media_cache]
  plugin --> remote[imageBaseUrl_host]
  plugin --> playerWin[Player_map_popout]
  players --> playerWin
```

## Containers

```mermaid
flowchart LR
  subgraph host [Obsidian]
    main[main.js_Plugin]
    lib[Library_ItemView]
    preview[Entity_preview_ItemView]
    player[Map_player_ItemView]
  end
  subgraph disk [Local disk]
    vaultMaps["vault/notesFolder/maps"]
    vaultCamp["vault/notesFolder/campaigns"]
    pluginRoot["plugins/5etools"]
    pluginCache["plugins/5etools/cache/img"]
  end
  subgraph net [Network]
    imgHost["settings.imageBaseUrl"]
  end
  main --> lib
  main --> preview
  main --> player
  lib --> vaultMaps
  lib --> vaultCamp
  main --> pluginRoot
  lib --> pluginCache
  pluginCache --> imgHost
```

## Runtime roots (do not confuse)

| Root | Path | Used for |
|------|------|----------|
| Plugin install | `plugin.manifest.dir` (vault-relative) | Bundled `data/`, `search/`, plugin `cache/` via `vault.adapter` |
| Configured 5etools root | `configureFiveEToolsRoot(plugin)` → that dir plus `/` | Entity JSON loader (`getConfiguredRoot()`) |
| Desktop plugin dir | `getPluginDir(plugin)` / `getConfiguredAbsoluteRoot()` | Map files and the 3D dice bundle. Empty on mobile |
| Vault base | `FileSystemAdapter.getBasePath()` | Desktop scenes under `{notesFolder}/maps` |
| Git checkout | `D:/projecten/5etools` | Source + `node/build-obsidian.js` only; **not** read at runtime |

If a generated file (e.g. `gendata-maps.json`) is missing at runtime, fix the build allowlist and reinstall—editing the git tree alone does not update the vault plugin.

## Feature areas

```mermaid
flowchart TB
  plugin[FiveEToolsPlugin]
  plugin --> library[Library_and_search]
  plugin --> map[Map_scenes_fog_tokens]
  plugin --> campaign[Campaigns]
  plugin --> encounter[Encounter_composer]
  plugin --> dice[Dice_3D_and_public_rolls]
  plugin --> brew[Homebrew]
  library --> map
  map --> player[Player_popout_canvas]
```

- **Library / search** — nav from `LIBRARY_NAV`, elasticlunr index, entity render via 5etools host. JSON comes from the vault adapter.
- **Map** — desktop: vault scenes, layers, fog masks, scene-level tokens, GM canvas + player bitmap draw. On mobile the map tools show a notice.
- **Campaigns / encounters** — vault markdown and encounter store.
- **Dice** — optional 3D dice; public rolls can target the player window document.
- **Homebrew** — vault brew files indexed into search.

## Build pipeline

`node/build-obsidian.js` esbuilds `obsidian/main.js` → `build/obsidian/main.js`, copies allowlisted `data/` (including `gendata-maps.json`) and `search/`, then optionally installs into vaults listed in `FIVEETOOLS_DEV_VAULTS`.

Content updates from the upstream mirror use `npm run sync:upstream-data` (only `data/` + `search/index.json`), then the same Obsidian build to refresh the vault plugin. See [ADR 0005](adr/0005-upstream-data-sync.md).
