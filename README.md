# 5e.tools

Visit the [main site](https://5e.tools/index.html) or go to the unofficial GitHub [mirror](index.html).

[Join the 5etools Discord here!](https://discord.gg/5etools)

## Obsidian plugin

This repo also builds the **5etools** Obsidian plugin (`obsidian/`). It browses a bundled slice of 5etools and adds GM tools: library search, maps, campaigns, encounters, dice, and public D&D Beyond character cards. Architecture lives in [docs/README.md](docs/README.md).

### Requirements

- Node.js `>= 24`
- Obsidian `>= 1.8.7` (desktop and mobile). Battle maps and the player window are desktop-only.

### Build and install

From the repo root:

```powershell
npm install
npm run build:obsidian
```

That writes `build/obsidian/`: `main.js`, `manifest.json`, `styles.css`, an allowlisted copy of `data/` and `search/`, plus `dice/` and `heic/`.

To install into a vault while building, set `FIVEETOOLS_DEV_VAULTS` first. The variable is optional. Several vaults use the OS path delimiter (`;` on Windows, `:` elsewhere).

```powershell
$env:FIVEETOOLS_DEV_VAULTS = "C:\path\to\vault"
npm run build:obsidian
```

The build copies the bundle to `{vault}/.obsidian/plugins/5etools`. Obsidian runs that installed copy, not the git checkout. Enable **5etools** in Obsidian, then reload the plugin after each install.

To install by hand, copy `build/obsidian/` into the vault's `.obsidian/plugins/5etools` folder and enable the plugin.

To refresh bundled books from the upstream mirror, run `npm run sync:upstream-data`, then build again. See [docs/adr/0005-upstream-data-sync.md](docs/adr/0005-upstream-data-sync.md).

### Dependencies

Build-time packages come from `npm install`. The plugin build uses these; the rest of `devDependencies` is the upstream site (tests, CSS, JSON tooling).

- `esbuild` bundles the plugin.
- `heic2any` is copied into the bundle. The build stops if it is missing.
- `open-dice-dnd`, with `three` and `cannon-es`, is bundled as the optional 3D dice.

Bundled at runtime, and not installed by the user of the plugin:

- `elasticlunr` from `lib/elasticlunr.js`
- `heic2any`
- `open-dice-dnd`

`obsidian`, `electron`, and CodeMirror stay external and are provided by Obsidian.

Plugin settings: notes folder (default `5etools`), image host (default `https://5e.tools`), public D&D Beyond proxy, edition style, HEIC paste, 3D dice, and public rolls.

### Implemented features

- **Library and search.** Classes, backgrounds, feats, species, options, bestiary, traps, objects, cults, spells, items, conditions, rules, and adventures. A preview opens the matching book entry. Images load from the image host.
- **Tools.** Dice roller (clickable notation, optional 3D and public rolls), loot generator, roll tables, encounter composer, DM screen, homebrew, campaigns, and battle maps with fog, tokens, and a player window.
- **Characters.** Public D&D Beyond character cards: proficiency, skills, saves, initiative, spell slots, spells grouped by level, gear, and actions. Campaign notes can link a card. See [docs/adr/0007-ddb-characters.md](docs/adr/0007-ddb-characters.md).
- **Notes.** Insert an entity as a note. Pasted HEIC/HEIF images convert to JPEG.

## Help and Support

Please see [our wiki](https://wiki.tercept.net/) for FAQs, installation guides, supported integrations, and more.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

This project is licensed under the terms of the MIT license.
