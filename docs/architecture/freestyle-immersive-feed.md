# Freestyle Immersive Feed

Freestyle is a consumer of public learning projections. It does not own palace review scheduling.

## Palace Review Cards

- Palace cards are built only from active due review units returned by Reviews.
- Card identity carries stable `unit_id` and `unit_revision`; a permanent-mark or content change invalidates the old card immediately.
- The card displays the full palace for context while the frozen Reviews unit membership defines the rating scope.
- Freestyle starts a one-unit `freestyle_unit_review` session and uses the same rating and undo commands as formal review.
- `困难` and `忘记` reinsert the unit after at most three cards. `记得` and `轻松` finish it for the current encounter.
- Queue rebuilds exclude palaces without permanent marks.

## Permanent Marks

Permanent marks are edited in the palace document. Saving calls Content, whose transaction invokes Reviews reconciliation; the resulting state-change event invalidates formal, shelf, Today, and freestyle queues.

Temporary marks do not exist. Practice must not persist, merge, clear, or schedule any alternative mark lifecycle.

## Other Cards

Quiz, English, English Reading, and standalone Anki cards retain their own evidence. Their completion must not change a palace review unit. An Anki card may supplement a due unit card, but it never replaces that card and never carries `unit_id` or `unit_revision`.

Practice receives topology only through `memory.public.get_palace_unit_projection`. It must not import the mind-map split function, apply node-count limits, or derive due state from member nodes.
