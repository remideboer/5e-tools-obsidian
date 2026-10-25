# Core sequences

## 1. Open a map scene

```mermaid
sequenceDiagram
  participant GM as Library_or_Map_tool
  participant Scene as map-scene
  participant View as map-view
  participant Canvas as map-canvas
  GM->>Scene: createSceneFromImage_or_readScene
  Scene-->>GM: scenePath_scene.json
  GM->>View: openScene_or_session
  View->>View: showLayer_load_image_fog
  View->>Canvas: drawWorld_GM_canvas
  View->>View: ensureTokenImages
  View->>View: paintPlayer_if_popout_open
```

Fit uses layer grid (`cellPx`, offsets) when present; DPI detection must not wipe a pinned index grid.

## 2. Place or drag a token

```mermaid
sequenceDiagram
  participant UI as map-view
  participant Picker as map-token-picker
  participant Tokens as map-tokens
  participant Cache as media-cache
  participant Scene as scene.json
  UI->>Picker: Insert_token_or_drop
  Picker-->>UI: bestiary_doc
  UI->>Tokens: createSceneToken
  Tokens->>Cache: cachedMediaPath_card_image
  Tokens->>Tokens: copy_into_scene_tokens
  Tokens-->>UI: token_record
  UI->>Scene: tokens.push_scheduleSceneSave
  UI->>UI: schedule_paint
  Note over UI: Left-drag updates x_y live; release may snap then save
```

Tokens draw under fog and under the grid in `drawWorld`. Selection ring is GM-only.

## 3. GM pan / zoom with player window open

```mermaid
sequenceDiagram
  participant Ptr as bindMapPointer
  participant GM as map-view_paint
  participant Canvas as map-canvas
  participant Player as paintPlayer
  participant Pop as popout_canvas
  Ptr->>GM: onChange_pan_or_zoom
  GM->>Canvas: drawWorld_visible_rect
  GM->>Player: sendPlayerFrame
  Player->>Player: ensure_ImageBitmaps_if_stale
  Player->>Pop: drawWorld_with_bitmaps
  Note over Player,Pop: No toDataURL_or_toBlob_on_pan
```

Map / fog / token-disc bitmaps refresh when those pixels change (layer load, fog commit, new token size), not on every pan.

## 4. Reference map browse and use

```mermaid
sequenceDiagram
  participant Nav as References_Maps
  participant RefV as map-reference-view
  participant Ref as map-reference
  participant Cache as media-cache
  participant Scene as map-scene
  participant Map as map-view
  Nav->>RefV: renderReferenceMaps
  RefV->>Ref: listReferenceSources
  Ref->>Ref: load_gendata-maps.json
  RefV->>Cache: cachedMediaFile_or_fetchReferenceMap
  Note over RefV,Cache: Concurrency_limit_3_stale_gen_ignored
  RefV->>Scene: createReferenceScene_Use_as_map
  Scene-->>RefV: scenePath
  RefV->>Map: onOpenMap_selectNav_map
```

Index path is `getConfiguredAbsoluteRoot()/data/generated/gendata-maps.json` in the **installed** plugin, not the git tree. That absolute path exists on desktop only.
