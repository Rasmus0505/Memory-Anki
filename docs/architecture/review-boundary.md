# Review Context Boundary

The review context owns scheduling, queue selection, progress, and review submission. Palace owns palace editing and palace-specific read projections.

## Dependency Direction

```text
reviews.application -> mindmap_document.api
reviews.presentation -> palaces.api (response composition only)
palaces application/presentation -> reviews.api
```

`reviews.application` must not import the palace context. Generic mind-map traversal belongs to the pure `mindmap_document` context. Palace response composition remains in presentation and crosses the context through `palaces.api`.

## Read Invariants

- Review queue and count queries never commit or repair palace state.
- Archived and soft-deleted palaces are excluded explicitly.
- Compatibility repair such as legacy unarchive operations must run as an explicit maintenance command, never inside GET/query paths.

The remaining `palaces -> reviews` dependency is explicit and restricted to the public `reviews.api` facade. Future slices may replace read-heavy calls with precomputed projections, but private review application modules are not cross-context APIs.

## Legacy review audit ownership

Legacy `ReviewSchedule`, stage-adjustment audit rows, and Ebbinghaus configuration remain persisted only for migration inspection. They are not repaired during startup, exposed through normal runtime APIs, or rebuilt by formal completion. Any future migration tooling must be an explicit offline/maintenance command and must not be reachable from the review UI.

## Review mutation commands

Formal node ratings and completion use stable operation or mutation identities. A rating operation validates its `StudySession`, palace, frozen node scope, rating, and operation ownership before returning an idempotent result. Cross-session or cross-palace reuse is rejected.

Formal completion uses one database transaction to create `ReviewLog`, finalize the UUID `StudySession`, clear reveal progress, save the completion receipt, and persist the mutation response. It never creates or updates a legacy stage schedule. The receipt remains readable by review-log id after refresh.

Frontend review completion emits the typed `reviewStateChanged` application event only after the atomic command succeeds. Review queue and Palace catalog caches invalidate immediately; Knowledge may consume the returned FSRS projection and refetch its chapter detail without importing private Review implementation modules.

## Frontend review-flow composition

`widgets/mindmap-review-flow` owns the cross-feature flip-card session surface that combines Review use cases, Palace learning, quiz launching, and mind-map editing. Its public `FlipCardMindMapPanel` is the only host allowed to configure flip-card synchronization, viewport preservation, keyboard/touch progression, fullscreen, and clear-UI behavior. Palace learning and formal Review provide separate progress data and callbacks; formal Review alone adds rating evidence and review completion. `features/review` does not import Palace or Mind-map Editor; reusable state transforms remain under `entities/review`.
## Retired stage correction

Manual stage adjustment, stage reset, stage-health repair, and overdue spreading are retired runtime capabilities. Historical records are retained for migration audit only; no frontend component or public runtime route may invoke them.

## Node-level FSRS scheduling (2026 migration)

Reviews now owns an independent FSRS card for every non-root palace node, keyed by `palace_id + node_uid`. The root node is a batch-rating entry point and is excluded from progress and scheduling. The public Reviews facade exposes projection, four-level rating, subtree rating, undo, due-node listing, and completion-summary capabilities.

Ratings are `忘记 / 困难 / 记得 / 轻松` and map to FSRS Again / Hard / Good / Easy. Rating operations are idempotent, append immutable mind-map evidence, update all affected node states in one transaction, and retain before-state snapshots for session-local LIFO undo. Legacy stage schedules remain audit data only during migration.

Formal review, palace practice, and learning-group practice must use the same node-state key. A review session freezes its due-node scope on entry; ratings that create new due nodes are deferred to the next session.

## FSRS formal review runtime

Formal review runtime scheduling is exclusively derived from `ReviewNodeState.due_at`. Queue, overdue count, later-today grouping, and load forecasting must not read `ReviewSchedule`; that table and stage-adjustment history are migration audit data only.

Entering a formal review creates or resumes an active UUID `StudySession` and freezes the due-node UID scope. Formal subtree ratings intersect that scope. Nodes added later are deferred, deleted nodes drop out of completion counts, and unrated nodes remain unchanged and due.

Completion atomically creates a `ReviewLog`, finalizes the active `StudySession`, clears reveal progress, and stores a receipt containing rating counts, mastery, memory health, remaining due nodes, and the next FSRS due time. Completion must never rebuild legacy stage schedules or write `target_review_number` / `needs_practice` progress controls.

The frontend may display the whole mind map for context, but formal completion UI uses only FSRS node evidence. User-facing stage selectors, stage progress bars, manual stage adjustment, and overdue date spreading are retired.
