# Mind-map Canvas

Generic React Flow renderer.

- Owns layout, viewport, drag/drop, node measurement, and generic visual rendering.
- Receives `GraphData` and `MindMapNodeVisual`; it does not know palace, review, segment, or mastery semantics.
- Must not import entities or features.
- Structure drag preview is **target chrome only** (ghost source + drop placeholders). Layout recomputes after drop, not while the pointer is moving. On-card drop always becomes a child; sibling before/after is only offered in the vertical gap between cards.
- Idle cards are structure-draggable without a prior select click; double-click still enters edit. Structure-drag audio is a single `drag_start` (no per-hover sounds).

## Large-map navigation

- Branch collapse is canvas-local (not persisted on the document). Nodes with children show a fold control; collapsed cards keep a descendant count badge.
- Maps with >= 36 nodes auto-collapse branches at depth >= 1 on open (root + first level stay expanded). Practice/review (practiceModeActive) forces fully expanded.
- Toolbar: refresh, fit whole tree, fit current branch, expand selected subtree, expand all, collapse deep. Double-click a node fold control expands that whole subtree. Min zoom is 0.12; onlyRenderVisibleElements for medium/large graphs.
- Intentionally not in this canvas: MiniMap, search jump, outline dual-pane (hosts may compose those separately).
