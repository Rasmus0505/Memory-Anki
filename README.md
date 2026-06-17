# Memory Anki

A single-machine, locally-deployed **memory palace + spaced-repetition** application. Backend is FastAPI + SQLAlchemy (SQLite); frontend is React 19 + TypeScript + Vite. In production, FastAPI serves both the JSON API (`/api/v1/*`) and the built web bundle (`/`), so the whole app runs behind a single port.

```
┌──────────────────────────────────────────────────────────┐
│ start.bat → tools/start_supervisor.py                     │
│   • default: rebuild current workspace and run latest     │
│   • always serve the current repo's apps/web/dist         │
│   • restart on port 8012 so rerun = latest version        │
│   • optional legacy supervisor via MEMORY_ANKI_RUN_MODE   │
└──────────────────────────────────────────────────────────┘
```

## Repository layout

```
apps/
  api/      FastAPI backend (src layout: src/memory_anki)
  web/      React + Vite frontend
  shared/   cross-app static resources (e.g. CEFR word list)
tools/      PowerShell + Python ops scripts (start, backup, architecture check)
docs/       architecture docs (architecture/README.md is the source of truth)
data/       legacy placeholder (runtime data lives in MEMORY_ANKI_HOME, gitignored)
```

Backend module shape: `src/memory_anki/modules/*/{domain,application,infrastructure,presentation}`.
Frontend shape (FSD): `src/{app,features,entities,shared}`.
See **[docs/architecture/README.md](docs/architecture/README.md)** for the principles and layering rules.

## Requirements

- Python ≥ 3.12
- Node.js (with npm) for the frontend

API keys for the AI providers (DashScope / Zhipu / SiliconFlow) are supplied via environment variables (see `apps/api/src/memory_anki/core/config.py`). There are no `.env` files in the repo; the production launcher injects them.

## Production (single command)

```
start.bat
```

This runs `tools/start_supervisor.py` (with `tools/start-production.ps1` retained as a compatibility wrapper). Runtime data (DB, attachments, backups, logs) lives under `%LOCALAPPDATA%\MemoryAnki` (override with the `MEMORY_ANKI_HOME` env var).

If you use multiple Git worktrees and want them to share one writable runtime home:

```
powershell -ExecutionPolicy Bypass -File .\tools\configure-shared-home.ps1 -Path D:\MemoryAnki-runtime
```

That writes `%LOCALAPPDATA%\MemoryAnki\shared-home.txt`, so every worktree on the same machine will use the same custom runtime home unless `MEMORY_ANKI_HOME` is explicitly set. If you do nothing, worktrees already share the default `%LOCALAPPDATA%\MemoryAnki`.

The default launcher now uses a single-version workspace-latest mode. Each time you run `start.bat`, it rebuilds the current workspace frontend, stops any old process on `127.0.0.1:8012`, and starts the backend directly from the current repo so the served site matches the current code immediately after restart.

If you still need the old immutable multi-release supervisor for maintenance or rollback experiments, you can opt in explicitly:

```
set MEMORY_ANKI_RUN_MODE=supervisor
start.bat
```

Shared-runtime rules:

- Share the whole runtime home, not only the SQLite file
- Normal lightweight read/write usage can happen from two versions at once
- Database restore now requires exclusive access to the shared runtime home
- Prefer additive schema migrations so a slightly older stable worktree can continue using the shared data

## Development (two terminals)

Terminal 1 — backend:
```
cd apps/api
python -m uvicorn --app-dir src memory_anki.app.main:app --reload --port 8012
```

Terminal 2 — frontend (dev server proxies `/api` to 127.0.0.1:8012):
```
cd apps/web
npm install
npm run dev
```

> Note: the Vite config intentionally disables HMR for stability with the mindmap editor. Refresh manually after edits.

## Testing & checks

Backend:
```
cd apps/api
pip install -r requirements-dev.txt   # adds pytest + httpx
pytest                                 # tests
ruff check src tests                   # lint
mypy                                   # type check
lint-imports                           # enforce module boundary contracts
```

Frontend:
```
cd apps/web
npm run typecheck   # tsc --noEmit
npm run lint        # eslint (includes layer boundary rules)
npm run test        # vitest run
npm run build       # tsc -b && vite build
```

`tools/check_architecture.py` enforces file-size and forbidden-import limits across both apps.

## Architecture & contributing

- Layering rules and module template: [docs/architecture/README.md](docs/architecture/README.md), [docs/architecture/module-template.md](docs/architecture/module-template.md).
- Commit conventions, branch flow, and structural rules: [CONTRIBUTING.md](CONTRIBUTING.md).
