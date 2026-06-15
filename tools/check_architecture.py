from __future__ import annotations

import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
WEB_SRC = REPO_ROOT / "apps" / "web" / "src"
API_SRC = REPO_ROOT / "apps" / "api" / "src" / "memory_anki"
ALEMBIC_VERSIONS = REPO_ROOT / "apps" / "api" / "alembic" / "versions"
WEB_LAYER_DIRS = ("app", "features", "entities")

FORBIDDEN_WEB_IMPORTS = {
    "@/shared/api/client": "Pages and features must import scoped API wrappers or contracts instead of the legacy shared/api/client aggregator.",
}

MAX_WEB_FILE_LINES = 750
MAX_API_FILE_LINES = 800
DESTRUCTIVE_MIGRATION_ALLOW_MARKER = "memory-anki: allow-destructive-migration"
DESTRUCTIVE_MIGRATION_PATTERNS = {
    "op.drop_column(": "drop columns",
    "drop column ": "drop columns",
    "op.drop_table(": "drop tables",
    "drop table ": "drop tables",
    "op.alter_column(": "alter existing columns",
    "alter column ": "alter existing columns",
    "rename column ": "rename columns",
    "op.rename_table(": "rename tables",
    "rename table ": "rename tables",
}


def iter_files(root: Path, suffixes: tuple[str, ...]):
    for path in root.rglob("*"):
        if path.is_file() and path.suffix in suffixes and "__pycache__" not in path.parts:
            yield path


def check_forbidden_imports(errors: list[str]) -> None:
    for path in iter_files(WEB_SRC, (".ts", ".tsx")):
        if not path.relative_to(WEB_SRC).parts or path.relative_to(WEB_SRC).parts[0] not in WEB_LAYER_DIRS:
            continue
        content = path.read_text(encoding="utf-8")
        for forbidden_import, message in FORBIDDEN_WEB_IMPORTS.items():
            if forbidden_import in content:
                relative = path.relative_to(REPO_ROOT)
                errors.append(f"{relative}: {message}")


def check_file_sizes(errors: list[str]) -> None:
    for path in iter_files(WEB_SRC, (".ts", ".tsx")):
        line_count = len(path.read_text(encoding="utf-8").splitlines())
        if line_count > MAX_WEB_FILE_LINES:
            relative = path.relative_to(REPO_ROOT)
            errors.append(
                f"{relative}: exceeds {MAX_WEB_FILE_LINES} lines ({line_count}); split the page/hook/component into smaller modules."
            )

    for path in iter_files(API_SRC, (".py",)):
        line_count = len(path.read_text(encoding="utf-8").splitlines())
        if line_count > MAX_API_FILE_LINES:
            relative = path.relative_to(REPO_ROOT)
            errors.append(
                f"{relative}: exceeds {MAX_API_FILE_LINES} lines ({line_count}); split the module service/router into layered submodules."
            )


def check_runtime_data_ignored(errors: list[str]) -> None:
    gitignore_path = REPO_ROOT / ".gitignore"
    gitignore = gitignore_path.read_text(encoding="utf-8")
    expected_entries = ["/data/", "*.db", "*.sqlite3", "*.log"]
    for entry in expected_entries:
        if entry not in gitignore:
            errors.append(f".gitignore: missing runtime-data ignore entry `{entry}`")


def check_forward_compatible_migrations(errors: list[str]) -> None:
    for path in ALEMBIC_VERSIONS.glob("*.py"):
        content = path.read_text(encoding="utf-8")
        normalized = content.casefold()
        if DESTRUCTIVE_MIGRATION_ALLOW_MARKER in normalized:
            continue
        for pattern, description in DESTRUCTIVE_MIGRATION_PATTERNS.items():
            if pattern in normalized:
                relative = path.relative_to(REPO_ROOT)
                errors.append(
                    f"{relative}: destructive migration pattern `{pattern}` is not allowed by default; "
                    f"prefer additive migrations for shared-runtime compatibility, or add `{DESTRUCTIVE_MIGRATION_ALLOW_MARKER}` with a justification."
                )
                break


def main() -> int:
    errors: list[str] = []
    check_forbidden_imports(errors)
    check_file_sizes(errors)
    check_runtime_data_ignored(errors)
    check_forward_compatible_migrations(errors)

    if errors:
        print("Architecture check failed:")
        for error in errors:
            print(f"- {error}")
        return 1

    print("Architecture check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
