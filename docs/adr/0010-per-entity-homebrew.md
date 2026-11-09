# ADR 0010: Per-entity homebrew and encounters

## Status

Accepted

## Context

Homebrew and saved encounters lived in single JSON catalogs (`_homebrew/homebrew.json`, `_encounters/encounters.json`). Every edit rewrote the whole file. Obsidian Sync, git, and multi-device workflows then conflicted whenever two devices changed different entries.

## Decision

- Each homebrew entity is one vault file: `{notesFolder}/_homebrew/{prop}/{slug}.json`, plus `{notesFolder}/_homebrew/_meta.json` for the HB source meta. Props are `spell`, `item`, `monster`, `background`, `race`. Images stay under `_homebrew/img/`.
- Each saved encounter is one vault file: `{notesFolder}/_encounters/{id}.json`. The open composer session is `{notesFolder}/_encounters/_instance.json`. Debounced composer saves write only `_instance.json`; naming/saving an encounter writes that encounter file.
- On first load, if a monolith `homebrew.json` or `encounters.json` is still present, split it into the new layout and rename the monolith to `*.bak`.
- In-memory catalogs stay merged for search, DataLoader, and the UI. Only vault I/O is per entity.

## Consequences

- Two devices can add different brew or encounters without wiping each other.
- Call sites use `saveHomebrewEntity` / `deleteHomebrewEntity` and `saveSavedEncounter` / `deleteSavedEncounterFromVault` instead of dumping the whole catalog.
- A rename of a brew entity deletes the old slug file. Encounter rename keeps the same `id` filename.
- Homebrew monsters may include inline `fluff.entries` (Description + named Lore) and plugin field `_homebrewRollTables` (vault `.md` paths and/or `loot:{id}` refs to loot-generator tables). Official bestiary lore still comes from `monsterFluff` via `Renderer.monster.pGetFluff`.
