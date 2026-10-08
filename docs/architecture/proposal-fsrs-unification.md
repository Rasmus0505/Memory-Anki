# Proposal: unify the two schedulers onto FSRS

Status: **proposal only — no code changed.** Prepared 2026-10-07 from a
dependency-reuse audit (`docs/architecture/dependency-reuse-audit.md`).

---

## 1. The problem in one paragraph

The app has four rating buttons (忘记 / 困难 / 记得 / 轻松). Pressing them feeds
**two different scheduling algorithms** depending on which part of the app you are
in: English study cards use FSRS, while the 宫殿 review units — the core flow —
use a hand-written fixed ladder in `unit_scheduler.py`. Both define the same four
ratings with a copy-pasted dict. The ladder cannot adapt: a unit's next interval
is always a lookup into a constant table `(0, 1, 3, 7, 14, 30, 60, 120, 240, 365)`,
so it can never learn that you forget particular nodes faster than average. FSRS
can, and the optimizer that fits it to your history is already declared in
`requirements-optimizer.txt`.

## 2. Current state, measured (not estimated)

Read directly from the live database at `F:\memory anki data\学习数据\memory_palace.db`:

| Fact | Value |
| --- | --- |
| Active review units | **288** |
| Total units (incl. inactive) | 483 |
| Units that have ever passed | 185 |
| Recorded rating operations | **1,129** |
| Palaces | 124 |

Stage distribution of active units (i.e. how far up the ladder progress sits):

```
stage 0 -> 127    stage 4 ->  19
stage 1 ->  11    stage 5 ->  86
stage 2 ->  30    stage 6 ->  11
stage 3 ->   3    stage 7 ->   1
```

Rating distribution across the 1,129 operations — this is the training signal:

```
忘记 (1) ->  13
困难 (2) -> 367
记得 (3) -> 676
轻松 (4) ->  73
```

Two things follow from this:

- **The optimizer is genuinely usable.** 1,129 operations with all four ratings
  represented is enough history to fit FSRS parameters. This is not a theoretical
  benefit.
- **86 units sit at stage 5 (30-day interval) and 127 at stage 0.** A migration
  that guesses wrong would visibly reschedule a large share of the collection, so
  the conversion must be computed per unit and reviewed before it is applied —
  not applied as a flag flip.

## 3. Why this is worth doing

- **Adaptation.** FSRS schedules to a target retention (default 0.9) per card,
  using that card's own review history. The ladder gives every unit at stage 5 the
  same 30 days regardless of whether you have forgotten it three times.
- **One algorithm, one set of semantics.** Today a fix to scheduling behaviour has
  to be reasoned about twice, and the duplicated `RATING_LABELS` shows the two
  copies have already started to drift structurally.
- **Less code to own.** `unit_scheduler.py` is 207 lines of scheduling math plus a
  `stage_from_legacy_interval_days` migration helper, all of which FSRS plus a thin
  adapter replaces.
- **Reversibility.** `ReviewUnitRatingOperation` already stores
  `before_state_json` / `after_state_json` per rating, so a conversion can be
  audited and undone from existing data rather than needing a new ledger.

## 4. What must NOT be lost

This is the part that makes the change non-trivial. `unit_scheduler.py` encodes
**product decisions, not scheduling math**, and each has a comment explaining a
real bug it prevents:

| Rule | Why it exists |
| --- | --- |
| `MIN_PASSED_STAGE = 1` — a pass must land ≥1 day out | Crediting a pass at stage 0 left the unit due *today*, so the next queue build re-served it: it looked "done" yet never left the queue. |
| `schedule_locked` / `schedule_changed=False` — reviewing ahead of due date records the review but does not advance the ladder | Filler cards are served when the due set is short. Without this, intervals climbed on zero forgetting evidence: the more diligently the queue was cleared, the more filler appeared and the faster it drifted. |
| 困难 (2) is retry work, keeping the unit due today | It must behave the same for due cards and ahead-of-date filler. |
| 忘记 (1) keeps `LAPSE_RETENTION = 0.5` of earned position | Forgetting a 365-day unit should cost months, not the entire ~475-day climb back. |
| Deterministic fuzz (`blake2b` of `fuzz_key:stage`) | Same-day cohorts otherwise come due together forever. It is deterministic so a rating *preview* and the committed due date can never disagree. |

FSRS provides its own fuzzing and its own lapse handling, so these become
**deliberate divergences to preserve on top of FSRS**, not things FSRS replaces.
The `schedule_locked` rule in particular is a product contract the UI reads
(`schedule_changed` is surfaced to the user); it has no FSRS equivalent and must
keep working.

## 5. Proposed shape (strangler fig, not a rewrite)

Keep `unit_scheduler.rate_unit(...)` exactly as it is today — a pure function
returning `UnitScheduleResult`. Every caller, test and UI contract keeps working.
Change only its *internals* to delegate to FSRS behind an adapter.

```
unit_scheduler.rate_unit()            <- signature unchanged (the port)
        |
        +-- product rules (MIN_PASSED_STAGE, schedule_locked, retry contract)
        |
        +-- fsrs adapter  <- new; reuses fsrs_runtime settings/parsing
```

Reuse, not duplicate: `fsrs_runtime.py` already contains the `Scheduler`
construction, step parsing (`10m`/`1h`/`1d`) and settings loading. The adapter
must build on it rather than adding a second FSRS integration — that is precisely
the duplication this proposal exists to remove.

### Per-unit state

`ReviewUnitState` currently stores `stage_index`, `has_passed`, `due_date`,
`last_passed_at`. FSRS needs stability/difficulty/due/state per card. Two options:

- **A. Add FSRS columns** (`fsrs_stability`, `fsrs_difficulty`, `fsrs_state`,
  `fsrs_step`, `scheduler_version`) to `review_unit_states`, mirroring the English
  tables which already do this (`fsrs_state`, `fsrs_step`,
  `scheduler_version="fsrs-6.3.1"`). Cleanest, consistent with existing precedent.
- **B. Derive FSRS state from `stage_index`** on first rating. Less schema change,
  but lossy: stage is a coarse bucket, so early schedules would be arbitrary.

**Recommend A**, because the repo already uses exactly this column set for English
cards and the precedent should be matched rather than reinvented a third way.

### Migration

1. Add columns (additive, nullable — safe).
2. Backfill by replaying each unit's real rating history from
   `review_unit_rating_operations` in `created_at` order through FSRS. This is
   much better than seeding from `stage_index`, because the true history exists.
   Units with no history (127 at stage 0, never passed) simply start new.
3. Record a `review_unit_schedule_batches` row (the table already exists for
   content-reconcile demotions, with `entries_json` and `undone_at`) so the whole
   conversion is auditable and reversible.
4. **Dry-run first and show the due-date deltas** before applying. With 288 active
   units, a systematic shift (e.g. everything becoming due immediately) must be
   caught on paper, not discovered during study.

### Rollout

Ship behind a setting, compare on real data, then make FSRS the default and keep
the ladder as a pinned fallback until the comparison is clean. Do not delete
`unit_scheduler`'s ladder in the same change that introduces the adapter.

## 6. Risks

| Risk | Mitigation |
| --- | --- |
| Due dates shift for 288 active units | Per-unit replay + dry-run delta report + reversible batch row |
| Two schedulers diverging further mid-migration | Adapter is the *only* FSRS path for units; no second integration |
| FSRS is UTC-datetime based, this module uses `date` | Adapter owns the boundary conversion, with tests on a fixed clock (the repo already has a "deterministic due date" test culture) |
| Losing product rules in translation | The five rules in §4 each get a dedicated regression test *before* the adapter lands |
| Optimizer (torch/pandas) bloating the main install | Stays in `requirements-optimizer.txt`; the scheduler works with default parameters without it |

## 7. Effort

Medium, and mostly in tests rather than the adapter. Rough shape:

1. Pin the five product rules with tests against the *current* ladder (must pass
   before and after). — small, and valuable even if the rest is dropped
2. Write the FSRS adapter behind the existing signature. — small/medium
3. Schema columns + history-replay migration + dry-run report. — medium
4. Side-by-side comparison on real data, then default flip. — medium

## 8. Recommendation

Do steps 1–2 first. They are low-risk, improve test coverage immediately, and
prove the adapter is faithful without touching any user's due dates. Step 3 is
where your data is at stake, and it should only run once you have seen the
dry-run deltas and approved them.

If you would rather not take on scheduling changes at all right now, that is a
defensible choice: the lock fix already addresses the pain in the screenshot, and
this proposal is a product-quality improvement rather than a bug fix.
