# ADR 0009: 3D dice on mobile

## Status

Accepted

## Context

Desktop loaded `dice/dice-3d.js` with Node `require` from `getPluginDir()`. That path is empty on iPad, and `showDice3d` returned immediately. The bundle is browser code (`open-dice-dnd`, Three.js, cannon-es). Newer iPads have WebGL. Maps and the player window still need the desktop filesystem.

## Decision

- Build `dice/dice-3d.js` as an IIFE that sets `globalThis.FiveEToolsDice.DiceRoller`.
- Load it with a script tag from `adapter.getResourcePath`, the same way `heic/heic2any.js` loads. The script stays out of `main.js` and loads on the first roll.
- Desktop and mobile share that loader. Popout documents still receive a roller constructed against their own overlay.
- If WebGL or the script fails, the numeric roll popup still shows. The "3D dice" setting stays off until the user turns it on.
- Map scenes, tokens, and the player window stay desktop-only.

## Consequences

- A static import of the dice library in `main.js` would parse Three.js at startup on every iPad session. Do not do that.
- `getPluginDir()` is no longer used for the dice bundle.
