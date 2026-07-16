# Mind-map Canvas

Generic React Flow renderer.

- Owns layout, viewport, drag/drop, node measurement, and generic visual rendering.
- Receives `GraphData` and `MindMapNodeVisual`; it does not know palace, review, segment, or mastery semantics.
- Must not import entities or features.
- Structure drag preview is **target chrome only** (ghost source + drop placeholders). Layout recomputes after drop, not while the pointer is moving. On-card drop always becomes a child; sibling before/after is only offered in the vertical gap between cards.
- Idle cards are structure-draggable without a prior select click; double-click still enters edit. Structure-drag audio is a single `drag_start` (no per-hover sounds).
