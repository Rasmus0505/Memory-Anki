from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

REPO_ROOT = Path(__file__).resolve().parents[1]
API_ROOT = REPO_ROOT / "apps" / "api"
WEB_ROOT = REPO_ROOT / "apps" / "web"


@dataclass(frozen=True)
class QualityStep:
    name: str
    command: tuple[str, ...]
    cwd: Path
    env: dict[str, str] | None = None


def _executable(name: str) -> str:
    resolved = shutil.which(name)
    if resolved is None:
        raise RuntimeError(f"Required executable is unavailable: {name}")
    return resolved


def _python(*args: str) -> tuple[str, ...]:
    return (sys.executable, *args)


def _backend_steps(*, full: bool) -> list[QualityStep]:
    import_env = dict(os.environ)
    import_env["PYTHONPATH"] = str(API_ROOT / "src")
    steps = [
        QualityStep("architecture", _python("tools/check_architecture.py"), REPO_ROOT),
        QualityStep(
            "architecture tests",
            _python("-m", "pytest", "tools/test_check_architecture.py", "-q"),
            REPO_ROOT,
        ),
        QualityStep("backend ruff", _python("-m", "ruff", "check", "src", "tests"), API_ROOT),
        QualityStep("backend mypy", _python("-m", "mypy"), API_ROOT),
        QualityStep("backend imports", (_executable("lint-imports"),), API_ROOT, import_env),
    ]
    if full:
        steps.append(QualityStep("backend tests", _python("-m", "pytest"), API_ROOT))
    return steps


def _frontend_steps(*, full: bool) -> list[QualityStep]:
    npm = _executable("npm.cmd" if os.name == "nt" else "npm")
    steps = [
        QualityStep("frontend lint", (npm, "run", "lint"), WEB_ROOT),
        QualityStep("frontend typecheck", (npm, "run", "typecheck"), WEB_ROOT),
    ]
    if full:
        steps.extend(
            [
                QualityStep("frontend tests", (npm, "run", "test"), WEB_ROOT),
                QualityStep("frontend build", (npm, "run", "build"), WEB_ROOT),
                QualityStep("frontend e2e smoke", (npm, "run", "e2e"), WEB_ROOT),
            ]
        )
    return steps


def build_steps(*, area: str, full: bool, launchers: bool = False) -> list[QualityStep]:
    steps: list[QualityStep] = []
    if area in {"all", "backend"}:
        steps.extend(_backend_steps(full=full))
    if area in {"all", "frontend"}:
        steps.extend(_frontend_steps(full=full))
    if launchers:
        steps.append(
            QualityStep("Windows launcher smoke", _python("tools/launcher_smoke.py"), REPO_ROOT)
        )
    return steps


def run_steps(steps: Sequence[QualityStep]) -> int:
    for index, step in enumerate(steps, start=1):
        print(f"[{index}/{len(steps)}] {step.name}: {' '.join(step.command)}", flush=True)
        completed = subprocess.run(step.command, cwd=step.cwd, env=step.env, check=False)
        if completed.returncode != 0:
            print(f"Quality gate failed at: {step.name}", file=sys.stderr)
            return completed.returncode
    print("Quality gate passed.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the canonical Memory Anki quality gate.")
    parser.add_argument("--area", choices=("all", "backend", "frontend"), default="all")
    parser.add_argument("--full", action="store_true", help="Also run full tests and frontend build.")
    parser.add_argument(
        "--launchers",
        action="store_true",
        help="Run disruptive Windows smoke tests for start-pwa.bat and start-desktop.bat.",
    )
    args = parser.parse_args()
    return run_steps(build_steps(area=args.area, full=args.full, launchers=args.launchers))


if __name__ == "__main__":
    raise SystemExit(main())