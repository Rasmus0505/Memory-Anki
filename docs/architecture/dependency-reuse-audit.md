# Dependency Reuse Audit (2026-10-07)

Scope: find where Memory Anki hand-rolls what a mature library, or a sibling
project, already does better — and, equally important, where the hand-rolled code
is deliberate and must NOT be replaced.

Method: measured source sizes per module, checked the actual dependency
manifests (`apps/api/pyproject.toml`, `apps/web/package.json`), and read the
suspect implementations. Web search was unavailable in this session
(`DEEPSEEK_API_KEY` missing), so library facts below are stated only where they
are stable, well-known API surface; every claim about *this* repo was verified by
reading the code.

## Headline finding

The project is **not** broadly reinventing wheels. Its dependency choices are
current and idiomatic for 2026: React 19, TanStack Query 5, Radix UI, Tailwind 4,
React Flow (xyflow) 12, TipTap 3, XState 5, FastAPI + SQLAlchemy 2 + Alembic,
Ruff + mypy + import-linter. Two of the largest "suspicious" areas are already
library-backed:

- **Mindmap canvas (~9,000 lines)** is not a hand-built canvas engine. The pan/zoom
  and node/edge runtime is `@xyflow/react`, and the code is the domain layer on
  top. The canvas files import only `@xyflow/react` symbols from outside the repo
  — no second geometry engine.
- **Article/rich text** uses TipTap, not a homemade contenteditable.

So the correct posture is surgical, not a rewrite. Below are the places that
genuinely duplicate existing work, ranked by value.

## 1. Domain scheduling: fixed ladder vs FSRS — the highest-value gap

`apps/api/src/memory_anki/modules/memory/application/unit_scheduler.py` (207
lines) implements a hand-written fixed-interval ladder:

```python
INTERVAL_DAYS = (0, 1, 3, 7, 14, 30, 60, 120, 240, 365)
LAPSE_RETENTION = 0.5
FUZZ_RATIO = 0.05
```

with `rating -> stage` arithmetic, a deterministic fuzz offset, and a
`stage_from_legacy_interval_days` migration helper.

This is a real, well-solved problem outside this repo. The
`open-spaced-repetition` project publishes **FSRS** (Free Spaced Repetition
Scheduler) with an official Python implementation, `fsrs` (PyPI, "py-fsrs",
MIT). Its API is deliberately close to what this module already models:

- `Rating.Again/Hard/Good/Easy` (= 1–4) — the same four grades the UI already
  sends (`RATING_LABELS = {1: 忘记, 2: 困难, 3: 记得, 4: 轻松}`).
- `Card` states Learning/Review/Relearning.
- `Scheduler.review_card(card, rating) -> (card, review_log)`.
- JSON serialization on `Scheduler`/`Card`/`ReviewLog`.
- `enable_fuzzing` — the same idea as this module's `FUZZ_RATIO`, but derived from
  the memory model rather than a flat ±5%.
- An optional `Optimizer` that fits the memory-model weights to the user's own
  `ReviewLog` history, plus `reschedule_card` to re-space existing cards.

Why this matters more than the other items: the current ladder cannot adapt. A
unit's next interval is a position on a constant table, so the schedule can never
learn that this user forgets specific nodes faster than average. FSRS predicts
retention per card and schedules to a target (default 0.9), and can be tuned from
the review history **the app already stores** (`ReviewUnitRatingOperation`,
`ReviewUnitState.revision`, encounter records). Anki itself ships FSRS as its
default scheduler, so this is the mainstream approach rather than an experiment.

**The dependency is already installed and already used elsewhere in this repo.**
`apps/api/requirements.txt` pins `fsrs==6.3.1`, and there is even an optional
`requirements-optimizer.txt` carrying `fsrs[optimizer]==6.3.1` (with the comment
that torch/pandas are too large for the main requirements). So the project has
already accepted FSRS as its scheduler and paid the dependency cost.

It is wired up for **English study cards only**
(`modules/english/application/fsrs_runtime.py`, which imports
`from fsrs import Scheduler`, plus `fsrs_state`/`fsrs_step`/`scheduler_version=
"fsrs-6.3.1"` columns on the English tables). The permanent-mark review units —
the core 宫殿 review flow, and the one in the screenshot — still run the separate
hand-written ladder in `unit_scheduler.py`.

That means the repo has **two different scheduling algorithms for the same four
ratings**, with a duplicated `RATING_LABELS = {1: 忘记, 2: 困难, 3: 记得, 4: 轻松}`
in both `unit_scheduler.py:12` and `fsrs_runtime.py:23`. This is the actual
finding: not "adopt a library", but "finish an adoption that is already half
done", and remove the divergence between the two.

Recommended shape: keep `unit_scheduler.py` as the **domain port** (the rest of
the codebase and the UI contract depend on `rate_unit`,
`scheduled_interval_days`, `stage_from_legacy_interval_days`), and implement it
with `fsrs` behind that port — reusing the settings/parsing already written in
`fsrs_runtime.py` rather than adding a second FSRS integration. The pure-function
signature makes this a strangler-fig replacement rather than a rewrite, and the
existing ladder can stay as a fallback pinned by tests.

An important caution: the two schedulers must not be swapped silently for users
mid-progress. The repo already ships a legacy-dates migration
(`test_realign_legacy_fsrs_due_dates_migration.py`), which shows the team has hit
exactly this class of problem before. Any switch needs the same treatment:
per-unit state migration, not a flag flip.

Caveat to weigh before committing: FSRS schedules in **UTC datetimes**, while this
module works in `date` and has explicit "a pass must land at least one day out"
and "schedule_locked for ahead-of-date filler" rules that encode product
decisions (see `MIN_PASSED_STAGE`, `schedule_locked`). Those rules are product
semantics, not scheduling math, and must be preserved on top of FSRS rather than
discarded. This is a medium-sized change touching the SRS core, so it wants its
own scoped task and its own regression tests — not a drive-by edit.

## 2. Graph layout: hand-written tree layout vs a layout library

`apps/web/src/shared/ui/mindmap-canvas/layout.ts` (1,018 lines) implements tree
measurement (`measureTree`), subtree bounds, overlap resolution
(`resolveOverlaps`, `hasNodeOverlaps`, `stackNodesWithoutOverlap`) and drop-target
hit geometry by hand. No layout dependency is present (`package.json` has no
dagre/elk/d3).

Two readings, and the honest answer is mixed:

- The **drop-target and preview geometry** (`resolveDropMode`,
  `resolveStructureDropMode`, `isWithinStructureDropLeaveZone`,
  `DROP_NEAR_THRESHOLD_PX`) is genuine product behaviour. No library provides it.
  Keep it.
- The **layered tree layout** is what `dagre`/`elkjs`/`d3-hierarchy` do as their
  entire purpose. Using one would remove a large class of bugs (overlap and
  subtree-height edge cases) for the cost of fitting the library's output to the
  card sizing this UI wants.

Note this file has uncommitted local changes from other work (a `getNodeSize`
memo). Per AGENTS.md that is shared work: do not revert it, and do not start a
layout rewrite on top of it without coordinating.

## 3. Small duplicated helpers (low risk)

Verified occurrences, with a correction after reading both implementations:

- **ID generation — done.** The identical `crypto.randomUUID()`-with-fallback body
  was copy-pasted in three modules (`shared/persistence/mutationQueue.ts`,
  `shared/logs/model/appLogs.ts`,
  `shared/debug/session-recorder/sessionRecorderStore.ts`). All three now call one
  `generateLocalId()` in `shared/lib/ids.ts`. No dependency was added: the
  fallback only covers a non-secure origin, and these ids are local correlation
  handles, never authorization tokens.
- **The two "equal" functions are NOT duplicates — do not merge them.** An earlier
  pass assumed `isDeeplyEqualPlain` (`mindmap-canvas/layout.ts`) and
  `shallowEqualNodeData` (`mindmap-canvas/mindMapCanvasDisplay.ts`) were the same
  helper written twice. They are not: one recurses into nested objects, the other
  compares only top-level keys by reference. Merging them would silently change
  edge-reuse behaviour. Left alone deliberately. If a shared equality helper is
  ever wanted, the two call sites need different functions, not one.

## 4. Where hand-rolling is CORRECT — do not "fix" these

Replacing these with a library would be a regression:

- **`shared/lib/dateTime.ts`** — not a generic date formatter. It encodes a
  specific backend contract (naive datetimes are UTC because the backend stores
  `utc_now_naive`; the comment records a real ~+8h bug this fixed). A date library
  would not know that rule. Keep.
- **`shared/persistence/mutationQueue.ts` (486 lines)** — an offline write queue
  with coalescing, a `Retry-After`-aware busy path, per-entity
  `resourceKey`/`coalesceKey`, and idempotent replay via a mutation id the server
  deduplicates. Generic offline libraries assume a sync protocol this app does
  not have (Syncthing moves files outside the app). This is legitimately custom.
- **`platform/events/bus.py` (41 lines)** — a synchronous in-process pub/sub, and
  its docstring says so. Pulling in a broker for this would be strictly worse.
- **`platform/jobs/registry.py`** — already self-documented as an unused
  scaffold with a clear instruction: delete it or implement it with a real
  consumer, and specifically **do not** add a scheduler plus DB-backed lease for
  three small loops in a single-process SQLite app. The prior author's reasoning
  is sound; follow the "delete or implement" instruction rather than adding a
  dependency.

## 5. Process observation

This repo already carries unusually strong architectural discipline — import-linter
contracts in `pyproject.toml`, a large `tools/check_architecture.py`, ADRs under
`docs/architecture/`, and mutation-id/`operation_id` conventions for asynchrony.
The main risk is therefore not missing dependencies; it is that the *domain*
layer (scheduling, layout) has grown large enough to deserve the same
"library-or-justify" scrutiny that the infrastructure layer already got.

## Recommended order

1. Finish and verify the in-flight storage-lock contention fix (already
   implemented in this session; see `storage-lock-contention.md`) — it is the
   user-visible pain and the prerequisite for the app feeling reliable.
2. Scoped task: replace the scheduling ladder with FSRS behind the existing
   `unit_scheduler` port, preserving the product rules and the legacy-interval
   migration. Highest long-term product value.
3. Consolidate the duplicated deep-equal and id generation helpers.
4. Evaluate a layout library for the tree positioning only, leaving drop-target
   geometry in place.
5. Resolve `platform/jobs/registry.py` per its own docstring (delete or
   implement).
