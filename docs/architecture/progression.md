# Progression (growth meta layer)

Backend context `progression` and frontend module `modules/progression` turn recorded study evidence into XP, levels, quests and stamps. It is a **read-only projection**: no tables, no writes, deterministic across devices and retroactive for history. The `/growth` page (starmap, stamp book, wardrobe) is removed; exact `/growth` redirects to `/dashboard`. Freestyle still shows the level chip and round-end settlement.

## Backend

`GET /api/v1/progression/overview` → `modules/progression/application/overview_service.py`.

- Evidence: effective `review_unit_rating_operations` (not undone/replaced, joined to encounters for `round_id`), `quiz_attempt_events`, `study_sessions.effective_seconds` (not deleted). Days/hours are local wall clock.
- Star multipliers still come from `exam.api.build_memory_snapshot` (registered dependency `progression → exam`). The overview payload still includes that snapshot; no screen renders it.
- Domain (`domain/`, framework-free):
  - `rules.py` — XP per rating `{1:4, 2:8, 3:12, 4:14}` × star multiplier `{1:1, 2:1.25, 3:1.6}`; 攻克 (last rating 忘记 → now ≥ 记得) +15 once per unit per day; first pass +8; quiz correct 8 / tried 3; 1 XP per focused minute, capped at 120 per session; same card/question on the same day decays 1 → 0.5 → 0.25 → 0.1. Level curve `150 × (L−1)^1.9`.
  - `quests.py` — 3 daily + 1 weekly quest picked by a sha256 hash of the date (no two on one metric). Daily +30, weekly +150, credited the day they complete. Unfinished quests expire; nothing accumulates.
  - `stamps.py` — stamps over counters that only grow (ratings, study days, 攻克, 3-star passes, quiz, perfect rounds, night/dawn/marathon days, quests, level), so a stamp never un-earns. `unlocked_on` is the day the counter crossed its target.
- Never: XP loss, consecutive-streak rules, leaderboards.

## Frontend

| Piece | Role |
|---|---|
| `domain/ceremony.ts` | `planCeremony(state, overview, 'settle' \| 'live')`. First load baselines silently. `settle` (round end) plays XP → level-up → up to 3 stamp ceremonies; `live` (mid-round) only corner stamps for new stamps and finished quests. |
| `domain/growthState.ts` + `model/growthStateStore.ts` | `growth_state` client preference (backend whitelist): worn `pack`, `unboxed`, `seenLevel/seenXp`, `celebrated`, `toasted` (legacy `skin` migrates). Written **before** cues fire, so the other device never replays a ceremony. |
| `domain/cosmetics.ts` | Theme pack unlock ladder (manifests live in `shared/theme/packs`): 纸墨书房 Lv1 / 金箔宫殿 Lv5 / 星河夜航 Lv12 / 森林萤火 stamp `days_30`. A locked saved pack falls back to 纸墨书房; `packsAwaitingUnbox` feeds the round-end unboxing. |
| `ui/GrowthHudChip.tsx` | Freestyle top bar: level ring + daily quest count. Display only; it does not open a page. |
| `ui/GrowthRoundSettlement.tsx` | Round-end block beside the exam summary; sequences cues after the meteor shower. Newly unboxed packs can still be worn here. |
| `model/useGrowthCosmetics.ts` | Wears the saved pack app-wide: `applyThemePack` (tokens, paper, motes, rhythm, card dress) + `setFxSkin` (called from `app/shell`). |
