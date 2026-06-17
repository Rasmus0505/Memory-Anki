# Memory Anki

Memory Anki is a single-machine, locally deployed memory palace and spaced-repetition app. The backend is FastAPI + SQLAlchemy on SQLite; the frontend is React 19 + TypeScript + Vite. In production, FastAPI serves both the JSON API (`/api/v1/*`) and the built web bundle (`/`) behind one local port.

## Repository Layout

```text
apps/
  api/      FastAPI backend, src layout: src/memory_anki
  web/      React + Vite frontend
  shared/   cross-app static resources, such as the CEFR word list
tools/      startup, backup, and architecture-check scripts
docs/       architecture docs; docs/architecture/README.md is authoritative
data/       legacy placeholder; runtime data lives in MEMORY_ANKI_HOME
```

Backend modules follow `src/memory_anki/modules/*/{domain,application,infrastructure,presentation}`. Frontend code follows `src/{app,features,entities,shared}`. See [docs/architecture/README.md](docs/architecture/README.md) before changing module boundaries.

## Requirements

- Python 3.12+
- Node.js 24 with npm 11
- Git

The frontend package manager is npm. Use `apps/web/package-lock.json` as the only committed frontend lockfile.

AI provider keys are read from environment variables or a local `.env` file. Copy `.env.example` to `.env` for local development and fill only the providers you use. Never commit real secrets.

## First-Time Development

Install backend dependencies:

```powershell
cd apps/api
python -m pip install -r requirements-dev.txt
python -m pip install -e .
```

Install frontend dependencies:

```powershell
cd apps/web
npm ci
```

Run the app in two terminals.

Terminal 1, backend:

```powershell
cd apps/api
python -m uvicorn --app-dir src memory_anki.app.main:app --reload --port 8012
```

Terminal 2, frontend:

```powershell
cd apps/web
npm run dev
```

The Vite dev server proxies `/api` to `127.0.0.1:8012`. HMR is intentionally disabled for stability with the mindmap editor; refresh manually after edits.

## Production Start

On Windows:

```powershell
.\start.bat
```

This runs `tools/start_supervisor.py`, rebuilds the current workspace frontend, stops any old process on `127.0.0.1:8012`, and starts the backend from the current repo so the served site matches the checked-out code.

Runtime data, attachments, backups, and logs live under `%LOCALAPPDATA%\MemoryAnki` by default. Override that with `MEMORY_ANKI_HOME` when you need a custom runtime home.

For multiple worktrees sharing one runtime home:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\configure-shared-home.ps1 -Path D:\MemoryAnki-runtime
```

Shared-runtime rules:

- Share the whole runtime home, not only the SQLite file.
- Normal lightweight read/write usage can happen from two versions at once.
- Database restore requires exclusive access to the shared runtime home.
- Prefer additive schema migrations so short-lived stable worktrees can keep using the shared data.

## Testing And Checks

Backend:

```powershell
cd apps/api
pytest
ruff check src tests
mypy
lint-imports
python ..\..\tools\check_architecture.py
```

Frontend:

```powershell
cd apps/web
npm run typecheck
npm run lint
npm run test
npm run build
```

GitHub Actions runs these checks on pull requests and pushes to `main`.

## Collaboration Rules

- Work from a feature branch off `main`.
- Keep each pull request focused on one module, feature, or fix.
- Do not commit runtime data, SQLite databases, logs, `.env`, AI-tooling output, `node_modules`, build output, or local caches.
- Before pushing, verify `git ls-files -ci --exclude-standard` prints nothing.
- Follow [CONTRIBUTING.md](CONTRIBUTING.md) for branch flow, boundaries, and definition of done.
