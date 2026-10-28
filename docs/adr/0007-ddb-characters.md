# ADR 0007: D&D Beyond character cards

## Status

Accepted

## Context

The plugin needs public D&D Beyond characters in a campaign. Browser pages cannot call `character-service.dndbeyond.com` directly. A small proxy already serves public v5 JSON (`GET /?id=`) and avatars (`GET /?img=`).

## Decision

- One markdown card per character at `{notesFolder}/_characters/{ddbId}.md`, with the avatar under `_characters/_avatars/`. Importing the same id overwrites that file. The raw payload is not stored. The card keeps the short mechanics needed to render the sheet: senses, speeds, defenses, proficiencies, spell rows, actions, gear, features, choices, companions, and the person-and-story fields.
- Player → Characters lists, imports, refreshes, and deletes those cards. Refresh fetches a numeric id again through `settings.ddbProxyUrl`. A D&D Beyond character-sheet PDF uses the same card. Its stats are read from the sheet's widget fields (`/T` name, `/V` value), not from the proxy. The note id is `pdf-` plus the character name, so it does not replace a numeric D&D Beyond card. Refresh does not call the proxy for that id.
- A campaign player note stays a normal note. Frontmatter `character: {ddbId}` points at the shared card. The Players tab shows that same character sheet, not a note editor beside it. The card is not copied into the campaign folder.
- Only public characters work. Private and missing ids surface the proxy error. There is no pasted-JSON path and no rules-engine sheet.
- Spell, feat, species, class, subclass, and background links follow that entry's D&D Beyond `isLegacy` flag: legacy opens the 2014 book, otherwise the 2024 core book when that name exists there. Items with `isLegacy: true` are 2014; other items follow the character edition (`race.isLegacy`, else the spell mix). The plugin style switcher is not used. The chosen source is stored on the card and shown on the row (`PHB'14`, `PHB'24`, …). Clicking opens that entry in the preview popout.

## Consequences

- Campaigns and the character list share one file. Deleting the character leaves the player note in place; the card then says it is missing.
- AC starts from armor base, capped Dex, shield +2, and a `+N` in the item name, then adds numeric armor-class bonuses. With no armor equipped, an unarmored-armor-class modifier is 10 plus the named ability modifiers. Resistances, immunities, and vulnerabilities are text, not a second AC formula.
- Editable table state lives in `snapshot.play`: current HP, max HP, temporary HP, conditions, death saves, inspiration, current XP, prepared spell names, hit dice spent, coin amounts, and the gear list (equipped, attuned, attunable, added, and removed items). `attunable` is set from the D&D Beyond item or from a library item's `reqAttune`. Spell-slot checks stay on `snapshot.slots`. Refresh rewrites D&D Beyond content and keeps `play` and spent slots. The first import seeds `play` from the payload. A refresh fills `attunable` on gear rows that do not have it yet.
- The default proxy is the already deployed worker. A different public proxy can be set in plugin settings.
- A card imported before edition links has no snapshot. Refresh rewrites it. Homebrew names with no 5etools match stay plain text.
- The sheet is a row of columns that scroll on their own, in the same way as the DM screen. Person and story is the last column. Combat is the first column. Ability checks, saving throws, skills, and initiative are clickable `1d20` rolls. A proficient save or skill adds the proficiency bonus; expertise adds it twice; half-proficiency adds half, rounded down. Advantage and disadvantage are marked, and Passive Perception moves by 5. Prepared spells sit above the rest. Each spell, action, and gear row is at most two lines. Hovering a spell, item, action, feature, feat, or companion shows that short line in the native tooltip; the long description opens the preview.
