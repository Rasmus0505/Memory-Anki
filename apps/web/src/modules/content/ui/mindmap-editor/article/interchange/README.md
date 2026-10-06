# Article interchange

The `index.ts` API is framework-free and runs in a Node environment or browser. It imports content-owned canonical document primitives directly. The optional `browser.ts` adapter requires a DOM and sanitizes HTML with DOMPurify before Turndown conversion. No legacy Peg Markdown dialect, backend calls, persistence, asset fetches, or quiz mutations are involved.

## API

```ts
import {
  importArticleMarkdown, exportArticleMarkdown,
  exportArticlePackage, importArticlePackage,
} from './interchange'

const preview = importArticleMarkdown(markdown, { title: 'Article' })
// preview.document; preview.warnings
const plain = exportArticleMarkdown(preview.document)
// plain.markdown; plain.warnings (plain Markdown is intentionally lossy)
const complete = exportArticlePackage(document, {
  sourceOwner: 'palace:123',
  baseRevision: revision,
  assets: [{ source: '/api/assets/42', path: 'assets/42.png', mediaType: 'image/png', bytes }],
  quiz: { format: 'host-owned-v1', data: hostQuizPayload },
})
// complete.bytes is a ZIP Uint8Array; complete.manifest; complete.warnings
const imported = importArticlePackage(complete.bytes, { expectedSourceOwner: 'palace:123' })
// imported.document, warnings, manifest, baseDocument, assets, quiz
// imported.requiresReconciliation === true
```

Both importers are preview-only. New UIDs use `crypto.randomUUID()`; tests/hosts may inject `createUid`. A repeating/nonunique factory fails rather than producing duplicate identities.

## Format version 1

Required ZIP entries: `manifest.json`, `document.json`, `base-document.json`, `content.md`. Asset bytes use strict `assets/<safe-filename>` paths. Optional `quiz.json` is opaque to this codec. The manifest includes format/version, source owner, optional base revision, paths, and explicit asset source/path/media-type mapping.

`document.json` preserves the canonical metadata; `base-document.json` records the exported base for host conflict checks. Editable Markdown uses ordinary ATX heading and nested-list structure, with `<!-- memory-anki-node:ENCODED_UID -->` on each title. Body fences (`<!-- memory-anki-body:body -->` and matching closing comment) retain body-owned lists/headings distinctly from outline nodes; preserve them when editing externally. Markdown-inexpressible body marks/attributes survive if that node's Markdown body projection remains unchanged. Editing such a body can lose those marks and emits conversion warnings on export.

Only a unique known UID anchor in a complete package retains identity and metadata. Duplicate, absent, malformed or unknown anchors create new nodes and warnings. Titles, order and repeated content are never used for identity matching. Plain Markdown anchors are untrusted and cannot acquire existing UIDs. Deleting a node deletes it from the preview; the host must resolve affected backend bindings before applying.

## Safety and integration contract

- ZIP compressed/expanded/per-entry size and count limits are checked before decompression. Central/local headers, safe paths, case-insensitive duplicate names, declared paths, extracted sizes and CRC are checked. ZIP64, multipart and encrypted archives are rejected.
- Canonical documents require valid, unique node identities and bounded rich JSON. Passive established highlight-title markup is accepted; arbitrary canonical HTML is rejected. The browser HTML adapter sanitizes active HTML. Markdown raw HTML is removed with a warning.
- Unknown image references require host resolution; supported image locations are HTTP(S), root-relative URLs or strict portable asset paths. Complete export fails if any referenced image lacks supplied bytes: it never advertises an externally dependent image package as self-contained.
- Imported bytes are not decoded or executed as images. The host must validate file types, upload/remap assets, and use safe render URLs. Edited content introducing external images produces an `external-assets` warning.
- Missing quiz payload means no quiz backup, explicitly warned. Packaging arbitrary host quiz JSON does **not** restore question rows or bindings.
- Before applying, host checks source owner, base revision and owner/operation identity; reconciles deleted/new nodes and bindings; validates asset types; obtains confirmation; then performs backend work atomically as appropriate. `owner-mismatch` is not automatic permission to transfer bindings.
- Plain Markdown preserves article text and ordinary rich blocks but not canonical metadata/UIDs or perfect rich formatting. Nested body list/heading versus outline distinction requires the explicit package format.

Tests cover pure operation without a DOM, structural/body ownership, common rich blocks, stable and ambiguous identities, round-trip metadata, real asset/quiz bytes, hostile HTML/URLs, ZIP traversal/bombs/checksums/manifest validation, and browser HTML sanitization.
