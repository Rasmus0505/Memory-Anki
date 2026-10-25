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

`GET /api/v1/review/subject-ladder` is a read-only map of active units onto ten display bands of real interval days (`0, 1, 3, 7, 14, 30, 60, 120, 240, 365` lower bounds; the first band is 首学). It does not reconcile, write due dates, or invent a second scheduler. A palace is listed in every band where it already has an active unit; the shown review time is the earliest due date among those units. The shelf shows only the shape, and the subject palace list and progress page can scrub a band and open the existing palace review or a one-round freestyle lock for exactly those palaces. The band is a grouping of FSRS intervals, never a scheduling position.

The mind-map toolbar strip (`GET /api/v1/review/palaces/{id}/ladder-progress`) shows a
**due-date distribution** — 今天 / 3天内 / 本周 / 本月 / 更远 — plus the current unit's booked
gap ("间隔 7天", or "今天到期"). It is not a ladder position: `stage_histogram` stays in the
payload for compatibility, but the strip no longer draws it. A zero gap means the product booked
the unit today (first learning, a failed grade, or a retry), not that it has no history.

The review scheduling and encounter API remains owned by `memory` and is consumed by
freestyle cards. The frontend review UI lives in `apps/web/src/modules/practice/ui/freestyle`.
The palace shelf opens `/palaces/<id>/review`, which reuses that UI for one palace and keeps a
separate round from `/freestyle`. Content and mix settings stay. `/freestyle-2` is only a redirect
to `/freestyle`; the retired standalone `/review` page, session page, completion page, and
feedback-preview route must not return.

Reviews must not import Practice. Practice must not create a second schedule, copy unit progress, or reinterpret permanent marks. Editing must not block on schedule arrangement.

## Topology Invariants

- A palace with no permanent mark has no review units and is excluded from formal, Today, and freestyle review queues.
- Water flows from the root through unmarked nodes. A permanent mark starts an isolated downstream unit; a deeper mark cuts another unit from it.
- Nodes outside marked regions form one residual root-flow unit.
- Marking the root means the whole palace is one unit until deeper marks cut regions from it.
- Isolation units still partition every non-root node: each belongs to exactly one palace, mark, or residual unit.
- Each permanent mark is its own unit, and no node is reviewed under two units. Sibling marks never share a unit: under A with marked B1 and B2 and unmarked B3, the units are A→B1 with its subtree, A→B2 with its subtree, and the residual A→B3 with its subtree.
- Unit order is depth-first: each marked child's isolation unit comes before that child's own walk. The root isolation unit stays first when the root itself is marked. The residual unit stays last. `unit_order: structured` keeps that order inside the palace — the due date never moves a unit ahead of an earlier chapter — and `random` shuffles it. 新学优先 still hoists never-passed units above review units; the structure order holds inside each of those two groups.
- A new or resized unit inherits the earliest due date among units whose current membership overlaps it, including itself, and with it the legacy projection that names that interval. It does not start a separate scheduling rule. Its FSRS card is seeded from that inherited position on the first rating, so a mature region never falls back to a one-day interval. Content edits preserve each containing unit's due date and FSRS state; only a real rating changes its memory assessment.
- The retired `cohort` kind (migration 0071) is deactivated, not deleted, and its earned progress does not transfer. Each remaining unit keeps only its own due date and FSRS state.
- Progress carries over any permanent-mark change; a mark edit never restarts a unit at first-learning. Inheritance candidates include inactive rows, because deleting the final mark only deactivates unit rows and leaves their earned due date and FSRS state stored. A region with no live owner (every mark removed, then re-added) reactivates its original row, keeping unit id and rating history; a region still covered by active units mints a fresh row and inherits by node overlap.
- Identity for inheritance is membership, not `(anchor_uid, unit_kind)`: moving a mark one level down is the same studied region under a new anchor, and the learner's earned interval follows the content.
- Retired rows stop speaking for a live region. Once any active unit overlaps the same members, inactive rows are excluded from the inheritance vote, so a superseded unit holding a stale earlier date cannot drag its successor down.
- Mark edits do not move a due date. An inherited unit keeps its original due date and FSRS position; re-marking after a long gap makes the card due immediately rather than silently rebooking it.
- Freestyle 「更新队列」 replans the open round from the latest due projection after marks, content, or due dates change. Already-rated cards stay, unrated cards are added or dropped, and the card under the viewport stays when it still exists. It does not adopt the other computer's scores or mint a new `round_id`; that other-computer adopt remains 「同步进度」. A palace-editor visit is remembered even if the learner passes through the shelf before returning. The return update runs only after that editor's leave reconcile settles, and it does not run while the current card is still being edited.
- Permanent mark / membership changes reconcile at an edit-session boundary, not on every content save. Freestyle inline edit uses one same-document `editor_leave` after the edited card becomes inactive or unmounts; it never reconciles or rebuilds the queue while that card remains active. Other editor hosts may still use finished-mark, idle, or explicit return boundaries. Unchanged membership keeps its plan; split units inherit source progress; merges use the earliest due date among candidates.
- Deleting the final mark deactivates every unit without deleting earned progress. Re-adding marks inherits retained membership progress; first learning applies only where no prior region or ancestor progress can be inherited.
- New content inherits its nearest ancestor's isolation branch progress, walking upward if necessary; visual proximity and layout order never choose its schedule. New marks/splits inherit their original region. Merges take the earliest candidate due date from a frozen pre-reconcile snapshot so iteration order cannot change the result.

## Content Save vs Schedule Reconcile

- Content autosave may persist `editor_doc` without reconciling schedule — including mid-pass permanent-mark toggles. Document save and schedule arrangement are separate write paths; the editor must not wait on unit due/interval updates between continuous mark clicks.
- Complete freestyle edit actions save immediately through one serialized, latest-wins request chain; there is no debounce. Freestyle sends reconcile only through same-document `editor_leave` after the active card leaves the editing session. Other hosts may run one batch on finished mark pass (`mark_change`), idle, return-to-review, or explicit `reconcile_units`. A boundary save must still run when the document was already autosaved (same-doc short-circuit). Keep-alive navigation is leave.
- Content-only edits update affected unit content/revision at leave / idle / explicit reconcile without changing due date, memory state, or learned history. A content update is not a learning failure.
- Freestyle return-to-review is local-first: the card adopts the local document and switches to review before HTTP, without a reconcile request. Save failures stay non-blocking in review with local content and an explicit retry. A stale 409 refreshes the revision token once and retries the local document automatically.
- Reconcile returns unit-level before/after changes (identity, membership, revision, due date and its interval projection). Content changes report `content_updated` and create no schedule-demotion batch.
- Manual schedule adjust and undo of historical content-demote batches remain Reviews write commands. Content must not invent a parallel schedule-write API.

## Scheduling Invariants

### The due set is one whole

- A study day's due set is never batched. Every active unit in scope with `due_date <= 学习日`
  enters the queue and the round plan together: `list_trusted_due_units_for_queue` filters by date
  only, `build_freestyle_queue` returns the whole remaining list, and no step holds cards back to
  release them later in the day. There is no daily review quota, no backlog release, and no
  per-round slice; a "first 8 cards" `study_window` is a first-paint prefix of the same order, not
  an admission rule, and the HUD denominator already counts the whole set.
- A due card can be absent only because this round records it as handled (completed, compressed,
  excluded, or permanently removed). A card that becomes due again on a later study day is reopened
  by the day-advance rebuild (`_reopen_due_again`), matched by unit identity — not card id. A round
  that has become fully handled freezes until the next round (closing settlement), so a unit that
  falls due later the same day waits for that round: a round-end rule, not a batching rule.
- Ordering (新学优先, 按知识结构) decides position, never admission. 新学优先 is a fixed product
  rule, re-confirmed on 2026-10-23: every never-passed unit in scope comes before every due review,
  and `sanitize_feed_config` ignores any stored `new_placement` instead of honouring it. Do not
  "balance" the two pools; the HUD and the round plan still hold both. New learning is a separate
  pool: 「今日新学已完成」 fires when the round has no unpassed new unit left and never gates due
  reviews.

- FSRS is the scheduler. Each unit owns one card in `review_unit_states`
  (`fsrs_stability`, `fsrs_difficulty`, `fsrs_state`, `fsrs_step`, `fsrs_due_at`,
  `fsrs_last_review`, and the `fsrs_scheduler_version` that wrote them). A pass
  books the interval FSRS computes for that card at a 90% target retention
  (`desired_retention=0.9`), capped at 365 days, plus the product's stable
  per-unit 5% spread. A never-reviewed card starts empty and is due immediately.
- `stage_index` is a compatibility projection of the real interval
  (`stage_for_interval` = nearest lower legacy bound of
  `0, 1, 3, 7, 14, 30, 60, 120, 240, 365`). It is written for old clients and
  stored snapshots; nothing schedules from it. The UI shows each unit's real
  interval ("约 43 天后") and groups units into day-range bands, never levels.
- FSRS' own learning steps stay empty (`LEARNING_STEPS = ()`): the product's
  same-day ladder (`unit_intraday.py`) owns sub-day spacing, so the library's
  minute steps would only disagree with it. The ladder is wall-clock, not a card
  count, so a short session cannot re-serve a card immediately and a long one
  cannot leave it for hours.
- `记得` (Good) and `轻松` (Easy) pass the unit. `忘记` (Again) and `困难`
  (Hard) are retry work: FSRS records the evidence, while the product keeps the
  unit due today and waits 10 minutes, then 1 hour, then 3 hours ("today's
  last"). A unit gets at most three retries; the next failure books tomorrow.
  Only `记得` and `轻松` pass.
- A first-ever pass books one short re-check (15 minutes) instead of tomorrow;
  the re-check passing graduates the unit to the next study day. A mature pass
  books the FSRS interval (at least one day). An ahead-of-date filler pass
  records without moving either.
- A waiting unit is still due today but is not servable: the queue and the
  palace batch exclude it (`intraday_due_at > now`), and the round plan keeps
  its occurrence `pending` with `available_at`. Serving publishes it once the
  wait has passed; the round payload reports `waiting` (count + earliest ready
  time) so a round is never reported finished while work is owed. Manual
  early rating is allowed and counts; only the queue is time-gated.
- `困难` still lowers the display band at most once per study day
  (`ReviewUnitState.hard_penalized_on`), and a repeated same-day `困难` is not fed
  to FSRS at all: retry taps are not new evidence. Never-passed units stay in
  first learning.
- A unit reviewed ahead of its booked due date (freestyle fill cards) records a
  passing grade without moving the schedule; that pass is not fed to FSRS, so a
  filler review cannot inflate a later interval. `忘记` is still recorded and
  still retries today, because a lapse is honest evidence. Preview and commit
  share this `schedule_locked` rule.
- One encounter has one effective rating. Before leaving, another rating
  atomically replaces it from the frozen pre-encounter baseline — which includes
  the FSRS payload — so the replaced choice has no scheduling effect. A
  pre-switch snapshot without an FSRS payload clears the columns and lets the
  replay rebuild the card instead of leaving the undone operation's state behind.
- A `困难` or `忘记` encounter needs no separate carry-over: FSRS already has that
  failure on the card, so the later `记得` or `轻松` simply rates the penalized
  card, and the old "recover only one level" rule is exactly what its stability
  and difficulty now express.
- Rating requires `study_session_id`, `unit_id`, `unit_revision`, `encounter_id`, stable `operation_id`, and `rating`. The operation is idempotent and supports LIFO single-step undo while the encounter remains open.
- Freestyle may rate a palace's remaining due units in one Reviews command (`rate_palace_due_units`). That command still writes one unit rating per member. It is not a palace-level schedule, not a node rating, and not the retired subtree/bulk-fill path. Already-rated units in the current round are left alone unless they are the open current encounter (which may amend). Sibling units close at zero observed seconds. Undo of the current open encounter undoes the whole batch.
- Due dates are local study-day dates. A study day starts at 03:00 local time (`MEMORY_ANKI_DAY_START_HOUR`, default `3`), not midnight, so work done at 00:30 still belongs to the evening that just ended. Presentation converts a study day to its 03:00 local boundary only at API boundaries.
- Sprint mode bounds the booked date without touching the memory state:
  `rate_unit(horizon=...)` calls `SprintHorizon.schedule(interval, seed=<unit id>)`, which books a
  fitting gap unchanged, pulls an overshooting one into the last week before the exam (spread per
  unit), and books normally when no room is left. The horizon is resolved once per request and
  cached on `session.info`, so a preview and the commit it precedes can never disagree. The booked
  date is what the UI shows ("约 N 天后") — a shortened sprint interval is the real booking, not a
  hidden override. Failed grades still retry today. A locked ahead-of-date card keeps its booked
  date; only `clamp_due_dates_for_sprint` moves it.
- Content and mark editing do not independently penalize scheduling. Existing content keeps its
  due date and FSRS state; splits, new content and merges follow the topology inheritance rules
  above.

### Scheduler ownership and migration

- `unit_fsrs_adapter.py` is the only module in `modules/memory` allowed to import `fsrs`, and
  `unit_scheduler.rate_unit` is the production entry point that wraps it. `tools/check_architecture.py`
  enforces both, and also rejects any import of the retired shadow recorder. `modules/english`'
  `fsrs_runtime` owns its own scheduler and settings; the unit settings
  (`desired_retention=0.9`, `maximum_interval=365`, fuzzing off) stay local to the adapter so the two
  contexts cannot silently share limits.
- FSRS' own fuzzing is off because it uses the process-wide `random` module and would make a preview
  and its commit disagree. The adapter applies a deterministic blake2b spread keyed on the unit id
  instead, from 7 days up.
- The switch is a one-time replay, not a fresh start: migration `0077` only adds nullable columns,
  and `backfill_fsrs_scheduler` replays every active unit's effective rating ledger
  (`undone_at IS NULL`, `replaced_at IS NULL`) through the production adapter, writing the card and
  the recomputed due date. A `Config(key="review_fsrs_backfill")` marker records the scheduler
  version; a crash leaves it unset and the next startup resumes. The first write takes a rescue
  backup (`pre-fsrs-switch`). Units with no rating history are left untouched — they keep their
  stored due date and have no FSRS checkpoint, which the adapter seeds from the legacy projection on
  their first rating.
- Undo and amend stay exact after the switch: each rating snapshot stores the FSRS payload, and when
  a snapshot or ledger window has no FSRS state the adapter seeds from the recorded legacy position
  rather than pretending the unit is new. An inherited or pre-switch row with no FSRS checkpoint is
  seeded the same way, so a mature unit never collapses to a one-day interval.
- The shadow ledgers (`review_unit_fsrs_shadow_states` / `_ratings`, migration `0076`) are retired
  and no longer written. Nothing reads them; they are kept only as an audit trail of the comparison
  that justified the switch, and `python tools/review_fsrs_shadow.py` remains a read-only report over
  the real history. Dropping both tables changes no learner-visible schedule.

## Session Invariants

- A formal session freezes all due units for one palace, including member UIDs and revisions.
- Rating never auto-opens nodes, scrolls the map, or switches the current unit.
  Freestyle `auto_advance` is opt-in and may advance only after a passing `记得` / `轻松`
  once card id, encounter id, and plan version still match; `忘记` / `困难` never auto-advance.
  Practice persists the authoritative round plan (retry occurrences, cursor, completion) in
  SQLite; Reviews still owns the schedule. A successful freestyle rating updates that plan in the
  same practice use case (`round_id`, `encounter_id`, `operation_id`) so a later queue rebuild
  cannot drop the retry. Reviews must not import Practice.
- Leaving a card closes its encounter and locks the effective rating. Re-rendering or restoring the page resumes the same open encounter instead of opening another session.
- Encounter duration is client-observed foreground activity: only the current open card, on the
  live-study control lease holder, while the document is visible and the window is focused,
  accrues seconds. Browser background, blur, suspension, lock-screen, card leave, controller
  change, and wall-clock gaps are never inferred from `closed_at - created_at` and are never
  backfilled; close persists the last confirmed foreground interval as `effective_seconds` and
  session completion sums those values. If the client reports more seconds than the encounter
  wall span, close clamps to that span — it does not 400. The rating is already committed;
  failing leave would trap the learner on the card. Card switches close the old encounter
  before opening the new one.
- A session completes only after every frozen unit passes.
- Quiz cards and standalone Anki cards never mutate palace unit scheduling.

## Retired Runtime

Node ratings, subtree/bulk fill ratings, node undo, the retired FSRS previews, the fixed-ten-step ladder, the write-only FSRS shadow recorder, waves, calibration, daily plans, temporary marks, stability/health settlement, and review-log receipts are deleted. The shadow tables themselves stay as an audit trail but nothing writes or reads them. Migration `0049_permanent_mark_review_units` creates a complete SQLite backup before replacing their tables. Migration `0050_review_unit_encounters` adds stable per-appearance identity and backfills legacy unit operations as closed encounters. Migration `0054_encounter_effective_seconds` stores observed foreground duration on each encounter; legacy null values fail closed at zero rather than reconstructing wall-clock time. Migration `0077_review_unit_fsrs` adds the per-unit FSRS columns; the replay that fills them runs once at startup and takes its own rescue backup.
