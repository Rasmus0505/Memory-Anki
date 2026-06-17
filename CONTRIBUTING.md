# Contributing to Memory Anki

## Branching And Commits

- Work on a feature branch off `main`; keep one logical change per branch.
- Keep pull requests focused on one backend module, frontend feature, or infrastructure concern.
- Use Conventional Commits. Good examples:
  - `feat(palaces): support batch segment reordering`
  - `fix(reviews): correct ebbinghaus anchor on early review`
  - `refactor(ai): extract shared scenario runtime resolver`
  - `chore(git): ignore AI tooling artifacts`
  - `docs: refresh contributor setup`
- Scope should usually match the backend module or frontend feature, such as `reviews`, `english-reading`, or `palace-edit`.

## Parallel Development Rules

- Rebase or merge the latest `main` before opening a pull request.
- Avoid broad drive-by refactors while shipping a feature; they make parallel reviews harder.
- Do not change shared contracts, generated API types, schema migrations, or runtime storage layout without calling it out in the PR description.
- Backend work should stay inside the owning module unless the change is explicitly cross-cutting.
- Frontend work should follow the FSD layers: `app > features > entities > shared`.
- If two developers need the same helper, move it to the lowest valid shared layer instead of importing between features.

## Layering Rules

The project enforces module boundaries with automated tooling. Do not work around them.

### Backend: `apps/api`

- Modules follow `domain / application / infrastructure / presentation`.
- `application` must not import `presentation`.
- `domain` must not import `application` or `presentation`.
- Presentation talks to application services; it should not reach into another module's infrastructure internals.
- New persisted data must be added in the owning module, registered through a schema migration, and covered by tests.
- Shared-runtime compatibility is part of the backend contract. Default to additive migrations: new tables, nullable columns, indexes, or backfilled defaults.
- Destructive migrations are blocked by `tools/check_architecture.py` unless the migration explicitly documents `memory-anki: allow-destructive-migration` with a justification.

### Frontend: `apps/web`

- Use npm only: `npm ci`, `npm run ...`, and `package-lock.json`.
- Layers are `app > features > entities > shared`.
- Lower layers may not import higher layers.
- Features depend on `entities` and `shared`, not on each other.
- `eslint-plugin-boundaries` guards these rules.

### Both

- Keep `tools/check_architecture.py` green.
- Keep file sizes within the repository limits enforced by the architecture check.
- Prefer small, reviewable pull requests over mixed feature/refactor bundles.

## Definition Of Done

A change is ready to merge when the checks for the touched area pass.

Backend:

```powershell
cd apps/api
python -m pip install -r requirements-dev.txt
python -m pip install -e .
pytest
ruff check src tests
mypy
lint-imports
python ..\..\tools\check_architecture.py
```

Frontend:

```powershell
cd apps/web
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
```

Repository hygiene:

```powershell
git status --short
git ls-files -ci --exclude-standard
```

The second command must print nothing. If it prints files, something ignored is still tracked and must be removed from the Git index.

## Runtime And Secrets

- Runtime data is never committed. It lives under `MEMORY_ANKI_HOME`, defaulting to `%LOCALAPPDATA%\MemoryAnki` on Windows.
- Two worktrees may share one runtime home for day-to-day use, but high-risk operations such as database restore require exclusive access.
- Local secrets live in `.env`, copied from `.env.example`; real API keys must never be committed.
- Do not stage `.tmp/`, `.playwright-mcp/`, `.specstory/`, `.claude/`, `.reasonix/`, `.codegraph/`, `output/`, `node_modules/`, databases, logs, or build artifacts.
- Architecture intent lives in `docs/architecture/`; that README is the source of truth for layering rules.
