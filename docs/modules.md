# Module map

The plugin is mostly **ESM functions**, not a class hierarchy. Views subclass Obsidian `ItemView`. Treat this as a module dependency map.

## Views and entry

| Symbol | File | Role |
|--------|------|------|
| `FiveEToolsPlugin` | `obsidian/main.js` | Lifecycle, settings, `ensureReady`, open library |
| `FiveEToolsLibraryView` | `library-view.js` | Main UI: nav, list, tools (map, loot, …) |
| `FiveEToolsView` | `entity-view.js` | Entity preview leaf |
| `FiveEToolsMapPlayerView` | `map-view.js` | Player popout; owns `frame` canvas |
| `FiveEToolsTableView` | `table-view.js` | Table popout; image background, initiative overlay |
| View type ids | `constants.js` | `fiveetools-library`, `fiveetools-preview`, `fiveetools-map-player`, `fiveetools-table` |

## Area map

```mermaid
flowchart TB
  subgraph host [Host]
    main[main.js]
    fth[fiveetools-host.js]
    pdir[plugin-dir.js]
    lfs[local-fs.js]
  end
  subgraph search [Search_and_entities]
    si[search-index.js]
    el[entity-loader.js]
    er[entity-reader.js]
    ir[image-resolver.js]
  end
  subgraph ui [Library_UI]
    lv[library-view.js]
    mrv[map-reference-view.js]
    mr[map-reference.js]
  end
  subgraph map [Map]
    mv[map-view.js]
    mc[map-canvas.js]
    ms[map-scene.js]
    mf[map-fog.js]
    mt[map-tokens.js]
    mtp[map-token-picker.js]
  end
  subgraph media [Media]
    cache[media-cache.js]
  end
  main --> fth
  main --> lv
  main --> mv
  lv --> mrv
  lv --> mv
  mrv --> mr
  mr --> cache
  mr --> ms
  mv --> mc
  mv --> ms
  mv --> mf
  mv --> mt
  mv --> mtp
  mt --> cache
  fth --> si
  si --> el
```

## Map stack (detail)

| File | Responsibility |
|------|----------------|
| `map-view.js` | GM UI, pointer tools, fog gestures, token drag, `paint` / `paintPlayer`, player bitmaps |
| `map-canvas.js` | Camera math, `drawWorld`, grid/token blit, `bindMapPointer` |
| `map-scene.js` | Vault scene CRUD, layer paths, `scene.json` |
| `map-fog.js` | Fog mask canvas, brush/shapes, PNG save/load |
| `map-tokens.js` | Size footprints, snap, hit-test, create token asset |
| `map-token-picker.js` | Bestiary search modal, drag payload |
| `map-reference.js` | Load `gendata-maps.json`, fetch/cache map images, create scenes |
| `map-reference-view.js` | References → Maps two-pane browser |
| `map-scale.js` / `map-dpi.js` | Cell inches, DPI, actual-size player scale |

## Other areas (short)

| Area | Key files |
|------|-----------|
| Campaigns | `campaign-view.js`, `campaign-store.js`, `campaign-editor.js` |
| Characters | `character-view.js`, `character-store.js`, `ddb-import.js` (public D&D Beyond cards in `{notesFolder}/_characters/{id}.md`; campaigns link with `character: id`) |
| Encounters | `encounter-view.js`, `encounter-store.js`, `encounter-difficulty.js`, `encounter-random.js` (Random encounter; roster kind groups + shared initiative / roll-all / reset order) |
| DPR | `dpr-view.js`, `dpr-calc.js` (expected damage charts; spell and attack checkboxes) |
| Simulation | `sim-view.js`, `dpr-sim.js`, `dpr-ai.js` (dice fight; party and encounter controls; class tactics, Disengage, movement, Wild Shape, and damage adjustments) |
| DM screen | `dm-screen-view.js`, `dm-screen-store.js` (pins, homebrew, campaign notes, encounter card, quick refs, roll tables; `{notesFolder}/_dmscreen/board.json`) |
| Dice | `dice-roll.js`, `dice-3d.js`, `dice-3d-lib.js`; Tools → Dice roller via `dice-roller-view.js` + `dice-icons.js` (polyhedral tap-to-roll, adv/disadv). Non-private rolls also play on the Table popout. |
| Table | `table-view.js`, `table-session.js` (25-to-1 initiative ruler; popout image, ordered names, current turn, 3D dice). Not the map player window. |
| Homebrew | `homebrew-view.js`, `homebrew-store.js` |
| Loot | `loot-view.js` (results via `roll-result-card.js`; treasure type → table ids for creature footer) |
| Roll tables | `roll-tables/` (`pasted-table`, `die-ranges`, `table-note`, `table-roll`, `roll-table-store`, `roll-tables-view`), shared `roll-result-card.js` |
| Library rows | `library-row.js` + `spell-meta.js` / `item-meta.js` / `bestiary-meta.js` (CR, rarity, level, type/alignment/habitat, classes; icon sort; spell/item/bestiary filters) |
| Creature stats | `entity-reader.js` + `creature-stat-footer.js` (Habitat/Treasure on compact monsters; habitat → bestiary filter; treasure link/dice → Loot Generator / roll popup) |
| Notes / tags | `note-writer.js`, `fivee-tag.js`, `link-suggest.js` |

## Import rules of thumb

- Bundled JSON is read with `vault.adapter` from `plugin.manifest.dir` (ADR 0006). Do not statically import Node `fs` or `path`.
- `map-reference` must not pull `fiveetools-host` in a way that runs before root configure. The desktop catalog uses `getConfiguredAbsoluteRoot()`.
- Player popout cannot `drawImage` main-window `HTMLImageElement`s; use `ImageBitmap` (see ADR 0003).
- Scene tokens live on `scene.tokens` (shared across layers); layer switches must not clear them.
