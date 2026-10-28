# ADR 0008: The Table window is not the map player view

## Status

Accepted

## Context

The map player popout draws the battle map. The table also needs a screen for a picture, initiative, and dice. Putting those on the map window would fight the map camera and the bitmap paint path.

## Decision

- The Table is its own popout view (`fiveetools-table`).
- One image is the full background until it is cleared or replaced.
- The initiative roster and the existing 3D dice plus result popup are overlays. They do not resize the image.
- Private rolls stay on the DM screen. The map “Public rolls” switch is unchanged.
- The roster is edited on the DM screen and kept in memory. Nothing is written to the vault.

## Consequences

- Opening, clearing, and closing the Table does not open or close the map player window.
- A roll plays in whichever of those windows is open and allowed: the DM screen always, the map player window when public rolls are on, and the Table unless the roll is private.
