# Freestyle Immersive Feed

Freestyle is a consumer of public learning projections. It does not own palace review scheduling.
`FreestyleFeedConfig` is the single queue configuration owner for the immersive page; the
older `FreestyleConfig` settings path is compatibility-only and must not drive queue builds.

## Review Entry

The palace shelf and all review-oriented frontend actions enter the same immersive workspace.
`/freestyle?palaceId=<id>` applies a transient single-palace scope for that round by locking every
training stream to that palace. A saved 随心 palace/subject selection does not keep showing the full
feed. Content/mix/queue settings stay, the lock is not written back to stored prefs, and there is no
separate formal page session before the queue loads. Refreshing that URL keeps the same palace scope. There is no standalone `/review` frontend route or
completion screen; unknown retired `/review...` paths fall back to `/freestyle`.

## Two immersive workspaces

Freestyle has two independent immersive routes: `/freestyle` (随心) and `/freestyle-2` (随心 2).
Each workspace keeps its own feed config, round cursor, and round plan. Overlap identity is
`unit:{unit_id}` / `quiz:{question_id}`. Complete, exclude, and retry progress is inherited
across workspaces for the same identity. Cursors stay independent. A fully handled round
freezes on `get_or_create` so the closing settlement slot stays reachable; leftover due
work advances only when the learner explicitly starts the next round via config confirm
(`「再来一轮」` → `/rounds/start`). Page refresh, app restart, and HUD queue refresh must
never mint a new `round_id`.

## Round Plan State

Practice owns the backend-authoritative round plan in SQLite (`freestyle_round_states`).
Each round has a stable `round_id`, a config snapshot, a palace-scope signature, and a
monotonic `plan_version`. The plan records original card order and card versions, the current
card, completion/exclusion, and retry `occurrence` rows (`occurrence_kind`, source card,
`retry_attempt`, insert target, status). Queue responses also expose `candidate_count`,
`scheduled_count`, `queue_limit`, and `limit_reached`. Palace due units are not truncated;
`queue_length` only caps quiz-only rounds.

The server plan is the only authority for retry order, current card, completion, and retry
counts. PWA, desktop, and a restart of the same device restore that plan. Browser `localStorage`
keeps display preferences and an offline draft only — it must not decide restudy order.
An unfinished round survives local midnight, a page refresh, a saved-config hydrate,
and device switches. A fully handled round keeps its `round_id` and presented order on
silent rebuilds and `get_or_create` — it must not mint or append brand-new due
identities that would flip the closing settlement slot off. The next `round_id` is
created only by `/rounds/start` after an explicit config confirm (`forceStart` from
settlement 「再来一轮」 / 开始下一轮). Refresh, restart, open-after-settlement, and
leftover-due detection must not call `/rounds/start`. Mid-round or post-settlement F5
keeps the same `round_id`, restores `completed_ids`, and resumes the local draft /
committed `current_card_id` (via `set_cursor` on settle) instead of jumping back to
the first card or minting a fresh queue.
A palace/subject scope change rebinds the same `round_id`: overlapping identities keep
completed / excluded / retry marks; only unstarted work outside the new scope is dropped.
Refresh must not mint a new `round_id` or drop completed cards from the HUD/feed. Completed source
cards stay in presented order so swipe-back / 上一张 can reopen them. Re-scoring a completed
unit in the same round amends from that round's original baseline; it does not stack SRS.
A rating write that arrives after the glance session was abandoned, completed, or cancelled
reopens that unit in the same round and applies the latest rating; it must not return
`active unit review session required`.
Swipe-back / 上一张 onto a completed (passed) unit must open an amend glance in the same
round. If the previous study session is still `active` with a passed item and no open
encounter, start finishes that session and opens a new one. It must not return
`passed review unit cannot start another encounter`. Freestyle unit load failures that
cannot be healed do not toast English API text; the card offers 重试 / 跳过这张 / 重建本轮 /
只看不评.
A later due-list rebuild with the same construction knobs (`append_today_cards`) keeps every
original card, including unstarted leftover work that dropped off today's due set, and appends
newly seen identities with `entered_on` equal to the local calendar day so retry copies cannot
clump into an orphan block of attempt-1 nodes. Saving feed config or
changing palace/subject scope (`replan_remaining`) keeps completed ticks, drops unstarted work
outside the new incoming set unless it still has a live retry, restamps remaining work as today,
and parks live retries after at most three cards of the new remaining queue (or immediately after
the completed prefix if fewer remain). A weak `忘记` / `困难` rating does not move `current_card_id`; the source stays
current until `leave_card`.

Optimistic concurrency: writes carry `expected_version` and `operation_id`. A stale device that
submits a lower version receives the latest plan with `conflict: true` and must not overwrite
newer progress. Repeated terminal writes with the same `operation_id` return the accepted
result.

The frontend reducer applies optimistic patches and hydrates from the server. Rebuilds keep
completed, excluded, retry, and stale entries visible in the plan; a card that returns after a
stale rebuild is rebound by stable `unit_id` to the latest `unit_revision` while ratings and
retry counts stay. If the current card is missing or already completed, the next unfinished
server-plan card becomes current. Exclude/restore and drag operations affect only this round,
never the underlying review schedule. `palace_order` only controls **queue construction**
(finish one palace’s cards before listing the next, or interleave). 上一张 / 下一张 / finger
paging never auto-rate and never block crossing a palace boundary; unrated units stay unfinished
so the learner can skip ahead and come back. Retry work still cannot mark a palace “cleared”.
The leftover `isSequentialPalaceBlocked` helper is not a navigation latch. Retry placement
usually inserts a copy after the learner leaves the source card, after exactly three other
already-presented cards in **the same leftover/today segment** (palace cards, quiz cards, and
other retry occurrences all count). If fewer than three remain in that segment, the occurrence
is appended to the **segment tail**. It must not borrow cards from the other segment to fill
the gap. Gap-0 (last card / nothing left after the source) inserts immediately after the weak
rating so 下一张 / 定位 / settlement cannot deadlock, still via the leave/insert path, without
auto-advancing off the source. A later due-list rebuild appends newly seen identities as the
today segment and must not move an already-inserted leftover retry. `leave_card` confirmation
pins the card now under the viewport and must not yank back to the source. The source card
stays in place so swipe-back is geometric. Looking back at history cards does not move the
committed cursor and does not insert retries. Finger/wheel paging
commits `active` only after scroll settle so a mid-gesture index change cannot close one
encounter and open another. The review map stays pannable (`mobileViewPolicy` defaults to
`auto`); one-finger drag on the canvas pans the tree and is not yielded to the snap
scroller. 上一张 / 下一张 on the pager always page cards, including while the rating
scope is 宫殿; they must not disable themselves when the round has only one
palace. Palace skip stays desktop-only.

When every review-unit card of a palace in this round is handled (retries included; skip /
exclude do not count), the current card shows a chapter banner. Copy is `《宫殿》今日安排已清`
when that palace has no leftover due units outside the round, otherwise
`《宫殿》本轮已清，今日还剩 N`. Queue `round_meta.palace_leftover_due` is the leftover due
count per palace. The banner is not a snap page; the whole chip dismisses on tap
(`点一下关闭`). Other top freestyle chips (yesterday unfinished round, channel-applied,
save error) likewise dismiss on whole-chip click. Audio uses `all_clear_ready` on the review
scene, locally — never `dispatchGlobalFeedback`.

The top HUD opens a bottom “本轮安排” sheet. It groups stable plan entries by palace and supports
jump, drag (desktop) or up/down (touch), batch exclude/restore, and reset-round. Configuration is a
separate dialog. Saving a config preserves finished/excluded records and only reorders unstarted
work. The HUD line is `当前位置/队列总长` (`position/total`): the denominator is the live
presented feed including retry insertions and excluding excluded cards. `scheduledBase`
remains available for plan math but is not the HUD denominator. The rail stays one bar: palace color
on each tick, leftover vs today split by a divider before the first source with
`entered_on == today`. A unit keeps one live retry at a time; a later weak rating
must not mint a second copy. Retry occurrences render as independent
amber circular nodes whose number is this-round `retry_attempt`. Unfinished retry nodes use a
faint amber fill; completed retry nodes use a solid amber fill. The card 重练 badge and
「本轮安排」 retry rows use the same unfinished vs finished chrome, not only the HUD rail.
`retryInserted` lengthens the
rail without changing that denominator. 「本轮安排」 uses the same two blocks and must not
drag a today card into leftover. Pending ticks use a faint palace-color fill and
completed ticks use a solid fill of the same palace color so unfinished vs finished stays
readable at a glance. Fill follows this-round last rating. Swipe-back onto a scored unit
opens an empty amend glance so the learner can change it, but the HUD tick and rating bar
keep the last rating until they change or cancel it. An empty amend glance is not unrated.
The viewing playhead is independent of that fill: the card on screen grows taller even after
it is rated, and cancelling a rating un-lights the fill without dropping the playhead. The
right-side pager has 完成, not 定位. When every presented card is handled it opens the
closing settlement slot; otherwise it seeks the earliest unfinished unit in round order
(same rules as round completion: unrated, or weak-rated while its retry is missing /
unfinished). It does not bulk-complete leftover work.

## Training Directions and Subject Chips

The user-facing configuration starts with one training direction: `memory_palace`, `quiz`, or
`mixed`. English is a **subject chip**, not a training stream. Mixed mode combines memory-palace
and quiz only; a selection that falls to one stream is normalized back to that single direction.

Subject chips sit directly under the training direction. Multi-select and 全选 write
`streams.*.subject_ids`. Empty `subject_ids` means all subjects (no subject filter). A non-empty
list is the union of palaces belonging to those subjects. Selecting only 英语 is the old English
palace mode; selecting 教育学+心理学 scopes both palace and quiz pools to those subjects.
`subject_scope` remains a compatibility field for stored prefs: `'english'` / `'non_english'` with
empty `subject_ids` still resolve by `Subject.name == "英语"`. When the UI writes `subject_ids`,
`subject_scope` is `'all'` because the ids are the source of truth.

`streams.memory_palace` builds marked palace review-unit cards. After the subject filter, the user
can still pick a palace/chapter subset (`specific_palace_ids`), plus `due_first_then_expand`,
`due_only`, or `all_content_due_weighted` selection, palace completion/interleaving order, and
structured/random unit order. `streams.english` is kept only as a sanitized compatibility
projection; queue builds for new configs do not activate a third English stream.

`streams.quiz` builds question cards independently from palace review scheduling. It uses the same
subject chips, then optional explicit palace scope, question type, mastery buckets,
cross-palace/single-palace order, and weak-question priority. The mixed combiner merges the two
stream results with a stable seed using `ratio`, global `random`, or `sequential` strategy.
Ratio mode uses the stream weights in `mix.ratios`; sequential mode completes one selected stream
before moving to the next. The combiner de-duplicates by stable card ID after all streams are
built, so overlapping explicit scopes cannot show the same card twice. Candidate shortage is
reported as the actual scheduled count: the queue never repeats cards or silently broadens a
filter.

Sanitize folds stored `training_mode: 'english'` into `memory_palace` with an English subject
filter, copies customized english-stream due/order fields onto memory_palace, and drops
`'english'` from `mixed_modes` (adding `memory_palace` if needed). Mixed palace+english becomes
one palace stream over all subjects. The v1 local configuration remains readable only for
migration. `quiz_only` becomes `quiz`, a palace-only configuration becomes `memory_palace`, and
palace-plus-question content becomes `mixed`. Legacy Anki front/back fields remain in source
data and compatibility projections but are excluded from the new freestyle streams and queue.
When a configuration is saved, the round plan preserves completed, excluded, and retry entries
for overlapping identities (`unit:{unit_id}` / `quiz:{question_id}`); only unstarted entries
are rebuilt against the new streams. The HUD progress rail is drawn from the round plan, not
from the live due subset, so a restart that omits already-rated cards from `/queue/build`
still shows those ticks. The queue-construction fields
(`palace_order`, `unit_order`, due policy, mix, seed, queue length, quiz draw order) are
compared on save: a change reorders unstarted work in the current round so 「多个宫殿轮流穿插」
and 「随机单元顺序」 take effect without minting a new round. A silent content rebuild with the same
construction settings must not reshuffle.

## Palace Review Cards

- Palace cards are built only from active due review units returned by Reviews.
- Card identity carries stable `unit_id` plus `unit_revision`. A permanent-mark membership change may drop a vanished unit. A content-only demotion rebinds the same parent unit in the current round; it does not mint a new unfinished card.
- The card displays the full palace for context while the frozen Reviews unit membership defines the rating scope.
- Freestyle starts a one-unit `freestyle_unit_review` session and uses the same rating and undo commands as formal review. Tapping the currently selected rating again undoes until the card is unrated; it must not post the same score. The transient 撤销 chip still undoes one step. Clearing the rating also uncompletes that card in the round plan so the HUD tick goes back to pending.
- The rating bar can switch between **section** (`unit`) and **palace** scope. Section is the default and the stored preference. Palace scope calls `rate_palace_due_units` for the current card plus still-due units that have already passed first review. First-learning siblings stay one-by-one and are not batch-scored, so 「记得」 cannot mark unseen sections as passed. Fill cards are `schedule_locked`. Units already rated in this round are not overwritten except the current card. Each mature unit keeps its own ladder. Undo of the still-open card undoes the whole batch. Quiz cards never take this path. In palace scope, 上一张 / 下一张 jump to the previous / next palace and skip already-rated sections; section scope keeps card-by-card paging.
- `忘记` and every `困难` create a retry occurrence. Insertion usually happens after the learner
  leaves the source card: the frontend inserts an optimistic copy first, then the backend
  confirms the plan via `leave_card`. The gap is exactly three already-presented cards in the
  source's leftover/today segment (palace, quiz, and other occurrences); if fewer remain in that
  segment, the copy appends at the segment tail and must not pull cards from the other
  segment. When the gap is 0 (no cards remain after the weak-rated source), the retry is
  inserted immediately after rating — still through the same leave/insert path — while the
  viewport stays on the source so pager / locate / settlement cannot deadlock on the last card.
  Confirmation pins the live viewport card, never the source just left.
  There is no per-round cap. A unit keeps one live retry at a time; the amber node
  number is this-round `retry_attempt` (第几次). Each new failed encounter increments
  that same slot. A later `记得` / `轻松` settles the source card and every unfinished
  occurrence together. The just-rated source card does not move. Only `记得` / `轻松` finish
  the current encounter; a mature-unit `困难` remains retry work just like first-learning `困难`.
  A retry occurrence has its own encounter. Silent rebuilds must not rebind that glance
  onto the source by `unit_id`; a passing rate leaves that occurrence in the viewport
  instead of deleting the card under the learner. Rating that glance keeps its encounter
  and reveal state — it must not remount the map at the root. Another `忘记` / `困难` on a retry
  increments the same occurrence and repositions it after leave — it must not mint a
  second copy.
  A rate is rejected unless `card_id + occurrence_id + encounter_id + unit_id` name one
  consistent card. A retry card without `occurrence_id`, an occurrence from another unit,
  or an encounter bound to another unit is a mismatch — last-write-wins never applies to
  the wrong identity. The rating bar and 1–4 shortcuts stay locked until scroll has
  settled on that card and its encounter is open. The tapped score is not filled until
  the server confirms; a failed POST stays unrated with a Chinese retry. A late response
  updates that card's ledger only and must not yank the viewport.
  Rating callbacks carry `card_id + occurrence_id + encounter_id + plan_version` and adopt the
  returned `plan_version` so the next rate is not a stale conflict. Silent
  rebuilds keep the current DOM card by id, never by the old index. Freestyle never
  auto-advances after a rating. Queue rebuilds freeze
  the current page so index churn cannot look like the next card.
- Freestyle palace streams are `due_only`. Expand/fill policies sanitize to due-only and do not
  emit fill cards. Formal review may still use `allow_not_due` for non-freestyle callers.
- The HUD progress line is `当前位置/队列总长`, including retry insertions. Mixed and quiz-only rounds become complete when every card is
  rated or acknowledged; the closing card counts sources once and shows settlement overview
  (passed / retry / quiz), **本次随心** total focus seconds (sum of closed+rated encounter
  `effective_seconds`), and a subject accordion (first subject expanded) with palace rows
  showing palace/card counts and focus time. Bottom CTA **再来一轮** opens config in
  `nextRound` mode; confirm calls `startFreestyleRoundApi` (never local `startNewRound`)
  and rebuilds a fresh queue. Mid-round 调整配置 stays on the HUD and still replans with
  progress preserved. 下一张 / swipe from the last handled unit opens that closing slot.
  The queue index stays on the last unit. Silent rebuild after the last 记得/简单 must not
  mint or append leftover due into the feed, or the closing slot disappears before the
  learner can open it.
- Queue rebuilds exclude palaces without permanent marks.
- Content edits bump `unit_revision` on the parent review unit. Freestyle adopts the live revision in place: the current card stays, remaining cards rebind by `unit_id`, and already-rated units keep this-round ratings. Starting a freestyle session with a stale revision opens a fresh encounter at the live revision instead of raising `review unit changed`. A newer revision must not appear as unfinished work in the same round; a new round with empty `completed_ids` may show the demoted unit. Stale recovery (skip / rebuild / open config) is only for a vanished unit, a non-fill card that is not due (reviewed elsewhere), or an encounter that belongs to another unit. Consecutive those drops still trip the circuit breaker (three in a row, or three within ~2s). Practice freestyle must not hard-fail the feed on schedule/revision drift after concurrent edits.

## Permanent Marks

Freestyle inline edit scope is configured in 翻卡设置 (`editScope`). `unit` (default) projects the palace-root → unit spine plus that unit's subtree and hides siblings; `palace` shows the full document. `savePalaceEditor` still writes the full palace document. Entering unit-scoped edit expands the scoped tree and re-centers the previous viewport-center card (or the unit anchor if that card is gone); it does not fit the whole tree. Switching edit ↔ review keeps the same `revealMap` / flip progress. Double-click / double-tap on empty canvas toggles edit and review. Node click, node double-click, and node long-press stay on reveal / text-edit / menus. The overflow menu still toggles the same modes. Edit mode hides the rating bar, feed pager, and bottom inset so they do not cover the map.

Permanent marks are edited in the palace document. While the user is still in permanent-mark mode, toggles only update `editor_doc` (plain autosave) so many marks can be changed continuously without rebuilding freestyle. Schedule reconcile runs when the mark pass finishes (exit permanent-mark mode / `mark_change`), when returning to review, or on editor leave/idle. Content-only autosaves never reconcile schedule. When reconcile runs, freestyle queue rebuild is deferred until the card leaves inline edit (`return_to_review` / leave) so continuous mark editing is not interrupted mid-pass.

Typing autosaves are quiet and debounced (2s idle) so a return-to-review flush after a same-doc autosave is the only save the user waits on — and even that is optimistic: clicking 返回学习 switches to review immediately, saves in the background, and adopts the local tree plus the new fingerprint when it settles. A slow or stale save response must not rebuild editor_doc or restore deleted cards. A failed save returns to edit mode with local content intact. If the user re-enters edit before the return save settles, the freestyle queue rebuild is deferred again until the next leave.

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

**In-feed corrections must never change palace scope.** A hint must not swap the palace
filter under the card the learner is reading. Corrections move `due_policy`, quiz mastery
buckets and weak-priority only, and rebuild with `silent` + `preferCardId` so finished
work and the learner's position survive. `freestylePalaceScopeUnchanged` guards this
and is asserted directly. Saving the round-plan dialog may change palace/subject scope;
that rebinds the current round instead of minting a new one.

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

## Toolbar 做题 overlay

The immersive mind-map toolbar (freestyle only) leads with icon **做题**, then icon **英语**
immediately left of **文字**. Canvas zoom in/out buttons are omitted; pinch and wheel still
persist preferred zoom. 做题 opens `widgets/freestyle-scope-quiz` over the current card. It does
**not** change `training_mode` or rebuild the feed into quiz cards.

Question membership follows the **saved** feed palace range (`streams.quiz.specific_palace_ids`,
else `streams.memory_palace.specific_palace_ids`, else the subject union) plus the quiz stream’s
type / mastery / weak-priority filters and `overlay_question_range` (`due` = question SRS due
today or earlier; `all` = every published question in range). Draw order is `streams.quiz.quiz_scope`.
The first open asks for palace order and due/all range, then sets `overlay_quiz_setup_done`; later
opens skip setup. Config stays reachable from the dialog’s top-left.

Answer-then-rate: 忘记 / 困难 / 记得 / 轻松 always write **first-learning** on the question
(`schedule_stage` / `schedule_due_on`), never palace review units. The first rating auto-advances
except on the last question; amending a rating does not advance. Session 已做 is shared with
node-bound badges and Palace Quiz practice and clears on reload, a new round, or when that
palace’s review units in the round are all scored.

Progress membership still lives on the round plan as `overlay_quiz` (question ids, index, completed ids,
runtime states, per-question palace ids, and `parked` out-of-scope progress). Starting a new round
starts overlay 已做 empty. Changing subject or palace scope parks answered questions that left the
filter instead of deleting them. They return when the palace is in scope again. Overlay progress for
a palace is dropped only when that palace's review units in the current round are all scored
(palace-scope 记得/轻松 counts as scoring that palace).
