# Freestyle Immersive Feed

Freestyle is a consumer of public learning projections. It does not own palace review scheduling.
Toolbar 做题 intersects the round's scheduled review palaces with the current memory-palace
stream scope. Completed cards and live retries retained after a picker change do not add
removed palaces to the question pool. Subject catalog lookups only narrow that scheduled
set; they never add unscheduled palaces. Out-of-scope answer progress stays parked and
returns if the palace is selected again. An overlay ensure version conflict must be retried
before loading question ids, since its snapshot may precede the just-saved picker scope.
`FreestyleFeedConfig` is the single queue configuration owner for the immersive page; the
older `FreestyleConfig` settings path is compatibility-only and must not drive queue builds.

## Stage Header and the Sheet's Top Edge

The immersive page owns one in-flow header above the feed (`FreestyleHud`), never a stack of
floating pills. It is: a 20px progress hairline (`FreestyleProgressRail`, which keeps the
segment/retry/day-cut data and the finger-follow glider), one row with the current palace and
the round count (`29/55`, still a button to 本轮安排) plus the two overflow actions, and one
truncated milestone line (countdown + the nearest day; tapping opens every group). Nothing in
the header is absolutely positioned over the card.

The header measures itself with a `ResizeObserver` and publishes `--fs-hud-h` on the stage root.
Every overlay that sits under it (top notices, unsaved-ratings pill, palace-cleared and
new-units banners, stale recovery, quarter tag, `.fs-edge-hint[data-edge='top']`) reads that
variable instead of a hard-coded `rem`. `FreestyleFeedCard` carries no reserved top padding:
the card's sheet starts exactly at the header's bottom edge. On phones both header rows keep a
`pr-11` lane for the draggable session-recorder widget in the top-right corner; without it the
recorder covers 更多.

Inside the sheet the order is toolbar → unit title row → map. The map toolbar
(`MindMapCanvasToolbar` via `MindMapPageToolbar`) owns the sheet's top edge; the unit identity
row is rendered through `belowToolbarSlot`, which is threaded through `MindMapCanvas` →
`MindMapEditorSurface` → `FlipCardMindMapPanel` → `FreestyleUnitReviewFlipPanel` and takes layout
height (it is not an overlay). The row therefore gets the full width and no longer reserves the
old `7rem` band that used to exist for the floating HUD. Loading and error placeholders still
draw the identity row at the top of the sheet, because they have no toolbar.

## Start-Page Overview Payload

`/freestyle/overview` is the first read of the page, so an unexpected shape in it must cost a
strip of the page and never the page itself. It is parsed once at the API boundary
(`api/freestyleOverviewParse.ts`, used by `getFreestyleOverviewApi`): numbers default to 0,
lists to `[]`, unknown blocks to empty, and a round only exists when the payload has one.
Renders then read the contract shape; the start-page 里程碑 strip additionally reads
`milestones?.groups ?? []`.

This exists because a half-updated pair white-screened 随心: the frontend read
`milestones.groups.length` while the still-running API answered
`milestones: { reminders: [] }`. A backend edit only takes effect after the shared service
restarts (`python tools/pwa_server.py --stop` then `--build`); without that the old process
keeps serving the old field names to a newly built frontend.

## Review Entry

Shelf 「立即复习」 opens `/palaces/<id>/review` and reuses the freestyle feed. That route is a
knowledge-section page, not `/freestyle`, and it must not publish a followable
live-study route. Its round workspace is `p<id>` (column width 20). It does not write
the global 随心 selection. The round still applies a transient single-palace scope by locking every
training stream to that palace. A saved 随心 palace/subject selection does not keep showing the full
feed. Content/mix/queue settings are borrowed, the lock is not written back to stored prefs, and
there is no separate formal page session before the queue loads. Editor 「开始随心复习」
may still enter `/freestyle?palaceId=<id>` as an intentional 随心 launch. A memory-stage
review may enter `/freestyle?palaceIds=<id,id>` and lock every stream to exactly those
palaces for one round; saving still writes the stored 随心 selection, not that transient lock. There is no
standalone `/review` frontend route or completion screen; unknown retired `/review...` paths fall
back to `/freestyle`.

## One immersive workspace

随心 is the only immersive round. `/freestyle-2` (随心 2) was merged into it by migration
`0072_merge_secondary_freestyle_workspace`: its active round and feed settings took over the
primary slot, and a displaced primary round is kept as `status='archived'`, never deleted.
Any stale `workspace=secondary` request normalizes to primary, and `/freestyle-2` redirects to
`/freestyle`. Overlap identity is `unit:{unit_id}` / `quiz:{question_id}`. A 1–4 unit rating is
keyed by `unit:{unit_id}` on the round's own card. A rating from palace review or a freestyle
round is stored once on that unit and is not copied to any other round. A tap never moves the
cursor. Completion without a
stored rating still must not invent 记得. A fully handled round
freezes on `get_or_create` so the closing settlement slot stays reachable; leftover due
work advances only when the learner explicitly starts the next round via config confirm
(`「再来一轮」` → `/rounds/start`). Page refresh, app restart, and HUD queue refresh must
never mint a new `round_id`. The overflow action 「更新队列」 is separate: it replans this round from the latest due projection, keeps already-rated cards, and does not replace the ledger with the other computer's scores. The overflow action 「同步进度」 reads
`GET /freestyle/rounds/active` and replaces the local ledger with that workspace
round. It drops local-only scores so a phone draft cannot keep ratings the
computer's round does not have, and it does not mint a `round_id`, append cards,
or call `/rounds/start`. Stale recovery and the feed-error retry still keep the
frozen round and must not drop server-known completions.

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
An unfinished round survives the study-day rollover (03:00 local, see `review-boundary.md`), a page refresh, a saved-config hydrate,
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
Refresh must not mint a new `round_id` or drop completed cards from the HUD/feed, except cards
the learner explicitly compressed with 「结算已完成单元」. A 结算 drops the source and every live retry of that source. A retry whose source id is in `compressedIds` leaves the rail, the sheet, and the swipe feed; it must not stay as a lit tick the learner cannot reach. Scoring alone never removes those ticks: a 重练 rated this round keeps its slot right behind its source through silent rebuilds, 更新队列, and 重建本轮 (`replan_remaining` re-adds completed occurrences of kept sources; `_collapse_retries` only collapses *live* duplicates and never cancels an answered one; `_settle_source` treats an occurrence's own pass grade as answered even when the encounter cache lost the entry). `cardsForServerPlan` also keeps a completed occurrence's card when the presented list no longer names it. Only 结算 (`compress_completed`), a cancelled occurrence, or the next study day's reopen takes it off — so swipe-back / 改分 still reach a card the learner just rated. Completed source
cards stay in presented order so swipe-back / 上一张 can reopen them until that compress. A window that has lost its local plan adopts the workspace active round and must not mint a new `round_id` while that round exists. A quota miss may compact the stored snapshot, but the live session keeps the plan the learner is looking at. 做题 stays available while the map is still opening. The card must not say it is still preparing a score. Re-scoring a completed
unit amends from that exact recall attempt's original baseline; it does not stack SRS.
The identity includes round, source card, occurrence and retry attempt. A real retry starts
from the current penalized schedule, never replaces the earlier failure, and replays only
its own operation. A rating write after a glance was abandoned, completed, or cancelled
reopens the same attempt and applies the latest rating; it must not return
`active unit review session required`. Once a later real attempt has been rated, an older
attempt is read-only: correction/undo must target the most recent attempt rather than
silently rewrite the basis of later evidence. Tapping the currently selected rating again
clears that latest editable attempt back to unrated; it does not erase earlier real retries.
Swipe-back / 上一张 onto a completed (passed) unit must open an amend glance in the same
round. If the previous study session is still `active` with a passed item and no open
encounter, start finishes that session and opens a new one. It must not return
`passed review unit cannot start another encounter`. Freestyle unit load failures that
cannot be healed do not toast English API text; the card offers 重试 / 跳过这张 / 重建本轮 /
只看不评. A slow session start must not replace a visible map, and it must not block
scoring. The four ratings are pressable as soon as the card is on screen; the score paints
immediately and the save follows. Immediate selection is only local intent: completed ids,
passed counts, retry scheduling and cleared-due feedback update only after server acknowledgement.
A failed save keeps the selected button with an explicit unsaved warning and asks for one more tap —
it must not claim passing/completion, reload the card or make the learner re-read it. Fast flips and progress-rail
jumps must not open a glance for cards that were only passed. A glance opens when the learner
rates, or after they settle on a card. Returning to a card shows the score already recorded
for this round without starting preparation over. A card's
`POST /review/units/{id}/sessions` carries a 45s transport timeout
(`SESSION_START_TIMEOUT_MS`) and is deliberately kept out of the mutation queue
(`persistence: false`) because the UI re-issues the same encounter id, not a new glance.
That budget sits above the server's 10s SQLite `busy_timeout`, so a lock wait can finish
and be adopted instead of aborting at 15s and starting a second write. The visible failure
is one sentence plus a hidden 复制给助手; it must not tell the learner to restart the app.
A later due-list rebuild with the same construction knobs (`append_today_cards`) keeps every
original card, including unstarted leftover work that dropped off today's due set, and appends
newly seen identities with `entered_on` equal to the local calendar day so retry copies cannot
clump into an orphan block of attempt-1 nodes. When the study day advances, the rebuild first
re-admits units that are due again (`_reopen_due_again`): a round that outlives midnight must not
keep yesterday's 记得 cards compressed forever just because it already settled them, or the
1-day stage silently stops being reviewed. Matching is by knowledge-point identity, not card id
(a revision bump `…:r1` → `…:r2` is the same work), and the server resolves the due set for the
plan's own units instead of trusting the incoming candidates — the client rebuilds those from the
round ledger, which still hides exactly the cards that are due again. Saving feed config from 「保存配置并重排」 asks first. 保留继续这一轮：
`replan_remaining` keeps completed ticks, drops unstarted work
outside the new incoming set unless it still has a live retry, and only reorders what has not
started. 不保留 persists that config and mints the next round through `startNextRound`
(`forceStart`), so completed, excluded, retry, and overlay 已做 do not carry over. Closing the
reminder cancels the save. Palace-picker confirm and other in-feed config writes still replan
without that reminder. Settlement 「开始下一轮」 already starts fresh and does not ask again.
Changing palace/subject scope (`replan_remaining`) keeps completed ticks, drops unstarted work
outside the new incoming set unless it still has a live retry, restamps remaining work as today,
and parks live retries after at most three cards of the new remaining queue (or immediately after
the completed prefix if fewer remain). Unstarted cards whose review unit is no longer openable
(`drop_vanished_unstarted`) are removed on `get_or_create` without parsing `editor_doc`.
A unit is not openable when it is inactive or its palace is deleted or archived, even
if this round still has a live retry for it. A completed tick may stay in the round
history, but its retry leaves too, because opening either one would only redraw a dead card. Completed ticks, excluded cards, and quiz
cards stay. Units that still exist but are not due today stay. If that drop leaves the round fully handled, the plan is
persisted and frozen; it does not append new due cards. Queue build reads active due
`ReviewUnitState` rows (`list_trusted_due_units_for_queue`) and palace titles only — it does
not parse every `editor_doc` on the critical path. Opening a unit still reconciles that
palace. A cold start with no stored round may return a `study_window` prefix (`tail_pending`)
so the learner can start; the client then silently loads the rest. The prefix is a prefix of
the same ordered queue, not a reshuffle. This is first paint, never a release schedule: every
due card is already in the round plan and in the HUD denominator, and the tail is not held back
until later in the day. There is no daily review quota, no backlog release, and no per-round
slice — see 「The due set is one whole」 in `review-boundary.md`. When a round already exists, the first paint comes
from the stored plan and loading must not cover the feed once cards exist. A weak `忘记` /
`困难` rating does not move `current_card_id`; the source stays
current until `leave_card`.

Optimistic concurrency: writes carry `expected_version` and `operation_id`. A stale device that
submits a lower version receives the latest plan with `conflict: true` and must not overwrite
newer progress. Repeated terminal writes with the same `operation_id` return the accepted
result.

The frontend reducer applies optimistic patches and hydrates from the server. Rebuilds keep
completed, excluded, retry, and stale entries visible in the plan; a card that returns after a
stale rebuild is rebound by stable `unit_id` to the latest `unit_revision` while ratings and
retry counts stay. If the current card is missing or already completed, the next unfinished
server-plan card becomes current. Drag still does not write the review schedule.
A confirmed 移除本队列 ends this round's arrangement the same way 记得 or 轻松 does:
the progress rail fills, the palace can clear, and the unit is not unfinished. It does
not write a 1–4 rating and does not change stage, interval, or due date. A later round
can arrange the unit again while it is still due. Restore puts the card back in this round.

永久移除 is the sibling button right of 移除本队列 (same two-press confirm, no rating). It calls
`POST /review/units/{unit_id}/remove-permanently`, which sets `review_unit_states.permanently_removed`
and `active = false`. `resolve_unit_definitions` filters that unit identity (anchor + kind) out, so
reconcile, the queue, and inheritance never schedule it again, even after its marks are deleted and
re-added. The card is then dropped from this round. A palace whose units are all removed reads as
`scheduled`, not `marking_required`.

`palace_order` only controls **queue construction**
(finish one palace’s cards before listing the next, or interleave). 上一张 / 下一张 / finger
paging never auto-rate and never block crossing a palace boundary; unrated units stay unfinished
so the learner can skip ahead and come back. Retry work still cannot mark a palace “cleared”.
The leftover `isSequentialPalaceBlocked` helper is not a navigation latch. A 忘记/困难
rating creates a retry occurrence that stays **pending** with an `available_at` instant
(10 minutes, then 1 hour, then 3 hours; at most three retries per study day). It is not on
the rail until that instant passes; serving publishes it at the learner's cursor, so the
cards rated in the meantime are the interleaving. A first-ever pass creates the same kind of
pending occurrence, `kind: "step"`, for its 30-minute re-check; a 重练 that finally passes
creates one too, so a recovery is re-checked before its day-level interval is booked. A
pending occurrence is not
served and does not mark its source finished; the round payload's `waiting` reports how many
are owed and the earliest ready time. The feed shows a slim banner while cards remain and a
waiting panel when nothing servable is left; a single scheduled read at `next_ready_at`
publishes the card (manual 「现在刷新」 does the same). There is no fixed three-card offset
any more. The viewport stays on the source — no
auto-advance — including when nothing remains after the source, so 下一张 / 定位 /
settlement cannot deadlock. Failing the retry card itself does not move that card until
leave. A later due-list rebuild appends newly seen identities as the
today segment and must not move an already-inserted leftover retry. `leave_card` confirmation
pins the card now under the viewport and must not yank back to the source. The source card
stays in place so swipe-back is geometric. Looking back at history cards does not move the
committed cursor and does not insert retries. Finger paging
commits `active` only after scroll settle so a mid-gesture index change cannot close one
encounter and open another. A mouse wheel or trackpad over the feed pages one card per
notch; trackpad inertia is coalesced so it cannot skip the queue. That wheel must not
scroll the snap scroller natively — mandatory snap plus the settle pin would pull a
partial notch back to the current page and the wheel would feel stuck. Wheel over the
review map still pans the canvas. Wheel over a nested scroller that can still move in
that direction scrolls that scroller. Ctrl/meta wheel stays a zoom gesture. The review map stays pannable (`mobileViewPolicy` defaults to
`auto`); one-finger drag on the canvas pans the tree and is not yielded to the snap
scroller. The right pager is the same three buttons on PWA and desktop: 上一张, 下一张,
and 完成, in one vertical column on the right edge, vertically centred on the card. PWA
does not move it to a strip above the rating dock. 上一张 / 下一张 always page cards,
including while the rating
scope is 宫殿; they must not disable themselves when the round has only one
palace. There is no palace-skip control.

When every review-unit card of a palace in this round is handled (retries included; skip /
exclude do not count), the current card shows a chapter banner. Copy is `《宫殿》今日安排已清`
when that palace has no leftover due units outside the round, otherwise
`《宫殿》本轮已清，今日还剩 N`. Queue `round_meta.palace_leftover_due` is the leftover due
count per palace. The banner is not a snap page; the whole chip dismisses on tap
(`点一下关闭`). Other top freestyle chips (yesterday unfinished round, channel-applied,
save error) likewise dismiss on whole-chip click. Audio uses `all_clear_ready` on the review
scene, locally — never `dispatchGlobalFeedback`.

Clicking a progress-rail tick jumps the feed to that card when it is still live (`navigateToIndex` on the matching card id). A tick whose card has left the feed, the HUD count, and an empty rail still open the bottom “本轮安排” sheet. A header toggle switches 「按宫殿」 (group stable plan entries by palace) and 「按进度」 (the same entries in progress-rail segment order, still split into the leftover and today blocks). Both views support
jump, drag (desktop) or up/down (touch), batch exclude/restore, and reset-round. The toolbar
「结算已完成单元」 opens a 小结算 page first. That overlay covers the feed pager, so it keeps a visible 「退出」 that cancels without compressing, and the page scrolls so 「取消结算」 and 「确认结算」 stay reachable on a short PWA viewport. The right-side 完成 on a fully scored round skips that page and writes the same settlement directly. Confirming it (`compress_completed`) drops settled groups (a source that passed, or a 重练 that passed or was explicitly completed; a live 重练 still weak or blank keeps its whole group in the round, so the 3张后重练 comes back) from
the swipe feed, 本轮安排, and the HUD rail so the denominator shrinks, and stores that page as `partial_settlements` on the round plan. Cancelling leaves the cards in the feed. A group whose 重练 nobody has answered yet
stays. This is not 排除: excluded ticks remain on the rail; compressed
ids (`compressed_ids`) do not. Unfinished work stays in this round. Ratings stay committed;
swipe-back cannot reopen a compressed card in this round. A silent rebuild / `append_today_cards`
must not put compressed identities back, and must keep `partial_settlements`. Overlay 做题 is not asked on 小结算. The closing 大结算 includes each confirmed 小结算 (counts and subject lines) because those cards have left the feed; round clock time is not added twice. If that compress
empties the feed, the closing settlement slot stays reachable. Configuration is a
separate dialog. 「保存配置并重排」 asks whether to keep overlapping finished/excluded/retry
progress. 保留 continues this round and only reorders unstarted work. 不保留 starts a new round. The HUD line is `当前位置/队列总长` (`position/total`): the denominator is the progress
rail, including retry insertions and a confirmed 移除队列. That removal stays on the rail as a
solid 已移出队列 tick (the same filled palace color as a scored card, not a faint tick and not a gap).
`scheduledBase` still omits those removals and remains plan math, not the HUD denominator.
Hydration unions server `excluded_ids` with local plan exclusions, and the exclude action retries
on version conflict so a cursor update cannot erase it. A silent rebuild after 移除队列, including
one that races 完成's cursor write, keeps this-round scores and the solid removal tick. Hydration
reads that ledger after the network await and does not publish a draft plan first: a changed round
id would otherwise look like a cancelled rating and wipe the ledger. The rebuild also keeps the
ledger captured before the await, so a stale render or an all-pending draft cannot drop the
removal or the other this-round scores. A just-confirmed removal is stamped again on that
hydrate (`forceExcludedIds`). A newer revision of a removed
unit stays one solid tick and is handled for 完成 seek. A queue removal is handled for 完成 seek.
The rail stays one bar: palace color
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
right-side pager has 完成, not 定位. When every presented card is scored the press is a
real completion: it settles what this round rated with the same `compress_completed`
ledger write as 「结算已完成单元」 (no 小结算 confirmation page), so those units leave the
HUD rail, 本轮安排 and the swipe feed and only the closing settlement remains — the pager
disappears with the last card, and 取消结算 is not offered because there is nothing to
return to. A waiting 回顾 does not make the button inert: that press opens the closing page
instead of compressing (see below), so there is no state in which 完成 is disabled while a
card is on screen. An open round still seeks the queue-order first **unscored** unit
(谁最早看谁). Pressing 完成 again while the viewport is already on an unscored unit walks
to the **next** unscored unit in queue order and wraps at the end, so a single 完成 button
cycles through every blank unit instead of sticking on the first. Scored means this
occurrence has a this-round score (忘记/困难/记得/轻松
alike — the rail fills solid). A weak score still opens settlement once nothing
unscored remains — 完成 must not disable in that state. A scored 重练 is never the target; leave_card bumps
`retry_attempt` and clears that occurrence's score so the next blank attempt is seekable.
A weak source is scored, so 完成 does not reopen it — the blank 重练 is the work.
A same-day 回顾 still owed (`waiting`) never disables 完成. The button has exactly two
outcomes while the feed has cards: seek the next unscored occurrence, or open the closing
settlement. With only waiting 回顾 left it opens the closing page without compressing (the
server still holds those groups), and the page names what is still owed — 「还有 N 张稍后回顾」
— so 结算 is an informed choice instead of an unreachable button.
Rating the retry must not move the viewport onto the source or refit the map to the palace
root. It does not bulk-complete leftover work. Dropping sibling retries (a 重练 pass settles
the source, so older attempts of the same unit leave the feed) re-pins the card under the
viewport by id: removing entries above it shifted every index and made the feed look like it
auto-advanced. Clearing a 重练's own rating keeps that card blank in place — only 结算, a
cancelled occurrence or the next study day removes it.

### unitProgressState is the only score kernel

`apps/web/src/modules/practice/domain/unitProgressState.ts` owns occurrence-local
this-round score (`occurrenceScore` / `isOccurrenceScored` / `isOccurrencePassed` /
`findEarliestUnscoredIndex`). Progress-rail fill, the 完成 seek target, palace
clearance, and round completion must read this module. Do not reassemble
`selectedRating` / `lastRating` / `completedIds` / source-fallback conditions at
call sites — that is how seek and the rail forked. `lastRating` never inherits
across source ↔ 重练 ids.

`roundCompletion` layers one family rule on that kernel: a source whose 重练 passed
is finished for round completion and for 完成's seek target even when its own weak
score fell out of the local ledger, and a source whose blank 重练 is already in the
feed is skipped in favour of that retry. Without the layer, 完成 landed on a source the
server would only answer `superseded_attempt`, so the button disabled itself on a card
that could never be graded again. 忘记/困难 still counts as scored.

**The family rule runs source → retry, never retry → source.** A 重练/回顾 card answers
only for itself: its own plan entry (`completed`), its own glance score, or its own pass.
It must not inherit `completed_ids`, the plan's `completed` status, or `lastRating` from its
source. Those are all true the moment the source passes, which is exactly when the 30-minute
回顾 is scheduled — inheriting them made every blank 回顾 card look handled while the rail
drew it pending, so 完成 had no target and disabled itself on a round that still had work.
A `lastRating` copied onto the retry by restudy stamping is not its own score either; only
its encounter counts, and a copied pass (`>= 3`) is weak evidence the old rule already
accepted. Measured on one real round: 56 presented cards, 42 rated, 11 blank 回顾 cards —
the whole button dead until this rule was split by card kind.

An earlier attempt that a later real practice already superseded opens **read-only**
instead of failing: `POST /review/units/{id}/sessions` still returns the session (the map
needs it), the encounter carries `rating_editable: false` (the amend glance inherits that
from its `amend_source_id`), and only the write — the 1–4 tap, correction and undo — answers
400 `superseded_attempt`. The card locks with 「已有后续练习，这次评分仅供回看」, the outbox
marks the failure terminal (no auto-retry, no 未保存 record, rail tick keeps the plan's fill),
and a 400 at glance-open time is classified the same way.

## 睡前复习 (bedtime review)

A moon button sits above the right-side pager (the control column with 上一张 / 下一张 /
完成). It opens the shared `ConfirmDialog`, which first reads
`GET /freestyle/rounds/{round_id}/bedtime/candidates` and states how many cards will be
appended and that the grades do not move the schedule. Confirming calls
`POST /freestyle/rounds/{round_id}/bedtime`, appends the cards to the end of the current
plan with `bedtime: true`, and jumps to the first new card. The button stays reachable on
the closing page, where the pager itself steps aside.

- **What is appended:** one card per **palace** with at least one live rating
  operation in the current study day, in the round's workspace (all palaces for
  随心, one palace for `p<id>`). The palace is the bedtime unit — the map covers
  every node and one grade covers the whole palace; it is never cut into
  permanent-mark slices. A palace already carrying a bedtime card is never
  appended again, so rating more units inside it does not queue a second pass.
  The card id is `bedtime:palace:<palace id>:<study day>`; its `unit_id` is a
  real rated unit used only as the read-only preview handle.
- **Grading:** a bedtime card renders from the read-only unit preview (no
  session, no encounter) with `palace_pass`; its reveal scope is every node of
  the palace and its map is reveal-only. Its rating bar is
  `FreestyleBedtimeRatingBar`; the tap goes to
  `POST /freestyle/rounds/{round_id}/bedtime/ratings`, which records
  `plan["bedtime_ratings"][card_id]` and completes the card. No Reviews session,
  encounter, or rating operation is written, so due dates and FSRS state cannot
  move; the normal rating endpoint rejects a bedtime card outright.
- **Rail and expiry:** bedtime ticks carry a moon above the bar. They are kept out of the
  due-day filters (`drop_undue_unstarted`, `replan_remaining`) and are dropped by
  `drop_previous_day_bedtime` when the round crosses the 03:00 study-day boundary. Cards
  rated in the meantime keep their real ratings; the bedtime pass never replaces them.

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
structured/random unit order. Structured order means the palace's own depth-first unit order
(`topology_order`, resolved from the document so an unreconciled edit cannot scramble it);
`new_placement: new_first` still hoists never-passed units, and the due date is not a sort key.
`streams.english` is kept only as a sanitized compatibility
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
- Card identity carries stable `unit_id` plus `unit_revision`. A permanent-mark membership change may drop a vanished unit. A content-only update preserves the schedule and rebinds the same parent unit in the current round; it does not mint a new unfinished card.
- The card displays the full palace for context while the frozen Reviews unit membership defines the rating scope.
- Freestyle starts a one-unit `freestyle_unit_review` session and uses the same rating and undo commands as formal review. Tapping a successfully saved selected rating again undoes until the card is unrated; it must not post the same score. A selected rating whose save failed instead retries saving on the next tap. The transient 撤销 chip still undoes one step. Clearing the rating also uncompletes that card in the round plan so the HUD tick goes back to pending.
- Freestyle always scores only the current review unit; an old palace-scope preference must not batch-score siblings or mark unseen sections as passed. The separate formal review `rate_palace_due_units` API remains available outside this freestyle card flow, with per-unit schedules and batch undo. Quiz cards never enter either palace-unit rating path.
- A successfully saved `忘记` or `困难` creates a retry occurrence. The server's
  `apply_rating` puts the occurrence into `presented_ids`, and the frontend adopts that
  confirmed result into the feed and round-plan order without waiting for `leave_card`
  or a separate silent rebuild. An unsaved local tap never inserts retry work. The gap is exactly three already-presented cards in the
  source's leftover/today segment (palace, quiz, and other occurrences); if fewer remain in that
  segment, the copy appends at the segment tail and must not pull cards from the other
  segment. When the gap is 0 (no cards remain after the weak-rated source), the retry is
  still inserted on the rating, directly after the source, while the
  viewport stays on the source so pager / locate / settlement cannot deadlock on the last card.
  `current_card_id` does not move. `leave_card` on an already-inserted source is a no-op
  for placement. An inserted retry must not freeze the round as fully handled and drop the
  confirmed 重练. An inserted retry parked at or before its source is moved back behind
  the source on `leave_card` and on silent append. A round whose sources and retries are actually finished still freezes, and
  a silent rebuild still does not append leftover due onto it.
  Confirmation pins the live viewport card, never the source just left.
  There is no per-round cap. A unit keeps one live retry at a time; the amber node
  number is this-round `retry_attempt` (第几次). Each new failed encounter increments
  that same slot. A later `记得` / `轻松` settles the source card and every unfinished
  occurrence together. The just-rated source card does not move. Only `记得` / `轻松` finish
  the current encounter; a mature-unit `困难` remains retry work just like first-learning `困难`.
  A retry occurrence has its own encounter. A retry card starts with a blank rating.
  The 忘记 or 困难 that inserted it belongs to the parent card: that score downgrades
  the parent and schedules the retry. It must not prefill the retry rating bar.
  Silent rebuilds must not rebind that glance
  onto the source by `unit_id`; a passing rate leaves that occurrence in the viewport
  instead of deleting the card under the learner. Rating that glance keeps its encounter
  and reveal state — it must not remount the map at the root. Another `忘记` / `困难` on a retry
  increments the same occurrence and repositions it after leave — it must not mint a
  second copy.
  A rate is rejected unless `card_id + occurrence_id + encounter_id + unit_id` name one
  consistent card. A retry card without `occurrence_id`, an occurrence from another unit,
  or an encounter bound to another unit is a mismatch — last-write-wins never applies to
  the wrong identity. The active card's rating bar remains pressable while its encounter
  opens. A tapped score is selected immediately as local intent; posting waits for a valid
  encounter. Only a successful response updates recorded progress, retry planning, and
  palace completion. A failed POST retains the selected intent, shows that it was not saved,
  and allows another tap to retry; it must not claim a completed round or cleared palace.
  A late response updates that card's ledger only and must not yank the viewport.
  Rating callbacks carry `card_id + occurrence_id + encounter_id + plan_version` and adopt the
  returned `plan_version` so the next rate is not a stale conflict. Silent
  rebuilds keep the current DOM card by id, never by the old index. By default Freestyle
  stays on the card after a rating; an explicit auto-advance preference may move it after
  a successfully recorded rating. Queue rebuilds freeze
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
- Content edits bump `unit_revision` on the parent review unit. Freestyle adopts the live revision in place: the current card stays, remaining cards rebind by `unit_id`, and already-rated units keep this-round ratings. Starting a freestyle session with a stale revision opens a fresh encounter at the live revision instead of raising `review unit changed`. A newer revision must not appear as unfinished work in the same round; a new round with empty `completed_ids` may include the revised unit if its preserved schedule is due. Content edits alone never demote its review stage. Stale recovery (skip / rebuild / open config) is only for a vanished unit, a non-fill card that is not due (reviewed elsewhere), or an encounter that belongs to another unit. Consecutive those drops still trip the circuit breaker (three in a row, or three within ~2s). Practice freestyle must not hard-fail the feed on schedule/revision drift after concurrent edits.

## Permanent Marks

Freestyle inline edit scope is configured in 翻卡设置 (`editScope`). `unit` (default) projects the palace-root → unit spine plus that unit's subtree and hides siblings; `palace` shows the full document. `savePalaceEditor` still writes the full palace document. Entering edit expands the tree only as far as the current flip progress: a branch opens when a card inside it has been flipped out (`placeholder` / `revealed` in the `revealMap`), and branches the learner has not reached stay folded, for both edit scopes. So the edit view is the flip progress plus editable structure, never the whole palace dumped open. After that the host's own fold seed governs the canvas, and a manual expand/collapse gesture still holds until the next mode switch. Editing or deleting a card must not re-apply the flip-progress seed; those writes use the same fold reconcile as the ordinary palace editor. Edit keeps the same `revealMap` / flip progress and re-centers the previous viewport-center card (or the unit anchor if that card is gone); it does not fit the whole tree. Switching edit ↔ review keeps the same `revealMap` / flip progress. Double-click / double-tap on empty canvas toggles edit and review. Node click, node double-click, and node long-press stay on reveal / text-edit / menus. The overflow menu still toggles the same modes. Edit mode hides the rating bar, feed pager, and bottom inset so they do not cover the map. Enter reveal follow: Enter on the active review card advances the unit anchor and, when a card flipped out by that step is clipped, pans the minimum distance to bring the most clipped of those cards fully into view. Zoom stays put. A later Enter interrupts the pan. Mouse clicks and A/S bulk flips do not move the camera. Camera tracking is configurable in 翻卡设置 (`enterRevealFollow`, default on): with it off Enter still flips the same cards and the viewport stays where the learner left it. Paging controls release keyboard focus when they activate (the next unit may still be loading), so Enter belongs to the card and flips instead of paging again.

In edit mode the 永久标记 mode switch is a dedicated toolbar toggle (pin icon plus the 已标 count) that sits after 文字 and outside the ⋯ menu; the palace editor exposes the same toggle. Permanent marks are edited in the palace document and each complete toggle saves immediately as a plain document write. The active freestyle card never sends `mark_change`, `return_to_review`, or `reconcile_units`, and it never calls `onUnitsReconciled` / `buildQueue` for an edit or mode switch. Schedule reconcile is sent once as same-document `editor_leave` only after the edited card becomes inactive or unmounts; only that leave reconcile may refresh the queue. Explicit 重建本轮 keeps its existing behavior.

Every complete edit action (node add/delete/move, text commit, permanent-mark toggle, import apply) updates local state and starts a save immediately; there is no typing debounce. Requests for one palace are serialized, and while one request is in flight only the latest local document is retained for the next request. Returning with 双击 / 返回学习 adopts the local document synchronously and enters review without waiting for HTTP. Save state is visible as 保存中… / 已保存 / 保存失败，重试. A failed save never forces review back to edit and never replaces local content.

A 409 first refreshes the service-side revision token and retries the latest local document once; the active device's local edit wins automatically and the conflict is recorded in app logs. A successful acknowledgement updates only the fingerprint/status and never rebuilds `editor_doc`, the reveal tree, the encounter, or the current queue position.

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
filter under the card the learner is reading. Question mastery is not a lever. Anxious
may only tighten palace `due_policy` to `due_only`; sanitized configs are already
`due_only`, so that adjustment is a no-op. Bored does not change the feed. A real
correction still rebuilds with `silent` + `preferCardId` so finished work and the
learner's position survive. `freestylePalaceScopeUnchanged` guards scope and is
asserted directly. Saving the round-plan dialog may change palace/subject scope;
that rebinds the current round instead of minting a new one.

## Quiz pool config (feed settings)

Immersive queue config (`FreestyleFeedConfig` / `sanitize_feed_config`) owns quiz membership and draw order separately from palace due policy:

| Field | Role |
|---|---|
| `quiz_scope` | `cross_palace_random` shuffles all in-pool quizzes across palaces; `single_palace_random` finishes one palace's quiz pool before the next. |
| `mix_mode` + `mix_ratio` | Palace-side vs quiz interleave (e.g. 2:1). |
| `bound_quiz_placement` | Default `into_mix` so node-bound quizzes count toward `mix_ratio`. `follow_unit` re-attaches after the owning branch and weakens ratio predictability. |
| `due_policy` | Gates **mind-map unit** fill only. Quiz entry is not controlled by due_policy. |
| `question_type` | Optional type filter. It does not drop questions by publish state or mastery. |

Settings UI keeps 题型 and 跨宫殿顺序. It does not offer 题目掌握度 or 薄弱题优先. Stored `quiz_mastery_buckets` and `weak_quiz_priority` are ignored for membership.

## Toolbar 做题 overlay

The immersive mind-map toolbar (freestyle only) leads with icon **做题**, then icon **英语**
immediately left of **文字**. Canvas zoom in/out buttons are omitted; pinch and wheel still
persist preferred zoom. 做题 opens `widgets/freestyle-scope-quiz` over the current card. It does
**not** change `training_mode` or rebuild the feed into quiz cards.

Question membership is the palaces already scheduled as review units in this round
(`original_cards` with kind `mindmap_branch`) — not the subject union, and not
`streams.quiz.specific_palace_ids` — narrowed by the current memory-palace stream
scope. A subject-wide config still only contributes the palaces that this round actually put
into review. Overlay membership does not use `streams.quiz.question_type`. Every non-deleted
question in that round palace set is counted, including rows whose stored `lifecycle_status`
is `candidate`, `rejected`, `temporary`, or `published`. 客观 is every type except
`short_answer`; 主观 is `short_answer`. The config shows a checkbox only for a group that
exists in this pool, with its count. At least one present group stays selected. Both selected
defaults to 混合插入; 先客观后主观 and 先主观后客观 are the other choices. 宫殿优先 vs 题型优先
appears only when 一个宫殿刷完再换 and a sequential type order are both selected, and
this round has more than one review palace. Unselected groups stay in `kind_counts`
so they can be turned back on. Mastery buckets, weak priority, question due dates, and
`DEFAULT_QUIZ_CARD_LIMIT` do not apply to this overlay. Palace draw order is
`streams.quiz.quiz_scope`. Confirm always sends `overlay_question_range: all`. The
first open asks for palace order, then sets `overlay_quiz_setup_done`; later opens
skip setup. Config stays reachable from the dialog’s top-left. That panel includes the shared 快捷键 section. Mark defaults to ArrowUp and toggles once per press. While the dialog is open, ArrowUp and ArrowDown must not page the feed underneath.

### 做题 scope has exactly one owner

`build_overlay_question_pack` (`practice/application/overlay_quiz_service.py`) owns **which
palaces 做题 covers**, and the rule is: *the round's own review set is the whole scope.*
The product statement is 「配置选了 20 座宫殿，但本轮只安排了 10 座，那就只出这 10 座的题」.
The saved 随心 config supplies presentation choices (draw order, 客观/主观 kinds) but **must
not** narrow which palaces contribute. An earlier version applied the config a second time;
on a real round that emptied the pool to 0 questions while the header still counted the
round's 8 palaces.

**One thing does leave the scope: 移除本队列.** When *every* review card a palace had in this
round is excluded, that palace's questions go with it — the learner explicitly took it out.
A palace with even one card still queued is unaffected, and a palace whose cards were
*completed* keeps its questions (finishing a palace leaves it available for extra practice).
`removed_review_palace_ids` owns that judgement. Answered 做题 progress for such a palace
parks rather than being deleted, and returns if the round arranges it again.

The pack returns `scope_palaces` on the overlay: per scheduled palace its title, its
available 客观/主观 counts, whether it currently contributes questions, and a stable reason
code when it does not (`palace_removed` / `no_questions` / `kinds_filtered`, in that priority
so the most actionable, learner-caused explanation wins). There is deliberately no
"excluded by config" reason. Reason codes are data; the Chinese copy lives in
`practice/ui/freestyle/model/overlayQuizRange.ts`.

The dialog renders that report and **must not re-derive membership** from the round plan plus
the feed config. `check_architecture.check_freestyle_scope_quiz_overlay` rejects
`overlayReviewPalaceIds`, a frontend re-application of the feed palace filter, a backend
subject lookup inside the pack, a pack that stops returning the report or honouring removals,
and a bare `宫殿 <id>` label.

Two questions that look alike and are not:

- “Which palaces does the pool draw from” — the backend report: the round's set minus
  all-removed palaces.
- “Which palaces may settlement clear 做题 progress for” — `overlayRoundReviewPalaceIds`
  plus `review_palace_ids`. This one deliberately **includes** removed palaces, because
  settlement clears this round's own history and must still name a palace whose cards were
  removed mid-round.

A 随心 config change still takes effect on the open dialog immediately (keyed on
`freestylePalaceScopeSignature`), because a config save replans the round. Palace *parking*
is driven by the round losing a palace, never by the config: answered progress for a palace
the round drops is parked and returns if the round arranges it again.

### 做题 badge: the bound knowledge point's this-round rating

Each question shows, above its stem beside the 题型 badge, the **weakest** this-round rating
among its bound knowledge points. 「本轮尚未复习」 is shown only when that point is still
unfinished on the progress bar and has no 1–4 yet. A point the bar already drew as done
(completed, excluded, or compressed), and a point this round never scheduled, hide the
badge. Saying they were not reviewed would contradict the bar. An unrated question never
shows a `0`, because "not reviewed yet" and "reviewed and forgotten" are different
information. A failed fetch hides the badge rather than inventing the sentence.

**Both answering windows show it through one component.** `FreestyleScopeQuizDialog` (the
toolbar 做题 overlay) and `NodeBoundQuizDialog` (关联题目) are separate dialogs with separate
data sources, and badging only the first left the second blank — which is exactly what the
learner reported. The badge lives in `widgets/quiz-round-rating/`:

- `QuizQuestionRoundRatingBadge` — pure presentation.
- `QuizQuestionRoundRating` — the wired container: it fetches and resolves, so a window
  cannot derive a score of its own. 关联题目 uses this. 做题 already holds the round's
  ratings from the overlay payload, so it passes the score straight to the badge.

关联题目 renders the badge **only inside a 随心 round** (`roundId` present). Outside one there
is no round to score against, and claiming 「本轮尚未复习」 about a round that does not exist
would be worse than showing nothing. It reads the round through
`GET /freestyle/rounds/{id}/question-ratings`, which is **read-only on purpose**: opening a
question window must not write the round, or its version would move under the study loop and
409 the next rating.

That endpoint covers **every question bound to the round's palaces**, not just the 做题 pool.
Measured on a real round: the palaces hold 235 questions while the kind-filtered pool holds
165, so reading a rating off the pool would leave the rest blank even when their knowledge
points were rated. Both surfaces share one rule through
`build_round_question_ratings` (`overlay_quiz_service.py`), so 「本轮最低 N」 cannot mean two
different things depending on which window is open.

Resolution chain: `question → bound node_uid → the round's review unit owning that node →
this round's rating for that unit`. A direct 1–4 still wins. 「本轮尚未复习」 still wins
when a bound unit is waiting on the bar. Only units in the round's own `review_unit_ids`
are considered for that direct score, so a node owned elsewhere cannot borrow a rating
into the queue.

When the question has no own 1–4 and is not pending, `overlay_rating_inherit` decides the
blank case. `blank` hides the badge. `lowest_reviewed` (the default) shows the weakest
1–4 among ancestor nodes whose own round unit was scored this round. A sibling's score
does not count. If no ancestor was reviewed, the badge stays hidden. This is display
only: the question stays on its own isolation unit and is not attached to the ancestor's
card. The field is not part of `queue_construction_signature` or the overlay scope
signature, so changing it does not rebuild the card queue or reset 做题 progress.
Both windows read the same mode: the pack stamps `question_node_ratings` at ensure time,
and `read_round_question_badge` applies the mode stored on the round (missing means the
default).

Ratings are read from `review_unit_encounters` (`list_round_unit_ratings`), **not** from the
round plan's cached `encounters` map. The cache is not the authority: on a real round it held
29 entries with only 3 carrying a `rating` field while the encounter table held all 29
ratings, so trusting it would hide a score the learner had just given, or — under the old
rule — print 「本轮尚未复习」 for a point already drawn done. Lowest wins when a unit was
rated more than once. A completion with no score does not invent a 1–4, and it does not
keep the "not reviewed" sentence once the bar has drawn the card done. The waiting set is
`waiting_review_unit_ids`: source unfinished, or a live inserted retry of a finished source.

Tapping the badge opens 查看宫殿 focused on that knowledge point (the same dialog the card
toolbar opens), so an unfamiliar question is one tap from its source text. The badge is a
plain label when there is no palace to point at. It does not affect draw order: 出题顺序
remains `streams.quiz.quiz_scope` plus the type-order settings.

Mark / unmark replaces answer-then-rate. The toggle writes `marked` on the question and does not
change `schedule_stage`, `schedule_due_on`, palace review units, or the current index. Marked
numbers on the index rail are rose. Answering still shows right or wrong and the stored analysis.
Already answered overlay progress stays answered; newly included question ids append as unstarted.

Durable progress lives on the round plan as `overlay_quiz` (question ids, index, completed ids,
runtime states, per-question palace ids, and `parked` out-of-scope progress). PWA reload, app
restart, and next-day reopen restore answered content and the current index from that plan. The
SPA `quizSessionProgress` is the shared question 已做. Refresh restores it from
`quiz_practice_progress` and does not clear it. Toolbar 做题 still re-seeds any missing
answers from `overlay_quiz` on ensure/hydrate. Starting a new round (`「再来一轮」` →
config confirm → `/rounds/start`) is an explicit clear: it starts overlay 已做 empty
and clears the shared 已做. Changing subject or palace scope parks answered questions
that left the filter instead of deleting them; they return when the palace is in scope again.
Finishing one palace's ratings does not ask to clear overlay 已做; partial settlement does not ask either.
The right-side 完成 control still seeks unscored work before opening the closing slot.
The closing page is the only end-of-round surface: it has exactly two actions,
「清空做题进度」 and 「结算」. 结算 calls `/rounds/start` with the saved config, which
completes the active round and mints the next one, so it works whatever the round
state was (weak scores, pending retries, unanswered units) and cannot dead-end.
When the new round has no cards the page lands on 今天的学习 instead of an empty stage.
The page asks once whether to clear overlay 已做 for every review palace
actually involved in this round, not every palace merely selected in saved configuration. 保留 keeps
the answered records so 做题 can still be reviewed; 清空 (two presses) calls
`/overlay-quiz/drop-palaces` with those palace ids and clears the SPA mirror for them.
The closing page reports what the round earned — units rated, 已通过 / 新学 / 重练,
palaces cleared today, palace progress — and keeps leftovers on one muted status line.
Its 按学科看明细 and 下次复习 blocks are collapsed below the two actions so 结算 never
sits under a long list, and the floating feed pager steps aside on this page.

Settlement time is round-scoped and survives a restart or the next day. It is the time spent on the progress-bar queue: looking at a card, flipping, and recalling, including a leave of about three minutes. A longer absence is not backfilled. A visible window counts even when the page focus flag is false; the desktop shell reports its own window focus so a real switch away can stop after that grace. An empty round clock must not wipe the queue's card time. 「本次随心」 is unit dwell plus 做题 plus 查看宫殿. Looking at a card, flipping its nodes, and reading the back are unit dwell; flip is not added again. 「做题时间」 is only the quiz overlay, whether it was opened from the card corner badge or the toolbar. 查看宫殿 while a quiz is open stays in the round total and out of 做题时间. Seconds live on the round plan as `learning_time`. The first open of a round copies dwell segments since that round was created, then the page clock adds only later seconds so the same interval is not counted twice. Durations of at least one hour render as `H:MM:SS`; shorter times stay `M:SS`.

Leaving the settlement slot cancels that visit and does not end the round. The card’s 「返回上一张」 returns to the previous card. A round that was settled by 完成 has no cards left, so that cancel action is not rendered. The learning clock pauses on every settlement surface: the closing slot and partial settlement. After leaving those surfaces, later card dwell and 做题 still accumulate on the same `learning_time`.

The summary separates 本轮累计 from 本轮今日. The backend projects today's union of recorded intervals against the product timezone's calendar boundaries at read time, without a second persisted counter. The frontend adds only uncovered pending/in-flight/current intervals and refreshes the server date window at the study-day rollover (03:00 local). Historical scalar time without dated evidence stays in the round total and is explicitly labelled as unattributed; it must not be silently assigned to today. Stored round interval history is not truncated to the per-request upload batch limit.
