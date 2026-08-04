# Module: practice

## Status
active — consumer of memory, content, quiz, and session contracts.

## Owns
Immersive freestyle queue, formal review session UX orchestration

## Migrates from
- freestyle (queue/feed)
- formal review orchestration (not scheduling math)

## Forbids
No direct ORM; compose content/memory/quiz/session public only

Practice must not split permanent-mark topology, persist review progress, or attach unit identity to quiz/Anki cards.

## Public surface
- `api.py` — queue facade for cross-context callers

## Cross-module rule
Import only `memory_anki.modules.practice.api`. Never import another module's application/infrastructure/presentation.
