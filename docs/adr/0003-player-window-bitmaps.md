# ADR 0003: Player window draws via ImageBitmaps

## Status

Accepted

## Context

The player view is a popout window. Main-window `HTMLImageElement` / canvas cannot be drawn into the popout. Early designs photographed the GM (or a blit canvas) with `toDataURL` / `toBlob` every frame. That GPU readback blocked the main thread (~0.5–1s) whenever the player window was open, even though GM-only pan was already fast.

## Decision

- Mount a **canvas** in the player popout (`fiveetools-map-player__frame`), not an `<img>`.
- Snapshot map, fog, and token discs to `ImageBitmap` when those sources change; cache on the plugin instance.
- Each GM `paint` updates the popout by calling `drawWorld` on the popout canvas with those bitmaps and the current player camera.
- Do **not** use per-frame JPEG/PNG encode for live pan/zoom.

## Consequences

- First open of the player window may briefly show background/grid until bitmaps resolve.
- Fog/token bitmap refresh hooks must run on commit (fog save, place token), not only on pan.
- Closing the player window must `close()` bitmaps and clear caches to avoid leaks.
