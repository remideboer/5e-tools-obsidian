# ADR 0007: D&D Beyond character cards

## Status

Accepted

## Context

The plugin needs public D&D Beyond characters in a campaign without a full character sheet. Browser pages cannot call `character-service.dndbeyond.com` directly. A small proxy already serves public v5 JSON (`GET /?id=`) and avatars (`GET /?img=`).

## Decision

- One markdown card per character at `{notesFolder}/_characters/{ddbId}.md`, with the avatar under `_characters/_avatars/`. Importing the same id overwrites that file. The raw payload is not stored.
- Player → Characters lists, imports, refreshes, and deletes those cards. Refresh fetches the id again through `settings.ddbProxyUrl`.
- A campaign player note stays a normal note. Frontmatter `character: {ddbId}` points at the shared card. The Players tab shows that card above the note editor. The card is not copied into the campaign folder.
- Only public characters work. Private and missing ids surface the proxy error. There is no pasted-JSON path and no rules-engine sheet.
- Spell, feat, species, class, subclass, and background links follow that entry's D&D Beyond `isLegacy` flag: legacy opens the 2014 book, otherwise the 2024 core book when that name exists there. Items with `isLegacy: true` are 2014; other items follow the character edition (`race.isLegacy`, else the spell mix). The plugin style switcher is not used. The chosen source is stored on the card and shown on the row (`PHB'14`, `PHB'24`, …). Clicking opens that entry in the preview popout.

## Consequences

- Campaigns and the character list share one file. Deleting the character leaves the player note in place; the card then says it is missing.
- AC and HP on the card are a short summary (armor base, capped Dex, shield +2, name bonus `+N`, hit points from base or override). They are not a full modifier walk.
- The default proxy is the already deployed worker. A different public proxy can be set in plugin settings.
- A card imported before edition links has no snapshot. Refresh rewrites it. Homebrew names with no 5etools match stay plain text.
- Ability checks, saving throws, skills, and initiative on the card are clickable `1d20` rolls. A proficient save or skill adds the proficiency bonus, shown on the card as `PB +n`; expertise adds it twice. Passive Perception is 10 + Perception. The card order is the table order: combat numbers, abilities, saves, skills, actions, spells, then the rest. Class and species actions (such as Wild Shape, with its uses) are listed too.
