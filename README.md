# Memory Anki

A single-machine, locally-deployed **memory palace + spaced-repetition** application. Backend is FastAPI + SQLAlchemy (SQLite); frontend is React 19 + TypeScript + Vite. In production, FastAPI serves both the JSON API (`/api/v1/*`) and the built web bundle (`/`), so the whole app runs behind a single port.

```
┌──────────────────────────────────────────────────────────┐
│ start.bat → tools/start-production.ps1                    │
│   • build web (npm run build)                             │
│   • snapshot src + dist into runtime-data/current/         │
│   • launch uvicorn memory_anki.app.main:app (port 8012)   │
│        └─ /api/v1/*  → FastAPI routers                    │
│           /          → StaticFiles(dist)                  │
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

This runs `tools/start-production.ps1`, which builds the web client, snapshots the code into `runtime-data/current/<timestamp>/` (the previous snapshot is kept for rollback), validates the runtime contract, and starts the API on `127.0.0.1:8012`. Runtime data (DB, attachments, backups, logs) lives under `%LOCALAPPDATA%\MemoryAnki` (override with the `MEMORY_ANKI_HOME` env var).

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
