# Contributing to Memory Anki

## Branching & commits

- Work on a feature branch off `main`. Keep one logical change per branch.
- Use **Conventional Commits** messages. Avoid content-free messages like `1`.
  - `feat(palaces): support batch segment reordering`
  - `fix(reviews): correct ebbinghaus anchor on early review`
  - `refactor(ai): extract shared scenario runtime resolver`
  - `chore(git): ignore AI tooling artifacts`
  - `docs: add root README and contributing guide`
- Scope in the conventional prefix should usually match the backend module or frontend feature (`feat(reviews)`, `fix(english-reading)`, `feat(palace-edit)`).

## Layering rules (enforced)

The project enforces module boundaries with automated tooling. Do not work around them.

### Backend — `apps/api`
- Modules follow `domain / application / infrastructure / presentation`.
- `application` **must not** import `presentation`.
- `domain` **must not** import `application` or `presentation`.
- Presentation talks to application services; it should not reach into another module's infrastructure internals.
- New persisted data: add the model in the owning module, register its schema migration, and cover the read/write path with tests.
- Run `lint-imports` before pushing — it fails the build on boundary violations.

### Frontend — `apps/web`
- Layers are `app > features > entities > shared`. Lower layers may not import higher ones (`shared` may not import `features`/`app`).
- `features` depend on `entities` and `shared`, not on each other. If two features need the same logic, lift it to `entities` or `shared`.
- `eslint-plugin-boundaries` guards these rules.

### Both
- Keep `tools/check_architecture.py` green (file size caps + forbidden imports).

## Definition of done

A change is ready to merge when, for the part of the codebase it touches:

**Backend**
- `pytest` passes
- `ruff check src tests` clean
- `mypy` clean
- `lint-imports` clean

**Frontend**
- `npm run typecheck` clean
- `npm run lint` clean
- `npm run test` passes
- `npm run build` succeeds

## Where things live

- Runtime data is **never** committed. It lives under `MEMORY_ANKI_HOME` (default `%LOCALAPPDATA%\MemoryAnki`) and is gitignored.
- AI/agent tooling artifacts (`.specstory/`, `.claude/`, `.reasonix/`, `.codegraph/`) are gitignored — do not stage them.
- Architecture intent lives in `docs/architecture/`; that README is the authoritative source for layering rules.
