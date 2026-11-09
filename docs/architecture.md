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
| Plugin install | `plugin.manifest.dir` (vault-relative) | Bundled `data/`, `search/`, `dice/`, plugin `cache/` via `vault.adapter` |
| Configured 5etools root | `configureFiveEToolsRoot(plugin)` → that dir plus `/` | Entity JSON loader (`getConfiguredRoot()`) |
| Desktop plugin dir | `getPluginDir(plugin)` / `getConfiguredAbsoluteRoot()` | Map files. Empty on mobile |
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

- **Library / search** — nav from `LIBRARY_NAV`, elasticlunr index, entity render via 5etools host. JSON comes from the vault adapter. A checkbox on the nav search also matches spell, creature, and item text; that index is cached under `{notesFolder}/_cache/fulltext.json` and is not built while the checkbox is off.
- **HEIC paste** — optional: HEIC/HEIF pasted or dropped into notes convert to JPEG via bundled `heic/heic2any.js`, then embed as a normal attachment. A note that already embeds a HEIC or HEIF file shows that image as JPEG. The vault file stays HEIC.
- **Map** — desktop: vault scenes, layers, fog masks, scene-level tokens, GM canvas + player bitmap draw. On mobile the map tools show a notice.
- **Campaigns / encounters** — vault markdown and encounter store. Saved encounters are one JSON file each under `{notesFolder}/_encounters/` ([ADR 0010](adr/0010-per-entity-homebrew.md)). A campaign player note can link a shared character with frontmatter `character: {ddbId}` ([ADR 0007](adr/0007-ddb-characters.md)). Scaling a creature group, or editing a custom creature and adding it, stores that stat block on every copy in the group. The saved encounter, the campaign note, and the simulation use that copy.
- **Characters** — Player → Characters imports a public D&D Beyond character through `settings.ddbProxyUrl` into `{notesFolder}/_characters/{id}.md`. Refresh fetches that id again and keeps local table edits in `snapshot.play` (HP, conditions, prepared spells, hit dice, coins, gear, and the initiative display name). The raw payload is not stored.
- **Roll tables** — paste import (markdown / TSV / numbered lists) into `{notesFolder}/tables/*.md` (Atlas-style `## Name` + table). Tools → Roll tables browses and rolls; shared result cards also render loot hits. Several result columns are separate rolls. The viewed table is edited in place. Resolvable item names still open via `openPreview`. Die notations in results/preview (`1d20`, `2d6+3`, …) are clickable rollers via `dice-roll.js` (not auto-rolled).
- **Dice** — optional 3D dice on desktop and mobile when WebGL is available ([ADR 0009](adr/0009-mobile-3d-dice.md)); public rolls can target the player window document. A roll marked private on the Table tool stays on the DM screen. Otherwise, when the Table window is open, the same 3D dice and result popup also play there. The DM screen Dice card uses the same roller, drawn smaller, and keeps its amount, modifier, advantage, and history on the board.
- **Table** — Tools → Table. A popout that is not the map player window ([ADR 0008](adr/0008-table-window.md)). One image fills that window until it is cleared. The editor is a ruler from 25 down to 1; creatures are dragged onto a number. Beside it, a live mirror shares freehand marks, text, stamps, area templates, place markers, and a transient laser with the popout. The GM can pan and zoom that mirror locally; the player popout stays at normal size. Marks use normalized image coordinates, live only in the in-memory Table session, and clear when the image changes. The Table window and the DM screen show only the initiative names, highest first, and the current turn has a red border. Each name on the Table window is a percentage of that window's height, set by the Size slider on the DM initiative card. The roster width scales with that size. Double-click a row on the DM screen marks that turn and advances, the same as Enter. Double-click or Enter on a row that already went, before the round is over, unmarks only that row. An × at the end of a row removes that entry. Dragging a name reorders the roster, and the ruler shows that order on consecutive numbers from the highest score already in use. Players places the Players card’s characters from 20 downward, in alphabetical order. A name entered beside that button is placed under those characters. DM adds Enemies at the end of the roster. A row without a picture shows a shield token. The initiative card can hide that roster on the Table window. Public dice sit on top of the image. The DM adds creatures, encounters, characters, and names from the main screen. Nothing is written to the vault.
- **DPR** — Tools → DPR. Expected damage for checked attacks, spells, and heals. Each character gets one action, one bonus action, and one reaction; Extra Attack and a creature's Multiattack stay inside the action. A leveled spell spends the highest remaining slot (`max - spent`, pact slots kept separate) and adds the book's upcast dice; cantrips scale with character level and do not spend a slot. When the slots run out, that spell stops and a checked cantrip or attack fills the action. Checked heals take the bonus action and land on the most wounded ally, capped at that ally's own HP. Attacks use the target's AC. A character at 0 HP stops attacking. Nothing is written to the vault.
- **Encounter size** — Tools → Encounter size. A level-by-CR table of how many monsters fit a party budget. Standard initiative counts threat by each monster's attacks. Players first lowers that threat by the attacks the party spends before any monster acts, so fewer monsters leave more room and a monster with more attacks loses less of its turn.
- **Random** — Tools → Random. The generator list follows donjon’s 5.5 Random Generator. Rolls use the local library: encounters, traps, treasure, NPCs, names, trinkets, art objects, magic items, spellbooks, wild magic, and bastion events. Names are rolled from the Xanathar’s Guide tables in the library (plus the gith and lizardfolk lists). Generate lists ten rows. The 1d10 above them is rolled by hand and marks that row. An NPC row is a name, species, class, alignment, ability scores, and a short description. Creature, spell, and item names open the usual preview. A marked encounter can be added to the Encounter Composer.
- **Simulation** — Tools → Simulation. A separate dice fight on a 5-foot grid. The list column chooses the party, including every linked player from a campaign, and either a challenge rating, a saved encounter, or creatures added from the library and homebrew search. A campaign encounter can be sent to the simulation with that campaign’s linked players and that encounter’s creatures. Added creatures and a chosen saved encounter show the same instance roster as the encounter composer. Editing a saved encounter there writes those copies back. A group that was scaled or edited fights with the stat block stored on those copies. Added creatures can be sent to the Encounter Composer as a new unsaved encounter. The setup shows Easy, Medium, Hard, Deadly, or the 2024 tier for the selected party and creatures. Then Reset, step, play/pause, Run, and Run N. Initiative is rolled when those buttons start a fight, not when the party or encounter is chosen. Enemies of one kind share an initiative roll, and Players first sends the party through in passive order before the creatures. Each creature moves and rolls its best legal option. A creature with Intelligence 7 or lower goes for the nearest opponent. Intelligence 13 or higher goes for the opponent who can deal the most damage. If a living ally has Intelligence 12 or higher, the less intelligent creatures on that side follow that leader and attack the most dangerous opponent first. A stable or dying character can still be attacked, but only once no one on that side is still fighting. The attack has advantage in melee, a hit from within 5 feet is a critical hit, and the damage is a death save failure (two if it is a critical hit). Damage that reaches their hit point maximum kills them. Damage follows resistances, vulnerabilities, and immunities. A druid's Wild Shape becomes a legal beast and then uses that beast's attacks. Riders such as Sneak Attack, Divine Smite, and Hex modify a hit. Divine Smite stays available when the card has no dice, and the first melee hit on a dangerous foe spends it; First Strike is named on that same hit line. A higher slot is spent only when it adds dice, a hit can force a save for extra damage or a condition such as poisoned, and Action Surge, Rage, Stunning Strike, Lay on Hands, and Channel Divinity spend the uses on the card. A creature's combat traits, including Regeneration, Pack Tactics, and Legendary Resistance, apply during the fight. The damage type named on Regeneration, such as fire, stops that healing on the creature's next turn, and a party member who can deal it uses that attack. An unnamed Multiattack uses each of its attacks. A finished fight shows which side won, and Run N totals wins, survivors, deaths, death saves, and the actions that dealt or healed the most. Each run starts from full hit points, spell slots, and class uses. A party member steps onto an injured ally for a touch such as Medicine, unless a melee attacker is next to that ally or in the way, and restores hit points when that ally is dying or badly hurt. The fight writes nothing to the vault.
- **Homebrew** — one vault JSON per entity under `{notesFolder}/_homebrew/{prop}/`, indexed into search ([ADR 0010](adr/0010-per-entity-homebrew.md)). Spells, items, creatures, backgrounds, and species can store an image under `{notesFolder}/_homebrew/img`, shown the same way as a built-in picture.

## Build pipeline

`node/build-obsidian.js` esbuilds `obsidian/main.js` → `build/obsidian/main.js`, copies allowlisted `data/` (including `gendata-maps.json`, `gendata-tables.json`, and `names.json`) and `search/`, then optionally installs into vaults listed in `FIVEETOOLS_DEV_VAULTS`.

Content updates from the upstream mirror use `npm run sync:upstream-obsidian` (`data/` + `search/index.json`, plus missing Parser site-source registrations), then the same Obsidian build to refresh the vault plugin. See [ADR 0005](adr/0005-upstream-data-sync.md).
