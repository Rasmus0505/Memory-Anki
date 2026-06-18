from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
WEB_SRC = REPO_ROOT / "apps" / "web" / "src"
WEB_ROOT = REPO_ROOT / "apps" / "web"
API_SRC = REPO_ROOT / "apps" / "api" / "src" / "memory_anki"
ALEMBIC_VERSIONS = REPO_ROOT / "apps" / "api" / "alembic" / "versions"
PALACE_QUIZ_APPLICATION = API_SRC / "modules" / "palace_quiz" / "application"
SETTINGS_MODULE = API_SRC / "modules" / "settings"
WEB_LAYER_DIRS = ("app", "features", "entities", "shared")
WEB_API_PORT = "8012"
WEB_API_BASE_URL = f"http://127.0.0.1:{WEB_API_PORT}"

FORBIDDEN_WEB_IMPORTS = {
    "@/shared/api/client": "Pages and features must import scoped API wrappers or contracts instead of the legacy shared/api/client aggregator.",
    "@/shared/api/modules/palaces": "palace API wrappers belong in entities/palace/api; import preview/job wrappers belong in entities/knowledge-import/api.",
    "@/app/": "features, entities, and shared modules must not import app-layer code; move shared routing/state helpers out of app/router.",
}

FORBIDDEN_SHARED_IMPORTS = ("@/app/", "@/features/")
FORBIDDEN_DASHBOARD_IMPORTS = {
    "@/shared/api/modules/dashboard": "dashboard API wrappers belong in features/dashboard/api; import the feature-scoped API instead.",
}
FORBIDDEN_REVIEW_API_IMPORTS = {
    "@/shared/api/modules/reviews": "review API wrappers belong in features/review/api; import the feature-scoped API instead.",
}
FORBIDDEN_REMOVED_SHARED_API_MODULES = {
    "aiLogs.ts": "AI log API wrappers belong in entities/ai-log/api.",
    "dashboard.ts": "dashboard API wrappers belong in features/dashboard/api.",
    "knowledge.ts": "knowledge API wrappers belong in entities/knowledge/api.",
    "palaces.ts": "palace API wrappers belong in entities/palace/api; import preview/job wrappers belong in entities/knowledge-import/api.",
    "profile.ts": "profile API wrappers belong in features/profile/api or entity-owned preference/settings APIs.",
    "quizzes.ts": "quiz question and generation API wrappers belong in entities/quiz/api.",
    "reviews.ts": "review API wrappers belong in features/review/api.",
    "runtime.ts": "runtime API wrappers belong in entities/runtime/api.",
    "voiceCoach.ts": "voice coach API wrappers belong in features/voice-coach/api.",
}
FORBIDDEN_REMOVED_SHARED_API_DIRS = {
    "palaces": "palace API submodules belong in entities/palace/api; import preview/job submodules belong in entities/knowledge-import/api.",
}
FORBIDDEN_REMOVED_FEATURE_API_FILES = {
    "features/palace-quiz/api/quizApi.ts": "quiz question and generation API wrappers belong in entities/quiz/api; palace-quiz may keep only page-specific API composition.",
    "features/mini-palace/api/miniPalaceApi.ts": "mini palace API wrappers are cross-feature entity endpoints; keep them in entities/mini-palace/api.",
    "features/palace-segments/api/palaceSegmentsApi.ts": "palace segment API wrappers are cross-feature entity endpoints; keep them in entities/palace-segment/api.",
    "entities/palace/api/structureApi.ts": "split palace structure API wrappers by owner: entities/mini-palace, entities/palace-segment, entities/palace/api/stateApi, or practiceApi.",
}
FORBIDDEN_REMOVED_FEATURE_FILES = {
    "features/palace-edit/components/PalaceMindMapImportDrawer.tsx": "shared mind-map import UI belongs in features/mindmap-import, not palace-edit.",
    "features/palace-edit/components/palace-import-drawer": "shared mind-map import drawer internals belong in features/mindmap-import, not palace-edit.",
    "features/palace-edit/hooks/useMindMapImport.ts": "shared mind-map import workflow belongs in features/mindmap-import, not palace-edit.",
    "features/palace-edit/hooks/useImportApplyController.ts": "shared mind-map import workflow belongs in features/mindmap-import, not palace-edit.",
    "features/palace-edit/hooks/useImportBatchState.ts": "shared mind-map import workflow belongs in features/mindmap-import, not palace-edit.",
    "features/palace-edit/hooks/useImportJobController.ts": "shared mind-map import workflow belongs in features/mindmap-import, not palace-edit.",
    "features/palace-edit/hooks/import-job": "shared mind-map import job runtime belongs in features/mindmap-import, not palace-edit.",
    "features/palace-edit/hooks/mindmap-import-utils.ts": "shared mind-map import workflow belongs in features/mindmap-import, not palace-edit.",
    "features/palace-edit/model/mindmap-import.ts": "shared mind-map import model belongs in features/mindmap-import, not palace-edit.",
    "features/palace-edit/model/mindmap-import-types.ts": "shared mind-map import model belongs in features/mindmap-import, not palace-edit.",
}
FORBIDDEN_PRODUCTION_ENTITY_API_DEEP_IMPORTS = {
    "@/entities/palace/api/catalogApi": "production code must import palace APIs through entities/palace/api, not internal API files.",
    "@/entities/palace/api/editorApi": "production code must import palace APIs through entities/palace/api, not internal API files.",
    "@/entities/palace/api/practiceApi": "production code must import palace APIs through entities/palace/api, not internal API files.",
    "@/entities/palace/api/stateApi": "production code must import palace APIs through entities/palace/api, not internal API files.",
    "@/entities/palace/api/structureApi": "production code must not recreate the removed palace structure API bucket.",
    "@/entities/mini-palace/api/miniPalaceApi": "production code must import mini-palace APIs through entities/mini-palace/api.",
    "@/entities/palace-segment/api/palaceSegmentsApi": "production code must import palace segment APIs through entities/palace-segment/api.",
}
FORBIDDEN_PRODUCTION_FEATURE_DEEP_IMPORTS = {
    "@/features/mindmap-import/hooks/": "production consumers must import mind-map import workflow through features/mindmap-import.",
    "@/features/mindmap-import/components/": "production consumers must import mind-map import UI through features/mindmap-import.",
    "@/features/mindmap-import/model/": "production consumers must import mind-map import contracts through features/mindmap-import.",
}
FORBIDDEN_ROUTER_RESIDENT_NAMES = {
    "DashboardPage",
    "PalaceListPage",
    "PalaceShelfPage",
    "palace-view-settings",
}
FORBIDDEN_ROUTER_RESIDENT_DIRS = {"palace-list"}
FORBIDDEN_SHARED_LOCAL_STORAGE_KEYS = (
    "memory_anki_dashboard_total_duration_filter",
    "palace_list_view_settings",
    "palace_shelf_view_settings",
)

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
        relative = path.relative_to(WEB_SRC).as_posix()
        if not path.relative_to(WEB_SRC).parts or path.relative_to(WEB_SRC).parts[0] not in WEB_LAYER_DIRS:
            continue
        content = path.read_text(encoding="utf-8")
        for forbidden_import, message in FORBIDDEN_WEB_IMPORTS.items():
            if forbidden_import == "@/app/" and relative.startswith("app/"):
                continue
            if forbidden_import in content:
                errors.append(f"{relative}: {message}")
        if relative.startswith("features/dashboard/"):
            for forbidden_import, message in FORBIDDEN_DASHBOARD_IMPORTS.items():
                if forbidden_import in content:
                    errors.append(f"{relative}: {message}")
        if relative.startswith("features/review/") or relative.startswith("app/router/"):
            for forbidden_import, message in FORBIDDEN_REVIEW_API_IMPORTS.items():
                if forbidden_import in content:
                    errors.append(f"{relative}: {message}")
        if relative.startswith("shared/"):
            for forbidden_prefix in FORBIDDEN_SHARED_IMPORTS:
                if forbidden_prefix in content:
                    errors.append(
                        f"{relative}: shared modules must not import app or feature modules; move feature-specific logic out of shared."
                    )
                    break


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


def check_router_residency(errors: list[str]) -> None:
    router_dir = WEB_SRC / "app" / "router"
    for path in router_dir.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(WEB_SRC).as_posix()
        stem = path.stem
        if stem in FORBIDDEN_ROUTER_RESIDENT_NAMES:
            errors.append(
                f"{relative}: business page code must live in features/*; app/router is only for route wiring and redirects."
            )
        if any(part in FORBIDDEN_ROUTER_RESIDENT_DIRS for part in path.relative_to(router_dir).parts):
            errors.append(
                f"{relative}: palace catalog components must live in features/palace-catalog, not app/router."
            )


def check_shared_local_storage_facade(errors: list[str]) -> None:
    path = WEB_SRC / "shared" / "lib" / "localStorage.ts"
    content = path.read_text(encoding="utf-8")
    for storage_key in FORBIDDEN_SHARED_LOCAL_STORAGE_KEYS:
        if storage_key in content:
            errors.append(
                f"shared/lib/localStorage.ts: must not hard-code business preference key `{storage_key}`; "
                "pass explicit preference ownership from entities/preferences or the caller."
            )
    forbidden_registry = WEB_SRC / "shared" / "preferences" / "localPreferenceRegistry.ts"
    if forbidden_registry.exists():
        errors.append(
            "shared/preferences/localPreferenceRegistry.ts: removed transition registry must stay deleted; "
            "callers pass explicit backend preference ownership to shared/lib/localStorage."
        )


def check_removed_shared_api_modules(errors: list[str]) -> None:
    modules_dir = WEB_SRC / "shared" / "api" / "modules"
    for filename, message in FORBIDDEN_REMOVED_SHARED_API_MODULES.items():
        if (modules_dir / filename).exists():
            errors.append(f"shared/api/modules/{filename}: {message}")

    for dirname, message in FORBIDDEN_REMOVED_SHARED_API_DIRS.items():
        if (modules_dir / dirname).exists():
            errors.append(f"shared/api/modules/{dirname}/: {message}")

    for relative, message in FORBIDDEN_REMOVED_FEATURE_API_FILES.items():
        if (WEB_SRC / relative).exists():
            errors.append(f"{relative}: {message}")

    for relative, message in FORBIDDEN_REMOVED_FEATURE_FILES.items():
        if (WEB_SRC / relative).exists():
            errors.append(f"{relative}: {message}")


def is_frontend_test_file(relative: str) -> bool:
    name = Path(relative).name
    return (
        ".test." in name
        or ".spec." in name
        or name.endswith(".test-support.tsx")
        or name.endswith(".test-support.ts")
        or name.endswith(".test-utils.tsx")
        or name.endswith(".test-utils.ts")
    )


def check_frontend_public_api_surfaces(errors: list[str]) -> None:
    for path in iter_files(WEB_SRC, (".ts", ".tsx")):
        relative = path.relative_to(WEB_SRC).as_posix()
        if is_frontend_test_file(relative):
            continue
        if relative.startswith("entities/") and "/api/" in relative:
            continue
        content = path.read_text(encoding="utf-8")
        for forbidden_import, message in FORBIDDEN_PRODUCTION_ENTITY_API_DEEP_IMPORTS.items():
            if forbidden_import in content:
                errors.append(f"{relative}: {message}")
        if not relative.startswith("features/mindmap-import/"):
            for forbidden_import, message in FORBIDDEN_PRODUCTION_FEATURE_DEEP_IMPORTS.items():
                if forbidden_import in content:
                    errors.append(f"{relative}: {message}")


def check_runtime_data_ignored(errors: list[str]) -> None:
    gitignore_path = REPO_ROOT / ".gitignore"
    gitignore = gitignore_path.read_text(encoding="utf-8")
    expected_entries = ["/data/", "*.db", "*.sqlite3", "*.log", "*.egg-info/"]
    for entry in expected_entries:
        if entry not in gitignore:
            errors.append(f".gitignore: missing runtime-data ignore entry `{entry}`")


def check_frontend_config_contract(errors: list[str]) -> None:
    package_json = json.loads((WEB_ROOT / "package.json").read_text(encoding="utf-8"))
    scripts = package_json.get("scripts", {})
    openapi_script = str(scripts.get("openapi:types", ""))
    if f"{WEB_API_BASE_URL}/openapi.json" not in openapi_script or "127.0.0.1:8000/openapi.json" in openapi_script:
        errors.append(
            "apps/web/package.json: openapi:types must target the backend dev port "
            f"127.0.0.1:{WEB_API_PORT}."
        )

    typecheck_script = str(scripts.get("typecheck", ""))
    if typecheck_script != "tsc -b --noEmit":
        errors.append(
            "apps/web/package.json: typecheck must use `tsc -b --noEmit` so it checks the "
            "same project references as build."
        )

    build_script = str(scripts.get("build", ""))
    if not build_script.strip().startswith("tsc -b"):
        errors.append("apps/web/package.json: build must start with `tsc -b`.")

    package_manager = str(package_json.get("packageManager", ""))
    if not package_manager.startswith("npm@"):
        errors.append("apps/web/package.json: packageManager must remain npm-only.")

    vite_config = (WEB_ROOT / "vite.config.ts").read_text(encoding="utf-8")
    api_proxy_pattern = re.compile(
        rf"['\"]\/api['\"]\s*:\s*\{{[^}}]*target\s*:\s*['\"]{re.escape(WEB_API_BASE_URL)}['\"]",
        re.DOTALL,
    )
    if not api_proxy_pattern.search(vite_config):
        errors.append(
            f"apps/web/vite.config.ts: dev proxy must target backend port {WEB_API_PORT}."
        )

    try:
        tracked_files = set(
            subprocess.check_output(
                ["git", "ls-files"],
                cwd=REPO_ROOT,
                text=True,
                stderr=subprocess.DEVNULL,
            ).splitlines()
        )
    except Exception as exc:
        errors.append(f"git ls-files failed while checking tracked generated output: {exc}")
        return

    package_lock = "apps/web/package-lock.json"
    if package_lock not in tracked_files:
        errors.append("apps/web/package-lock.json: npm lockfile must be tracked as the only frontend lockfile.")

    forbidden_tracked_files = {
        "apps/web/pnpm-lock.yaml": "npm is the only supported frontend package manager.",
        "apps/web/pnpm-workspace.yaml": "npm is the only supported frontend package manager.",
        "apps/web/yarn.lock": "npm is the only supported frontend package manager.",
        "apps/web/.yarnrc.yml": "npm is the only supported frontend package manager.",
        "apps/web/.pnp.cjs": "npm is the only supported frontend package manager.",
        "apps/web/.pnp.loader.mjs": "npm is the only supported frontend package manager.",
        "apps/web/bun.lock": "npm is the only supported frontend package manager.",
        "apps/web/bun.lockb": "npm is the only supported frontend package manager.",
        "apps/web/deno.lock": "npm is the only supported frontend package manager.",
        "apps/web/npm-shrinkwrap.json": "package-lock.json is the only committed frontend lockfile.",
    }

    for relative, message in forbidden_tracked_files.items():
        if relative in tracked_files:
            errors.append(f"{relative}: {message}")

    for relative in tracked_files:
        if ".egg-info/" in relative:
            errors.append(f"{relative}: Python package metadata is generated output.")


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


def check_palace_quiz_application_facades(errors: list[str]) -> None:
    for path in iter_files(PALACE_QUIZ_APPLICATION, (".py",)):
        if path.name == "service.py":
            continue
        content = path.read_text(encoding="utf-8")
        if "from .service import" in content:
            relative = path.relative_to(REPO_ROOT)
            errors.append(
                f"{relative}: palace_quiz application modules must import question leaf modules directly instead of the service facade."
            )


def check_settings_module_boundaries(errors: list[str]) -> None:
    for path in iter_files(SETTINGS_MODULE, (".py",)):
        content = path.read_text(encoding="utf-8")
        if "memory_anki.modules.palaces" in content:
            relative = path.relative_to(REPO_ROOT)
            errors.append(
                f"{relative}: settings modules must not import palaces modules; move shared prompt/config helpers to settings or core."
            )


def main() -> int:
    errors: list[str] = []
    check_forbidden_imports(errors)
    check_file_sizes(errors)
    check_router_residency(errors)
    check_shared_local_storage_facade(errors)
    check_removed_shared_api_modules(errors)
    check_frontend_public_api_surfaces(errors)
    check_runtime_data_ignored(errors)
    check_frontend_config_contract(errors)
    check_forward_compatible_migrations(errors)
    check_palace_quiz_application_facades(errors)
    check_settings_module_boundaries(errors)

    if errors:
        print("Architecture check failed:")
        for error in errors:
            print(f"- {error}")
        return 1

    print("Architecture check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
