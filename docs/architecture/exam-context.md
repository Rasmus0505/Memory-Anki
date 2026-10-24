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

## Sprint mode (exam horizon)

`exam_settings.sprint_mode` is a switch; `exam_settings.exam_date` is the horizon. The policy is
pure and shared in `core/exam_horizon.py` (`resolve_sprint_horizon`, `SprintHorizon.schedule`), so
exam owns the config and memory owns the scheduling.

The horizon does exactly one thing: **it never books a review after `exam_date - 1`.**

- A gap that already fits the window is booked exactly as the ladder says. The ladder still owns
  the cadence; the horizon only bounds it.
- A gap that would overshoot is pulled into the last week before the exam, spread deterministically
  by unit id (`SprintHorizon.schedule(..., seed=<unit id>)`), so a mature cohort does not all land
  on the eve of the exam.
- When no room is left (reviewed within days of the exam), the unit keeps its normal interval and
  books after it. It was just reviewed; crushing it back onto today would re-serve the same card
  every day at the end.
- Inert on and after exam day.
- `clamp_due_dates_for_sprint` (a memory command, called from the practice queue build) pulls units
  already booked past the exam into that same last week. Exam never writes a due date.

A ratio-of-horizon ceiling (`10-20%` of remaining days, from Cepeda et al.) was tried first and
rejected: recomputed daily it collapses toward "review everything every day" in the final weeks,
roughly doubles the card count (39/day vs 21/day on real data) and synchronises every unit onto one
cadence. Measured on the 2026-10-23 plan (286 units, exam 12-20): switch off 1 039 reviews /
17.9 per day; switch on 1 236 / 21.3 per day, with the final fortnight going from a trickle to
~50 a day. The landing stage, the nominal interval, and the toolbar histogram never change.

## Milestones

`config` key `study_milestones` holds a JSON list of plan checkpoints
(`date`, `title`, `category`, `detail`, `notify_days_before`, `enabled`, `done`).
`DEFAULT_MILESTONES` seeds the 2027 考研 sprint plan once, on first read; every field is editable.
Milestones never move a due date and never gate review — they answer "what was supposed to be
finished by now". Status is derived per read: `done` / `overdue` / `due_soon` (within
`notify_days_before`) / `upcoming`.

Reminders are in-app only. There is no push channel: the service worker only has a
`notificationclick` handler, so nothing can reach a closed app.

Two surfaces, deliberately different:

- **进度 page** (`MilestonePanel`) — the full editable list. Status per row:
  `done` / `overdue` (red, stays until ticked or re-dated; never auto-shifted,
  because the plan says checkpoints do not move) / `due_soon` / `upcoming`.
- **Start overview** (`GET /freestyle/overview` → `milestones`, read-only, never
  seeds) — a glance only: the **nearest two milestone days**, each carrying *every*
  item on that day. Dated checkpoints cluster (10/31 holds both 中教史 and 马原),
  so "next milestone" would hide the sibling; and two days is the whole point of a
  glance. The exam countdown already comes from `ExamCountdownChip`, so the strip
  holds no countdown of its own.

Routes: `GET|PUT /api/v1/exam/milestones`; the response also carries `sprint` (active, `days_left`,
`max_interval_days`, `last_due`) so the progress page needs one call. UI:
`modules/exam/ui/MilestonePanel.tsx`, mounted on `LearningProgressPage` (进度).
