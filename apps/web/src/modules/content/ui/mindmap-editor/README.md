# Mind-map Editor

Shared editor runtime used by palace, knowledge, and review hosts.

- `MindMapEditorSurface`: orchestration only; no business API calls.
- `capabilities.ts`: explicit business decoration and node-action composition.
- `useMindMapDocumentSession`: persistence effect driver over the pure session reducer.
- `documentGraphProjection.ts`: converts typed documents and capability data into generic canvas view models.
- Import production APIs through `@/modules/content/ui/mindmap-editor`.
