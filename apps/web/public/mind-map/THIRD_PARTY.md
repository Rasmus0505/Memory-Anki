# Mind Map Vendor Assets

`dist/` contains a vendored, prebuilt mind map application used by Memory Anki through
`/mind-map-host.html`.

Current status:

- The bundle is intentionally kept as a black-box runtime dependency.
- Memory Anki integration code lives outside `dist/`, primarily in
  `/mind-map-host.html`, `/mind-map-host.css`, and `/mind-map-host-bridge.js`.
- Do not edit generated files under `dist/` directly unless replacing the whole vendor
  bundle.
- Before public redistribution or commercial use, confirm the upstream project name,
  version, source URL, and license, then record them here.

Known provenance:

- Upstream: TODO
- Version/commit: TODO
- License: TODO
- Import date: before 2026-06-28

Replacement rule:

When replacing `dist/`, verify editor boot, save/restore, readonly practice mode,
fullscreen, segment selection, mini-palace highlighting, bilink badges, and AI split
toolbar behavior before committing the new bundle.
