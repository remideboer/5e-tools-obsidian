# ADR 0012: Sound library

## Status

Accepted

## Context

A DM needs a looping bed (music or ambience), a one-shot effect on top, and a playlist prepared for a scene. The vault already holds the audio files. YouTube and YouTube Music terms do not allow detaching the audio, and a Music link has no stable embed.

## Decision

- Clips and playlists live in one `{notesFolder}/_sounds/library.json`. The audio bytes stay the vault file, or a direct `https` link to an audio file. The file is not copied.
- A chosen vault folder is stored with a kind. Every audio file in that folder and its subfolders is selectable. Those files are not copied.
- Two audio elements share that library: a bed (play, pause, next, previous, loop, volume) and a one-shot effect. `play()` runs in the click, before any await.
- A YouTube link is stored as a title and address and opens in the browser.
- A saved encounter may store `playlistId`. Loading that encounter, or Sounds on the DM screen encounter card, sets the active playlist. The DM presses play.

## Consequences

- No Discord stream, layered ambience, or hidden YouTube player.
- One Sound card on the DM screen. The Sounds tool and the card share the library and the active playlist.
