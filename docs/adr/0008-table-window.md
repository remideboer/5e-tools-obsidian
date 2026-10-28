# ADR 0008: The Table window is not the map player view

## Status

Accepted

## Context

The map player popout draws the battle map. The table also needs a screen for a picture, initiative, and dice. Putting those on the map window would fight the map camera and the bitmap paint path.

## Decision

- The Table is its own popout view (`fiveetools-table`).
- One image is the full background until it is cleared or replaced.
- The initiative overlay is the ordered names and the current turn, not the empty ruler. The initiative card on the DM screen can hide that overlay. The ruler is edited on the DM screen. Public dice sit on top of the image and do not resize it.
- Private rolls stay on the DM screen. The map “Public rolls” switch is unchanged.
- The roster is edited on the DM screen and kept in memory. Nothing is written to the vault.

## Consequences

- Opening, clearing, and closing the Table does not open or close the map player window.
- A roll plays in whichever of those windows is open and allowed: the DM screen always, the map player window when public rolls are on, and the Table unless the roll is private.
