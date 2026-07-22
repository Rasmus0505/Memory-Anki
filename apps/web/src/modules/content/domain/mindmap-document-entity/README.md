# Mind-map Document Entity

Pure document model shared by palace, knowledge, and review hosts.

- Owns document types, normalization, native transfer-file parsing, node commands, selectors, subtree traversal, search, and audit.
- Must not import React, React Flow, features, palace, knowledge, review, or persistence APIs.
- UI code consumes this entity through `@/modules/content/domain/mindmap-document-entity`.
- Business decorations and actions belong to explicit editor capabilities.
