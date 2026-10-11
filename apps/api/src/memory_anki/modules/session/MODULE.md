# Module: session

## Status
active — owns the in-process live study room (presence).

## Owns
The in-process live study room (presence, controller lease, SSE).

## Migrates from
- sessions

## Forbids
No FSRS math

## Public surface
- `api.py` / `public/__init__.py` — live study room commands and stream

## Cross-module rule
Import only `memory_anki.modules.session.public`. Never import another module's application/infrastructure/presentation.
