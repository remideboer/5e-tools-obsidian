# ADR 0002: Map scene storage

## Status

Accepted

## Context

Maps need persistent layers, fog, camera, and tokens across Obsidian sessions. Desktop vault FS is available; mobile adapters are not a target.

## Decision

- Store each scene as a vault folder under `{notesFolder}/maps/<slug>/` with `scene.json` (version 1).
- Layers hold image + fog file paths, per-layer grid/DPI/offsets; **tokens are on the scene** (`scene.tokens`), shared across layer switches.
- Fog lives as PNG masks (`fog-live` / `fog-start`) next to layer assets.
- Token images are copied into `tokens/<id>.ext` inside the scene folder.

## Consequences

- Changing layers must not drop tokens or require re-place.
- `writeScene` / `scheduleSceneSave` are the persistence path; avoid writing scene JSON on every pointermove (save on gesture end or debounced edits).
- Scenes require `FileSystemAdapter`; fail clearly if not desktop.
