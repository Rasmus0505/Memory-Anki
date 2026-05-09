# Memory Anki Architecture

## Principles
- High cohesion inside a module, low coupling across modules.
- Runtime data never lives in the repository.
- Feature behavior is expressed through explicit contracts instead of duplicated ad hoc DTOs.
- Frontend persists only UI-local temporary state; business state belongs to backend storage.

## Backend Shape
- `app`: bootstrap, DI wiring, router registration.
- `core`: config, logging, errors, clocks, shared helpers.
- `infrastructure`: database engine, filesystem adapters, external integrations.
- `modules/*/{domain,application,infrastructure,presentation}`: feature boundaries.

## Frontend Shape
- `app`: providers, router, top-level shell wiring.
- `features`: user-facing behaviors composed from entities.
- `entities`: domain-facing API/model adapters.
- `shared`: reusable UI, helpers, infrastructure wrappers.

## Rules
- Presentation can depend on application and contracts, never on another module's infrastructure internals.
- Shared utilities must stay behavior-agnostic.
- New persisted business data requires backend ownership plus tests.
- Any new module must include contracts, service tests, and boundary-safe imports.
