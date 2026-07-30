# Review Unit Boundary

Reviews owns the only scheduling state for palace mind maps. The scheduling atom is a permanent-mark isolation unit, never an individual node.

## Ownership

```text
mindmap_document -> projects editor documents and permanent-mark topology
reviews projection -> reconciles unit identity, membership, revision, and due projections
reviews session    -> owns encounters, ratings, amendments, close locking, and undo
content          -> saves palace documents; may save editor_doc without schedule reconcile
practice         -> consumes reviews.api unit projections and the shared rating command
```

Reviews must not import Practice. Practice must not create a second schedule, copy unit progress, or reinterpret permanent marks. Editing must not block on schedule arrangement.

## Topology Invariants

- A palace with no permanent mark has no review units and is excluded from formal, Today, and freestyle review queues.
- Water flows from the root through unmarked nodes. A permanent mark starts an isolated downstream unit; a deeper mark cuts another unit from it.
- Nodes outside marked regions form one residual root-flow unit.
- Marking the root means the whole palace is one unit until deeper marks cut regions from it.
- Every non-root node belongs to exactly one active unit.
- Permanent mark / membership changes reconcile when the mark pass finishes (exit permanent-mark mode), on editor leave/idle, or on return-to-review — not on every mid-pass toggle autosave. Unchanged membership keeps its plan; split units inherit source progress; merges use the lowest level and earliest due date.
- Deleting the final mark deactivates every unit. A later first mark starts a new schedule.

## Content Save vs Schedule Reconcile

- Content autosave may persist `editor_doc` without reconciling schedule — including mid-pass permanent-mark toggles. Document save and schedule arrangement are separate write paths; the editor must not wait on unit due/level updates between continuous mark clicks.
- Permanent mark / membership reconcile runs on finished mark pass (`mark_change`), leave, idle, return-to-review, or explicit `reconcile_units` — one batch for the whole pass.
- Content-only edits that demote affected units may batch demotion to leave / idle / explicit reconcile. At most one content demotion is applied per edit session for a unit, even across many interim autosaves. Due/projection paths still heal lagging unit hashes if a session dies mid-edit.
- Reconcile returns unit-level before/after changes (identity, membership, revision, due, ladder level). Content demotions create an undoable schedule batch while keeping document content as saved.
- Manual schedule adjust and undo of a content-demote batch are Reviews write commands. Content must not invent a parallel schedule-write API.

## Scheduling Invariants

- The only interval ladder is `0 (initial learning), 1, 3, 7, 14, 30, 60, 120, 240, 365` local calendar days. A unit that has never passed occupies the initial-learning stage; its first `记得` always schedules the one-day stage for tomorrow.
- `记得` advances one level and `轻松` advances two. `困难` moves back one and `忘记` resets to the initial-learning stage.
- Only `记得` and `轻松` pass the current encounter. `困难` and `忘记` remain immediately due and return after at most three other units.
- One encounter has one effective rating. Before leaving, another rating atomically replaces it from the frozen pre-encounter baseline; the replaced choice has no scheduling effect.
- Closing a `困难` or `忘记` encounter preserves its penalty in the next encounter. A later `记得` settles at that penalized level; a later `轻松` recovers only one level.
- Rating requires `study_session_id`, `unit_id`, `unit_revision`, `encounter_id`, stable `operation_id`, and `rating`. The operation is idempotent and supports LIFO single-step undo while the encounter remains open.
- Due dates are local natural-day dates; presentation converts them to local midnight only at API boundaries.
- A content change, once reconciled, makes only the affected unit immediately due and lowers it one fixed-ladder level (batched per edit session as above).

## Session Invariants

- A formal session freezes all due units for one palace, including member UIDs and revisions.
- Rating never auto-opens nodes, scrolls the map, or switches the current unit.
- Leaving a card closes its encounter and locks the effective rating. Re-rendering or restoring the page resumes the same open encounter instead of opening another session.
- Encounter duration is client-observed foreground activity: only the current open card while the document is visible accrues seconds. Browser background, suspension, lock-screen, and wall-clock gaps are never inferred from `closed_at - created_at`; close persists the stable encounter's observed `effective_seconds` and session completion sums those values.
- A session completes only after every frozen unit passes.
- Quiz cards and standalone Anki cards never mutate palace unit scheduling.

## Retired Runtime

Node ratings, subtree/bulk fill ratings, node undo, FSRS previews, waves, calibration, daily plans, temporary marks, stability/health settlement, and review-log receipts are deleted. Migration `0049_permanent_mark_review_units` creates a complete SQLite backup before replacing their tables. Migration `0050_review_unit_encounters` adds stable per-appearance identity and backfills legacy unit operations as closed encounters. Migration `0054_encounter_effective_seconds` stores observed foreground duration on each encounter; legacy null values fail closed at zero rather than reconstructing wall-clock time.
