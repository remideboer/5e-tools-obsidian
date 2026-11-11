# ADR 0011: iPad print uses the share sheet

## Status

Accepted

## Context

`window.print()` does not present the system print sheet in Obsidian’s iPad WKWebView. A zero-size iframe, the app window, and a full-size iframe all call `print()` and the sheet still does not open.

## Decision

- On `Platform.isIosApp`, Print card renders the card to a PNG and calls `navigator.share({ files })`.
- The share sheet is where Print lives. The call stays on a tap: the Print button when the image is already ready, otherwise a Continue to print button after the image is built.
- Desktop keeps the small print iframe. Android keeps printing the app window.

## Consequences

- The card image is built with `html2canvas-pro`, bundled into the plugin. The creature picture is inlined from the media cache so the canvas is not tainted.
- A reload of the installed plugin is required before an iPad can share a card.
