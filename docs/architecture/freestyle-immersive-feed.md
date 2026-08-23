# Freestyle Immersive Feed

Freestyle is a consumer of public learning projections. It does not own palace review scheduling.
`FreestyleFeedConfig` is the single queue configuration owner for the immersive page; the
older `FreestyleConfig` settings path is compatibility-only and must not drive queue builds.

## Review Entry

The palace shelf and all review-oriented frontend actions enter the same immersive workspace.
`/freestyle?palaceId=<id>` applies a transient single-palace scope for that round, keeps the stored
content/mix/queue settings, and does not create a separate formal page session before the queue loads.
Refreshing that URL keeps the same palace scope. There is no standalone `/review` frontend route or
completion screen; unknown retired `/review...` paths fall back to `/freestyle`.

## Round Plan State

Each local freestyle round has a stable `roundId` and a persisted round plan owned by the
practice domain. The plan records card IDs, palace grouping, order, rating/retry state,
completion and current-round exclusions. Queue responses also expose `candidate_count`,
`scheduled_count`, `queue_limit`, and `limit_reached`; the page renders these separately so
`5/5` cannot be mistaken for a configured limit of five.

The plan reducer is the only place that reconciles rebuilds and manual ordering. Rebuilds keep
completed, excluded, retry, and stale entries visible in the plan; a card that returns after a
stale rebuild is reset to pending. Exclude/restore and drag operations affect only this round,
never the underlying review schedule. “Finish palace then next” is a gate over all planned
review-unit cards in the current palace: a failed/hard card remains retry work and cannot permit
the next palace to become active. The gate is **forward-only** — looking back at a previous
palace is never blocked. Retry placement inserts a copy after the learner leaves the source
card, at most three usable intervening cards later; the source card stays in place so swipe-back
is geometric. Finger/wheel paging commits `active` only after scroll settle so a mid-gesture
index change cannot close one encounter and open another. The review map stays
pannable (`mobileViewPolicy` defaults to `auto`); 上一张 / 下一张 on the pager
change cards. Palace skip stays desktop-only.

When every review-unit card of a palace in this round is handled (retries included; skip /
exclude do not count), the current card shows a chapter banner. Copy is `《宫殿》今日安排已清`
when that palace has no leftover due units outside the round, otherwise
`《宫殿》本轮已清，今日还剩 N`. Queue `round_meta.palace_leftover_due` is the leftover due
count per palace. The banner is not a snap page. Audio uses `all_clear_ready` on the review
scene, locally — never `dispatchGlobalFeedback`.

The top HUD opens a bottom “本轮安排” sheet. It groups stable plan entries by palace and supports
jump, drag (desktop) or up/down (touch), batch exclude/restore, and reset-round. Configuration is a
separate dialog. Saving a config preserves finished/excluded records and only reorders unstarted
work. An unfinished round survives local midnight; the page says it is yesterday's work until the
learner starts a new round. Configuration and round state remain client-local per device.

## Training Directions and Three Streams

The user-facing configuration starts with one training direction: `memory_palace`, `quiz`,
`english`, or `mixed`. The first three directions activate exactly one queue stream. Mixed mode
selects at least two of the three streams and keeps each stream's configuration while the user
switches modes; a selection that falls to one stream is normalized back to that single direction.

`streams.memory_palace` builds marked palace review-unit cards. Its scope can be all or non-English
palaces, with an optional explicit palace list, `due_first_then_expand`, `due_only`, or
`all_content_due_weighted` selection, palace completion/interleaving order, and structured/random
unit order. `streams.english` has the same review-unit semantics but is constrained to English
subject palaces. English mode does not currently mean vocabulary or reading content; it is the
English-palace review stream.

`streams.quiz` builds question cards independently from palace review scheduling. It filters by
subject, explicit palace scope, question type, mastery buckets, cross-palace/single-palace order,
and weak-question priority. The mixed combiner then merges the available stream results with a
stable seed using `ratio`, global `random`, or `sequential` strategy. Ratio mode uses the three
stream weights in `mix.ratios`; sequential mode completes one selected stream before moving to
the next. The combiner de-duplicates by stable card ID after all streams are built, so overlapping
explicit scopes cannot show the same card twice. Candidate shortage is reported as the actual
scheduled count: the queue never repeats cards or silently broadens a filter.

The v1 local configuration remains readable only for migration. `quiz_only` becomes `quiz`, a
palace-only configuration becomes `memory_palace`, an English-palace preset becomes `english`,
and palace-plus-question content becomes `mixed`. Legacy Anki front/back fields remain in source
data and compatibility projections but are excluded from the new freestyle streams and queue.
When a configuration is saved, the round plan preserves completed, excluded, and retry entries;
only unstarted entries are rebuilt against the new streams.

## Palace Review Cards

- Palace cards are built only from active due review units returned by Reviews.
- Card identity carries stable `unit_id` and `unit_revision`; a permanent-mark change or a reconciled content demotion invalidates the old card.
- The card displays the full palace for context while the frozen Reviews unit membership defines the rating scope.
- Freestyle starts a one-unit `freestyle_unit_review` session and uses the same rating and undo commands as formal review.
- The rating bar can switch between **section** (`unit`) and **palace** scope. Section is the default and the stored preference. Palace scope calls `rate_palace_due_units`: every still-due unit of the current palace today, plus every still-unrated review-unit card of that palace already in this round (fill cards are `schedule_locked`). Units already rated in this round are not overwritten. Each unit keeps its own ladder; leftover due units that were not in the round are rated without inserting feed copies. Undo of the still-open card undoes the whole batch. Quiz cards never take this path. In palace scope, 上一张 / 下一张 jump to the previous / next palace and skip already-rated sections; section scope keeps card-by-card paging.
- `忘记` (and first-learning `困难`) insert a retry copy after the learner leaves, at most three
  cards later, with no per-round cap. The just-rated source card does not move.
  `记得` / `轻松`, and `困难` on an already-passed unit, finish the current encounter.
- `due_first_then_expand` and `all_content_due_weighted` mark fill cards explicitly; their freestyle
  session start carries `allow_not_due` so the shared review service does not reject a configured
  non-due card. Formal review calls keep the default due-only guard. A fill / not-yet-due pass is
  `schedule_locked`: the review is recorded, the due date does not move. The card shows a 「补充」 badge
  and the rating buttons say 「不改期」.
- The HUD progress line is `位置/原安排 · 重练 +N`. Retry insertions lengthen the amber rail but do
  not change the planned denominator. Mixed and quiz-only rounds become complete when every card is
  rated or acknowledged; the closing card counts sources once.
- Queue rebuilds exclude palaces without permanent marks.
- Stale encounter or `unit_revision` mismatch is rebuildable: drop/rebuild the card or open a fresh encounter from the current Reviews projection. Practice freestyle must not hard-fail the feed on schedule/revision drift after concurrent edits.

## Permanent Marks

Permanent marks are edited in the palace document. While the user is still in permanent-mark mode, toggles only update `editor_doc` (plain autosave) so many marks can be changed continuously without rebuilding freestyle. Schedule reconcile runs when the mark pass finishes (exit permanent-mark mode / `mark_change`), when returning to review, or on editor leave/idle. Content-only autosaves never reconcile schedule. When reconcile runs, freestyle queue rebuild is deferred until the card leaves inline edit (`return_to_review` / leave) so continuous mark editing is not interrupted mid-pass.

Typing autosaves are quiet and debounced (2s idle) so a return-to-review flush after a same-doc autosave is the only save the user waits on — and even that is optimistic: clicking 返回学习 switches to review immediately, saves in the background, and adopts the saved doc when it settles. A failed save returns to edit mode with local content intact. If the user re-enters edit before the return save settles, the freestyle queue rebuild is deferred again until the next leave.

Temporary marks do not exist. Practice must not persist, merge, clear, or schedule any alternative mark lifecycle.

## Other Cards

Quiz, English Reading, and other standalone learning surfaces retain their own evidence. Their
completion must not change a palace review unit. Anki front/back data remains in its palace as
source content, but is no longer emitted by the freestyle streams or mixed queue.

Practice receives topology only through `memory.public.get_palace_unit_projection`. It must not import the mind-map split function, apply node-count limits, or derive due state from member nodes.

## Flow Feedback and the Challenge–Skill Channel

Freestyle feedback follows the feedback论 in 《心流》 rather than reward mechanics. The
rules are enforced in `model/freestyleFlowFeedback.ts` and `model/freestyleChallengeChannel.ts`,
both framework-free and unit-tested.

- Every learner action gets an immediate answer. Reveal (flip) and unit rating were both
  silent; reveal now sounds on the `review` scene — the same one formal review has always
  used per reveal — and a rate adds one breath at the edge of its own card.
- Reveal is counted off the whole `revealMap` in `FreestyleUnitReviewFlipPanel`, not off
  the unit-scoped header progress. The default flip mode is `free`, where every palace node
  is flippable, so a unit-scoped count would leave most flips silent.
- Feedback stays peripheral. Nothing is drawn at screen center: `dispatchGlobalFeedback`
  is deliberately not used for rating, because its burst lands mid-map and is gated only by
  the global sound/animation switches, so it would still fire under the `focus` preset.
  Freestyle feedback respects `scenes.review` and the `learningSounds` channel.
- A weak rating is information, never a loss. `忘记`/`困难` never use
  `quiz_result_incorrect`; they use a neutral acknowledgement and a slate breath. There is
  no streak that can break, and freestyle adds no combo counter, milestone, or confetti of
  its own — quiz cards keep their existing shared-path feedback and are not double-signalled.
- Reveal audio is rate-limited (90ms) so fast flipping stays information rather than texture.
  A rate is never rate-limited.

The challenge–skill channel reads the last `CHANNEL_WINDOW` distinct rated cards and
reports `anxious` / `flow` / `bored` / `unknown`. A hint appears only at the two exits,
never to confirm flow, and only when a correction exists; it is dismissible with a
cooldown so a declined suggestion cannot return as an interruption.

**In-feed corrections must never change palace scope.** A `specific_palace_ids` /
`subject_scope` change makes `setConfigAndPersist` call `startNewRound`, clearing
completedIds, encounters and the round plan — it would destroy the round the correction is
meant to rescue. Corrections move `due_policy`, quiz mastery buckets and weak-priority
only, and rebuild with `silent` + `preferCardId` so finished work and the learner's
position survive. `freestylePalaceScopeUnchanged` guards this and is asserted directly.

## Quiz pool config (feed settings)

Immersive queue config (`FreestyleFeedConfig` / `sanitize_feed_config`) owns quiz membership and draw order separately from palace due policy:

| Field | Role |
|---|---|
| `quiz_mastery_buckets` | Multi-select mastery buckets that may enter the quiz stream: `unseen` / `weak` / `reinforce` / `stable`. Default omits `stable`. |
| `quiz_scope` | `cross_palace_random` shuffles all in-pool quizzes across palaces; `single_palace_random` finishes one palace's quiz pool before the next. |
| `mix_mode` + `mix_ratio` | Palace-side vs quiz interleave (e.g. 2:1). |
| `bound_quiz_placement` | Default `into_mix` so node-bound quizzes count toward `mix_ratio`. `follow_unit` re-attaches after the owning branch and weakens ratio predictability. |
| `due_policy` | Gates **mind-map unit** fill only. Quiz entry is not controlled by due_policy. |
| `weak_quiz_priority` | Sort within the already-scoped quiz pool; does not decide membership. |

Settings UI groups quiz controls under a dedicated「题目刷题」section in the round-plan dialog.
