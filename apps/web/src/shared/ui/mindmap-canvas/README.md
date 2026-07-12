# Mind-map Canvas

Generic React Flow renderer.

- Owns layout, viewport, drag/drop, node measurement, and generic visual rendering.
- Receives `GraphData` and `MindMapNodeVisual`; it does not know palace, review, segment, or mastery semantics.
- Must not import entities or features.
