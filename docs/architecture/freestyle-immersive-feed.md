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
the next palace to become active. Retry placement targets at most three usable intervening cards,
with an explicit shorter-gap explanation when fewer cards remain.

The top HUD opens a large two-pane “本轮安排” dialog. The left pane groups stable plan entries by
palace and supports jump, drag, batch exclude/restore, and reset-round. The right pane edits the
complete `FreestyleFeedConfig`; saving preserves finished/excluded records and only reorders
unstarted work. Configuration and round state remain client-local per device/day.

## Palace Review Cards

- Palace cards are built only from active due review units returned by Reviews.
- Card identity carries stable `unit_id` and `unit_revision`; a permanent-mark change or a reconciled content demotion invalidates the old card.
- The card displays the full palace for context while the frozen Reviews unit membership defines the rating scope.
- Freestyle starts a one-unit `freestyle_unit_review` session and uses the same rating and undo commands as formal review.
- `困难` and `忘记` reinsert the unit after at most three cards. `记得` and `轻松` finish it for the current encounter.
- `due_first_then_expand` and `all_content_due_weighted` mark fill cards explicitly; their freestyle
  session start carries `allow_not_due` so the shared review service does not reject a configured
  non-due card. Formal review calls keep the default due-only guard.
- Queue rebuilds exclude palaces without permanent marks.
- Stale encounter or `unit_revision` mismatch is rebuildable: drop/rebuild the card or open a fresh encounter from the current Reviews projection. Practice freestyle must not hard-fail the feed on schedule/revision drift after concurrent edits.

## Permanent Marks

Permanent marks are edited in the palace document. While the user is still in permanent-mark mode, toggles only update `editor_doc` (plain autosave) so many marks can be changed continuously without rebuilding freestyle. Schedule reconcile runs when the mark pass finishes (exit permanent-mark mode / `mark_change`), when returning to review, or on editor leave/idle. Content-only autosaves never reconcile schedule. When reconcile runs, freestyle queue rebuild is deferred until the card leaves inline edit (`return_to_review` / leave) so continuous mark editing is not interrupted mid-pass.

Typing autosaves are quiet and debounced (2s idle) so a return-to-review flush after a same-doc autosave is the only save the user waits on — and even that is optimistic: clicking 返回学习 switches to review immediately, saves in the background, and adopts the saved doc when it settles. A failed save returns to edit mode with local content intact. If the user re-enters edit before the return save settles, the freestyle queue rebuild is deferred again until the next leave.

Temporary marks do not exist. Practice must not persist, merge, clear, or schedule any alternative mark lifecycle.

## Other Cards

Quiz, English, English Reading, and standalone Anki cards retain their own evidence. Their completion must not change a palace review unit. An Anki card may supplement a due unit card, but it never replaces that card and never carries `unit_id` or `unit_revision`.

Practice receives topology only through `memory.public.get_palace_unit_projection`. It must not import the mind-map split function, apply node-count limits, or derive due state from member nodes.

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
