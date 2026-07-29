# Freestyle Immersive Feed

Freestyle is a consumer of public learning projections. It does not own palace review scheduling.

## Palace Review Cards

- Palace cards are built only from active due review units returned by Reviews.
- Card identity carries stable `unit_id` and `unit_revision`; a permanent-mark change or a reconciled content demotion invalidates the old card.
- The card displays the full palace for context while the frozen Reviews unit membership defines the rating scope.
- Freestyle starts a one-unit `freestyle_unit_review` session and uses the same rating and undo commands as formal review.
- `困难` and `忘记` reinsert the unit after at most three cards. `记得` and `轻松` finish it for the current encounter.
- Queue rebuilds exclude palaces without permanent marks.
- Stale encounter or `unit_revision` mismatch is rebuildable: drop/rebuild the card or open a fresh encounter from the current Reviews projection. Practice freestyle must not hard-fail the feed on schedule/revision drift after concurrent edits.

## Permanent Marks

Permanent marks are edited in the palace document. Mark / membership changes call Content and reconcile Reviews immediately; content-only autosaves may persist `editor_doc` without schedule reconcile. When reconcile runs (immediate mark path, or batched leave/idle/explicit for content demotion), the state-change event invalidates formal, shelf, Today, and freestyle queues.

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

Settings UI groups quiz controls under a dedicated「题目刷题」section in `FreestyleFeedSettingsDialog`.
