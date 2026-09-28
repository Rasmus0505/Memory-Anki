# exam context

Read-only exam layer: star weights, countdown, forgetting estimate, war room.

## Ownership

- Backend `apps/api/src/memory_anki/modules/exam` (public entry `memory_anki.modules.exam.api`).
- Frontend `apps/web/src/modules/exam` (public entry `src/modules/exam/public.ts`), page `pages/exam/ExamWarRoomPage.tsx` at `/exam`.
- Data: `chapters.exam_stars/_source`, `palaces.exam_stars/_source`, `subjects.exam_share` (migration `0064`), exam settings in `config` key `exam_settings`.

## Star resolution (first hit wins)

1. Palace `exam_stars` (manual on the shelf/war room, or written by local AI with source `ai`).
2. Nearest chapter up the palace's primary-chapter chain with `exam_stars`.
3. Derived: `score = question_count + 2 × subjective_count` (`short_answer` = subjective); `≥12` → 3, `≥5` → 2, else 1.

## Forgetting estimate

`R(t) = 0.9 ^ (t / S)`, `S` = ladder interval of the unit's stage, `t` = days since last pass; unlearned units recall 0.
It never changes scheduling. The fixed ladder in `memory/application/unit_scheduler.py` stays the only scheduler.

## Consumers

- `practice` queue: `palace_order = exam_priority` pre-sorts palaces by `star_weight × (0.35 + forgetting) × share_factor`, then walks them sequentially; every card gets `exam_stars`.
- Freestyle feed: star corner badge, 3-star gold frame, countdown chip, round-end exam summary.
- Shelf (`PalaceShelfPage`), dashboard blocks (`ExamCountdownBlock` / `ExamTodayBlock` / `ExamRecentBlock` / `ExamWeakBlock` placed individually by `InsightsPage`), war room (knowledge map, retention curve, star distribution, weak list, recall drill).

## Rules (enforced by `check_exam_context_boundaries`)

- `exam/domain` imports no framework, infrastructure, or other module.
- No exam file writes `due_date`, `stage_index`, `has_passed`, or `last_passed_at`.
- Star edits are keyed by entity id; the UI drops stale responses per entity.
