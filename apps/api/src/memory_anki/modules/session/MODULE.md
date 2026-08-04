# Module: session

## Status
active — owns study sessions, timing, and scene attribution.

## Owns
Study sessions, timing, scene attribution

## Migrates from
- sessions

## Forbids
No FSRS math

## Public surface
- `public/queries.py` — read contracts

## Cross-module rule
Import only `memory_anki.modules.session.public`. Never import another module's application/infrastructure/presentation.
