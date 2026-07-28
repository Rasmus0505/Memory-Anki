# Review Unit Boundary

Reviews owns the only scheduling state for palace mind maps. The scheduling atom is a permanent-mark isolation unit, never an individual node.

## Ownership

```text
mindmap_document -> projects editor documents and permanent-mark topology
reviews projection -> reconciles unit identity, membership, revision, and due projections
reviews session    -> owns encounters, ratings, amendments, close locking, and undo
content          -> saves palace documents and invokes reviews.api reconciliation
practice         -> consumes reviews.api unit projections and the shared rating command
```

Reviews must not import Practice. Practice must not create a second schedule, copy unit progress, or reinterpret permanent marks.

## Topology Invariants

- A palace with no permanent mark has no review units and is excluded from formal, Today, and freestyle review queues.
- Water flows from the root through unmarked nodes. A permanent mark starts an isolated downstream unit; a deeper mark cuts another unit from it.
- Nodes outside marked regions form one residual root-flow unit.
- Marking the root means the whole palace is one unit until deeper marks cut regions from it.
- Every non-root node belongs to exactly one active unit.
- Mark changes reconcile immediately. Unchanged membership keeps its plan; split units inherit source progress; merges use the lowest level and earliest due date.
- Deleting the final mark deactivates every unit. A later first mark starts a new schedule.

## Scheduling Invariants

- The only interval ladder is `1, 3, 7, 14, 30, 60, 120, 240, 365` local calendar days.
- `记得` advances one level and `轻松` advances two. `困难` moves back one and `忘记` resets to level zero.
- Only `记得` and `轻松` pass the current encounter. `困难` and `忘记` remain immediately due and return after at most three other units.
- One encounter has one effective rating. Before leaving, another rating atomically replaces it from the frozen pre-encounter baseline; the replaced choice has no scheduling effect.
- Closing a `困难` or `忘记` encounter preserves its penalty in the next encounter. A later `记得` settles at that penalized level; a later `轻松` recovers only one level.
- Rating requires `study_session_id`, `unit_id`, `unit_revision`, `encounter_id`, stable `operation_id`, and `rating`. The operation is idempotent and supports LIFO single-step undo while the encounter remains open.
- Due dates are local natural-day dates; presentation converts them to local midnight only at API boundaries.

## Session Invariants

- A formal session freezes all due units for one palace, including member UIDs and revisions.
- Rating never auto-opens nodes, scrolls the map, or switches the current unit.
- Leaving a card closes its encounter and locks the effective rating. Re-rendering or restoring the page resumes the same open encounter instead of opening another session.
- A session completes only after every frozen unit passes.
- Quiz cards and standalone Anki cards never mutate palace unit scheduling.

## Retired Runtime

Node ratings, subtree/bulk fill ratings, node undo, FSRS previews, waves, calibration, daily plans, temporary marks, stability/health settlement, and review-log receipts are deleted. Migration `0049_permanent_mark_review_units` creates a complete SQLite backup before replacing their tables. Migration `0050_review_unit_encounters` adds stable per-appearance identity and backfills legacy unit operations as closed encounters.
