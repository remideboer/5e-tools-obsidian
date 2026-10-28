# System architecture

## Context

The Obsidian plugin embeds a slice of 5etools (search index, entity JSON, fluff) and adds GM tools: library browsing, battle maps with fog and tokens, campaigns, encounters, roll tables, and dice. Library, loot, roll tables, campaigns, and encounters run on desktop and mobile. Bundled JSON and the image cache use the vault adapter ([ADR 0006](adr/0006-vault-adapter-data.md)). Map scenes, tokens, and the player window still use the desktop filesystem.

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
    vaultChars["vault/notesFolder/_characters"]
    vaultTables["vault/notesFolder/tables"]
    pluginRoot["plugins/5etools"]
    pluginCache["plugins/5etools/cache/img"]
  end
  subgraph net [Network]
    imgHost["settings.imageBaseUrl"]
    ddbProxy["settings.ddbProxyUrl"]
  end
  main --> lib
  main --> preview
  main --> player
  lib --> vaultMaps
  lib --> vaultCamp
  lib --> vaultChars
  lib --> vaultTables
  main --> pluginRoot
  lib --> pluginCache
  pluginCache --> imgHost
  lib --> ddbProxy
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
  plugin --> rolltables[Roll_tables]
  plugin --> dice[Dice_3D_and_public_rolls]
  plugin --> brew[Homebrew]
  library --> map
  library --> rolltables
  map --> player[Player_popout_canvas]
```

- **Library / search** — nav from `LIBRARY_NAV`, elasticlunr index, entity render via 5etools host. JSON comes from the vault adapter.
- **HEIC paste** — optional: HEIC/HEIF pasted or dropped into notes convert to JPEG via bundled `heic/heic2any.js`, then embed as a normal attachment.
- **Map** — desktop: vault scenes, layers, fog masks, scene-level tokens, GM canvas + player bitmap draw. On mobile the map tools show a notice.
- **Campaigns / encounters** — vault markdown and encounter store. A campaign player note can link a shared character with frontmatter `character: {ddbId}` ([ADR 0007](adr/0007-ddb-characters.md)).
- **Characters** — Player → Characters imports a public D&D Beyond character through `settings.ddbProxyUrl` into `{notesFolder}/_characters/{id}.md`. Refresh fetches that id again and keeps local table edits in `snapshot.play` (HP, conditions, prepared spells, hit dice, coins, and gear). The raw payload is not stored.
- **Roll tables** — paste import (markdown / TSV / numbered lists) into `{notesFolder}/tables/*.md` (Atlas-style `## Name` + table). Tools → Roll tables browses and rolls; shared result cards also render loot hits. Resolvable item names still open via `openPreview`. Die notations in results/preview (`1d20`, `2d6+3`, …) are clickable rollers via `dice-roll.js` (not auto-rolled).
- **Dice** — optional 3D dice; public rolls can target the player window document.
- **DPR** — Tools → DPR. Expected damage for checked attacks, spells, and heals. Each character gets one action, one bonus action, and one reaction; Extra Attack and a creature's Multiattack stay inside the action. A leveled spell spends the highest remaining slot (`max - spent`, pact slots kept separate) and adds the book's upcast dice; cantrips scale with character level and do not spend a slot. When the slots run out, that spell stops and a checked cantrip or attack fills the action. Checked heals take the bonus action and land on the most wounded ally, capped at that ally's own HP. Attacks use the target's AC. A character at 0 HP stops attacking. Nothing is written to the vault.
- **Simulation** — Tools → Simulation. A separate dice fight on a 5-foot grid. The list column chooses the party and either a challenge rating, a saved encounter, or creatures added from the library and homebrew search, then Reset, step, play/pause, Run, and Run N. Each creature moves and rolls its best legal option. A creature with Intelligence 7 or lower goes for the nearest opponent. Intelligence 13 or higher goes for the opponent who can deal the most damage. If a living ally has Intelligence 12 or higher, the less intelligent creatures on that side follow that leader and attack the most dangerous opponent first. A stable or dying character can still be attacked, but only once no one on that side is still fighting. The attack has advantage in melee, a hit from within 5 feet is a critical hit, and the damage is a death save failure (two if it is a critical hit). Damage that reaches their hit point maximum kills them. Damage follows resistances, vulnerabilities, and immunities. A druid's Wild Shape becomes a legal beast and then uses that beast's attacks. Nothing is written to the vault.
- **Homebrew** — vault brew files indexed into search.

## Build pipeline

`node/build-obsidian.js` esbuilds `obsidian/main.js` → `build/obsidian/main.js`, copies allowlisted `data/` (including `gendata-maps.json`) and `search/`, then optionally installs into vaults listed in `FIVEETOOLS_DEV_VAULTS`.

Content updates from the upstream mirror use `npm run sync:upstream-data` (only `data/` + `search/index.json`), then the same Obsidian build to refresh the vault plugin. See [ADR 0005](adr/0005-upstream-data-sync.md).
