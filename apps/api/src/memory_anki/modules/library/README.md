# library

## Responsibility

Owns: subjects, chapters, source materials, content catalog.

Does not own: memory structures, questions, training progress.

## Public use cases

Only symbols exported by `public.py` are available to other modules. Add each public command or query to `docs/architecture/use-cases.yaml` before exposing it.

## Data ownership

Tables owned by this module must use the prefixes declared in `docs/architecture/system-map.yaml`. Cross-module references store stable identifiers rather than ORM relationships.

## Dependencies

Allowed business-module dependencies: none. Imports must target the dependency's `public.py` or `contract` package.

## Invariants

- Presentation delegates to application use cases.
- Application remains independent of FastAPI, SQLAlchemy, filesystem and process globals.
- Writes use the module-owned unit of work; reads never commit or repair data.
- Asynchronous entity work carries operation and owner revision identity.

## Change entry points

Start at `public.py` and the registered use case, then follow its application handler and tests. Infrastructure adapters are replaceable details.

## Verification

Run `python tools/check_architecture_v3.py` and the focused module tests before the repository quality gate.
