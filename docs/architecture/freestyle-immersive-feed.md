# Freestyle Immersive Feed Boundary

## Product surface

- Primary nav first item: **随心** → `/freestyle`
- Legacy `/freestyle/session` redirects to `/freestyle`
- Default PWA entry remains `/freestyle`

## Ownership

| Concern | Owner |
|---|---|
| Feed config, skip/refresh/merge rules | `apps/web/src/modules/practice` (`public.ts`) |
| Immersive page composition | `features/freestyle` + thin `pages/today/ImmersiveFreestylePage` |
| Branch split / queue ordering | `modules/practice/domain` (backend pure functions) |
| Queue HTTP build | `modules/practice/application/queue_service.py` |
| Tree structure | `palaces.api` |
| Due / FSRS projection & writes | `reviews.api` / Reviews module |
| Published questions, bindings, mastery | `palace_quiz.api` |
| Mind-map flip/rating UI | `widgets/mindmap-review-flow` |

## Invariants

1. Freestyle application code must not import other modules' private application packages; only `.api` facades.
2. Browse-only (rating mode off) must not write FSRS or mark due nodes reviewed.
3. Quiz attempts stay on the unified attempt evidence path; they are not mapped to mind-map FSRS ratings.
4. Queue rebuild is seed-deterministic and preserves completed / skip / hidden state. Settings expose **换一批乱序** (bumps `seed`) rather than a raw seed number; same seed + config + data yields the same order.
4b. Multi-select `progress_scopes` (default `overdue` + `due` + `reinforcement` + `new`; **not** `calendar_today`): freestyle mind-map units only include nodes whose mutually exclusive progress bucket is selected. Buckets: **overdue** (formal, has memory, local due day before today), **due** (formal, has memory, clock-due on local today), **calendar_today** (formal, due later today on local calendar — former `include_calendar_today_due` opt-in), **reinforcement** (same-day weak-rating restudy already available), **new** (never reviewed / first-learn). Content-changed nodes stay out. `include_calendar_today_due` remains a derived mirror for older clients. Orthogonal to `due_policy` (quiz fill after due mind-maps). Does not change formal overview / Insights due counts.
5. Clients ignore queue responses whose `operation_id` is not the latest request identity.
6. Queue length is finite (`queue_length`, default 20); not an infinite feed.
6b. Feed config (`freestyle_feed_config`) is a backend client preference so PWA and desktop share the same settings via the USB app-home DB. Local `memory-anki.freestyle.feed-config.v1` is only a migration fallback.
6c. 「下个宫殿」moves remaining cards of the current palace to the **tail** and records `deferredPalaceIds`. Rebuilds re-apply that order so the deferred palace cannot jump back to the front after other cards complete.
7. Mind-map flip cards are **complete subtree units** sized near `node_limit` (never truncated siblings). Every **non-root** node appears in exactly one unit's `ratable_node_uids`. When best-fit drills past a parent, that parent is **folded into the first descendant unit's ratable set** (not a size-1 residual card). Context path is ancestors above the highest folded / unit root node; those ancestors are display-only and do not count toward `node_count`.
8. The freestyle mind-map card UI **clips** `editor_doc` to the queue unit via `clipEditorStateToBranchUnit` (synthetic context root + unit subtree). Folded ancestors appear as a single-child spine above the unit root, not as sibling branches of the full palace. Flip/due/rating scope still uses `ratable_node_uids` / unit `due_node_uids`.
8b. Freestyle and formal palace review both use `autoRevealNonDueCards={false}` so flip is classic **hidden → 待回忆 → content** for every node (including non-due). Unit/formal freeze only **soft-dims** non-due cards; rating mode can still score them (FSRS writes). Settlement one-tap bulk rate stays frozen/out-of-scope-due only. Header `N 节点 · M 到期` remains intentional for freestyle units.
9. Freestyle mind-map cards are **formal FSRS review only**. Queue builders never emit mind-map units with zero due nodes (no practice/fill mind-map sessions). Units start formal review with explicit `scope_node_uids` (unit due intersection) and must not resume or expand into a mismatched full-palace formal freeze. If due goes stale between build and open, the card is **dropped + silent rebuild without writing `completedIds`** — never practice, never permanently hide a still-due unit for the day.
10. Formal freestyle completion uses the same FSRS settlement path as palace review: load completion summary → dialog (bulk-rate unrated if needed) → submit only when every frozen due node is rated. Compact chrome also offers **quick settle** (four ratings left of 完成): bulk-rate still-unrated frozen due → submit without the dialog. Direct `submit` while unrated is rejected by the API (409). **Only successful settlement with no remaining weak ratings** (and quiz resolve) writes `completedIds`. When the pass still has 忘记/困难 (`pending_reinforcement` or rating counts), the unit is **not** marked completed (round cannot end until 记得/轻松); the client silent-rebuilds and **stays on that unit** (`preferCardId`). After the learner leaves the unit (swipe / 下一题 / skip), re-insert it with **at most 3 intervening cards** (`placeRestudyCardWithMaxGap` / `RESTUDY_MAX_INTERVENING=3`) — e.g. after 1 is weak, feed may show 2→3→4 then 1 again; if only 2 remains, place after 2. Never reorder under the viewport. After any graduated or restudy settle, show a short **next-review bubble** (absolute time + interval detail; not “本支完成”) that auto-dismisses; do not auto-advance. After a graduated complete, the client **silently rebuilds** and **keeps the finished card under the viewport only if the user is still on it** (`preferCardId` via `resolveRebuildIndex` + `mergeQueuePreservingHistory`). History merge **preserves previous local order** (completed units stay at their finish index; new due cards append) — never prepend completed cards to the front (that desynced scrollTop and looked like auto-flip). If the user already swiped away before the rebuild resolves, follow their card — never yank back. Never auto-advance after rating or complete; swipe / keyboard / 下一题 are user-driven. Finger/wheel scroll updates `currentIndex` only and must not trigger a second `scrollTo`. Quiz answers likewise stay on the card with analysis; no timed auto-advance.
11. Default `due_policy` is `due_only` (quiz fill strategy only). Expand policies may still interleave quizzes; mind-map emission remains gated by `progress_scopes`.
12. **Insights「今日复习」≠ 随心 empty state.** Insights is palace-level formal due; freestyle is branch-unit cards filtered by local `completedIds` / `hiddenIds` / `mutedPalaceIds`. 「再来一轮」(reshuffle) clears completed/hidden/skip for a new round (keeps muted) so still-due units can reappear.

## API

`POST /api/v1/freestyle/queue/build`

Request: full config, `operation_id`, `completed_ids`, `hidden_ids`  
Response: echo `operation_id`, sanitized config, lightweight cards, phase stats, counts.

## Frontend module exports

Consumers must import freestyle domain/persistence helpers only from `@/modules/practice/public`.
