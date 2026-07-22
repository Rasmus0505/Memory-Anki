# Module: practice

## Status
scaffolding — public surface path for concentrated refactor (branch 7.22-refactor-optimize).

## Owns
Immersive freestyle queue, formal review session UX orchestration

## Migrates from
- freestyle (queue/feed)
- formal review orchestration (not FSRS math)

## Forbids
No direct ORM; compose content/memory/quiz/session public only

## Public surface
- `public/commands.py` — write intents
- `public/queries.py` — read intents
- `public/events.py` — domain events this module emits
- `public/projections.py` — stable read DTOs for other modules

## Cross-module rule
Import only `memory_anki.modules.practice.public`. Never import another module's application/infrastructure/presentation.
