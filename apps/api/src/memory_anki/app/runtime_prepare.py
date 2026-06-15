from __future__ import annotations

from memory_anki.app.startup_runtime import run_prepare_runtime


def main() -> int:
    run_prepare_runtime()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
