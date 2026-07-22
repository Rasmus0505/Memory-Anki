# Memory Anki Agent Rules

- Read `AI_PROJECT_CONTEXT.md` before structural changes and use `docs/architecture/README.md` as the current dependency map.
- Treat the existing working tree as shared work: inspect `git status` first, never revert unrelated changes, and keep file ownership explicit.
- This is a private two-device Windows product. Never hard-code one machine's paths. Runtime data is configured per machine in `local-config/memory-anki.local.json` (`local_app_home`); use only `vol:MemoryAnki/memory anki data` on the shared USB stick (not Baidu `MemoryAnki-Sync`). Keep `sync_enabled` false unless the user explicitly re-enables USB-local sync. Fallback: `MEMORY_ANKI_HOME` / `%LOCALAPPDATA%\MemoryAnki`.
- PWA and desktop use the same frontend and local backend. Do not create a separate mobile application, public SaaS backend, or cloud data dependency.
- Preserve dependency direction: presentation/UI composes use cases; domain/document code stays framework-free; cross-module calls use public facades, ports, or events.
- New asynchronous entity-scoped work must carry stable owner/operation identity so stale requests cannot update another entity.
- Run `python tools/quality_gate.py` while iterating and `python tools/quality_gate.py --full` before handoff when the environment supports the full suite.
- After changes that can affect runtime startup, packaging, migrations, dependencies, frontend build output, or launcher scripts, run `python tools/quality_gate.py --launchers`. This is a disruptive Windows smoke test: it really runs `start-pwa.bat` and `start-desktop.bat`, verifies the API and Electron startup, cleans up the test desktop process, and restores the shared PWA service.
- If architecture changes, update the relevant file under `docs/architecture/` and extend `tools/check_architecture.py` with a focused regression test.
