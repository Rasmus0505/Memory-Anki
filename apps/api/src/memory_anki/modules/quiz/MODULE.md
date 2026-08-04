# Module: quiz

## Status
active — owns the current question and quiz-learning contracts.

## Owns
Questions, bindings, generation workspace, wrong-question sets

## Migrates from
- palace_quiz

## Forbids
No formal review session lifecycle

## Public surface
- `public/commands.py` — write intents
- `public/queries.py` — read contracts

## Cross-module rule
Import only `memory_anki.modules.quiz.public`. Never import another module's application/infrastructure/presentation.
