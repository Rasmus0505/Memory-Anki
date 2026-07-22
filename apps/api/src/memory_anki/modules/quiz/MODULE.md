# Module: quiz

## Status
scaffolding — public surface path for concentrated refactor (branch 7.22-refactor-optimize).

## Owns
Questions, bindings, generation workspace, wrong-question sets

## Migrates from
- palace_quiz

## Forbids
No formal review session lifecycle

## Public surface
- `public/commands.py` — write intents
- `public/queries.py` — read intents
- `public/events.py` — domain events this module emits
- `public/projections.py` — stable read DTOs for other modules

## Cross-module rule
Import only `memory_anki.modules.quiz.public`. Never import another module's application/infrastructure/presentation.
