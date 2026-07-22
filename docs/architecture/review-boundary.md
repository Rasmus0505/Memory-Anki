# Review Context Boundary

The review context owns scheduling, queue selection, progress, and review submission. Palace owns palace editing and palace-specific read projections.

## Dependency Direction

```text
reviews.application -> mindmap_document.api
reviews.presentation -> palaces.api (response composition only)
palaces application/presentation -> reviews.api
knowledge.application -> reviews.api (read-only FSRS projections on chapter palace cards)
```

`reviews.application` must not import the palace context. Generic mind-map traversal belongs to the pure `mindmap_document` context. Palace response composition remains in presentation and crosses the context through `palaces.api`. Knowledge may read public FSRS projections only.

## Read Invariants

- Review queue and count queries never commit or repair palace state.
- Archived and soft-deleted palaces are excluded explicitly.
- Compatibility repair such as legacy unarchive operations must run as an explicit maintenance command, never inside GET/query paths.

The remaining `palaces -> reviews` dependency is explicit and restricted to the public `reviews.api` facade. Future slices may replace read-heavy calls with precomputed projections, but private review application modules are not cross-context APIs.

## Legacy review tables retired

`ReviewSchedule`, stage-adjustment rows, and Ebbinghaus schedule configuration are dropped by migration `0039_unify_fsrs_drop_legacy_schedules`. Runtime code must not import or rebuild them. Old schedule history is discarded by product decision; formal review and vocabulary scheduling are FSRS-only.

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

Ratings are `忘记 / 困难 / 记得 / 轻松` and map to FSRS Again / Hard / Good / Easy. Rating operations are idempotent, append immutable mind-map evidence, update all affected node states in one transaction, and retain before-state snapshots for session-local LIFO undo. Formal completion re-anchors every non-undone session-rated node's schedule clock to session end (interval preserved) so mid-session 忘记/困难 short caps do not expire before “完成”.

**Interval policy after FSRS:** 忘记/困难 are *capped* at 10/30 minutes (same-day restudy). 记得/轻松 are *floored* at 1 day / 3 days so default learning/relearning steps (10m, 1h) cannot bounce a “记得” card back within the hour; Learning/Relearning cards are promoted to Review after Good/Easy. Formal session freeze also includes nodes that become due within a 1-hour look-ahead so near-due relearning cards enter the same frozen scope instead of remaining due after completion.

Formal review and vocabulary notes share the same FSRS runtime (`fsrs_runtime`). Manual `needs_practice` flags are retired.

Settlement distinguishes three sets:

- **Frozen unrated** (`unrated_due_node_count` / `unrated_node_uids`): still missing a score inside this session's frozen due scope. One-tap 「记得」 only fills this set.
- **Out-of-scope due** (`out_of_scope_due_node_count`): palace nodes that are due now but still outside the frozen scope **after** monotonic expand. This is an edge case (race / rare mid-window), not the normal path when the learner delayed review and more cards became due.
- **Palace remaining due** (`remaining_due_node_count` / `next_review_at`): whole-palace projection after ratings. Flip-card green lines only mean reveal progress, not FSRS advancement.

**Frozen scope is not permanently locked.** On resume, session payload load, rating scope checks, and completion summary, formal review **monotonically expands** `frozen_due_node_uids` to the union of the previous freeze and the whole-palace current due wave (already due + `FORMAL_ENTRY_NEAR_DUE_LOOKAHEAD`). Newly due cards join the same flip targets and the same bulk-rate path. Scope never shrinks. If a node-mode session gains dues under another top-level branch, entry chrome upgrades to palace mode.

API datetimes for review schedules and completion receipts are UTC with an explicit offset (`to_api_datetime`). Clients must not treat offset-less strings as local wall time.

Only one formal `active` review session may own a palace at a time; duplicate actives are superseded on resume.

Legacy stage → node FSRS migration may leave `state_source=legacy_estimate` cards with historical overdue clocks. Rating those cards once as Good can inflate stability into full mastery. Runtime `rate_nodes` normalizes legacy clocks before the first real FSRS write; one-shot data repair lives in `tools/repair_legacy_fsrs_inflation.py` (`legacy_fsrs_repair.repair_legacy_fsrs_inflation`).

Entry UX is derived from due-node top-level branch coverage (root is never FSRS-scheduled):
- exactly one top-level branch due **and** the tree has other top-level siblings → `review_entry_mode=node` / label `节点复习` (node CTA uses a non-green solid color)
- sole top-level branch due, or multiple top-level branches due → `review_entry_mode=palace` / label `开始复习` (green solid); scoring only the first-level children under root (root unscored by design) is palace review, not node review
- none due → `none`

Node counts are not embedded in CTA labels. Per-branch schedule detail for tooltips lives in `review_branch_summaries` (top-level branches only: title, due count, next review, status).

A formal session freezes its due-node UID scope on entry (whole palace or single branch). Completion progress and unrated-due counts still use that frozen set. Flip-card reveal uses the same frozen set as `focusNodeIds`: non-due cards auto-reveal on entry; only due cards stay as flip targets (subtrees under unrevealed due cards stay hidden until that due card is flipped). **Subtree ratings** write FSRS state for the full document descendants of the rated node (including non-due / unrevealed nodes). **Single** ratings in formal review still require the target node to be in the frozen scope.

Parent/root batch scoring must not depend on flip-card reveal state. Frontend rating scope walks the full `editor_doc` tree (`ratingTreeEditorState`), not the reveal-filtered visible tree.

## FSRS formal review runtime

Formal review runtime scheduling is exclusively derived from `ReviewNodeState.due_at`. Queue, overdue count, later-today grouping, and load forecasting read node projections only.

Queue/session lifecycle lives in `formal_review_service`; settlement (completion summary, bulk unrated / out-of-scope rating, complete, receipt lookup) lives in `formal_review_settlement`. Both stay under `reviews.application`.

Entering a formal review creates or resumes an active UUID `StudySession` and freezes the due-node UID scope. Resume / load / settlement **expand** that freeze with cards that became due since entry (see above). Nodes that are still not due after expand stay outside completion counts until they enter a later wave; deleted nodes drop out of completion counts; unrated frozen nodes remain due.

Completion atomically creates a `ReviewLog`, finalizes the active `StudySession`, clears reveal progress, and stores a receipt containing rating counts, mastery, memory health, remaining due nodes, and the next FSRS due time.

**Session schedule finalization:** Mid-session node ratings still write FSRS state (S/D, evidence, undo snapshots) for progress UX, but completion re-anchors every non-undone session-rated node's `last_review_at` / `due_at` to the session end time while preserving the intended interval. Without this, 忘记/困难 caps (10/30 minutes from the click) expire during a long session and the palace reappears as due immediately after “完成”.

Node-mode formal review still shows the full palace `editor_doc` as context. Only the frozen due-node set needs manual flip-card review; non-due cards auto-reveal via `focusNodeIds`. Entry mode/label/`primary_branch_*` remain for CTA and session chrome (e.g. “节点复习 · branch title”), not for document clipping. The full palace document is also used for subtree rating cascade and inline edit. Formal completion UI uses only FSRS node evidence on the frozen due set. Catalog CTAs prefer backend `review_entry_label` when due and show `review_branch_summaries` on hover.
