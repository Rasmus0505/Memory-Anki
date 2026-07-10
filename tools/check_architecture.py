from __future__ import annotations

import ast
import json
import posixpath
import re
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
WEB_SRC = REPO_ROOT / "apps" / "web" / "src"
WEB_ROOT = REPO_ROOT / "apps" / "web"
API_SRC = REPO_ROOT / "apps" / "api" / "src" / "memory_anki"
ALEMBIC_VERSIONS = REPO_ROOT / "apps" / "api" / "alembic" / "versions"
STORAGE_LAYOUT_PATH = REPO_ROOT / "apps" / "api" / "storage-layout.json"
BOUNDARY_EXCEPTIONS_PATH = REPO_ROOT / "docs" / "architecture" / "boundary-exceptions.json"
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
FORBIDDEN_SHARED_BUSINESS_IMPORTS = ("@/entities/",)
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
PUBLIC_API_DEEP_IMPORT_PATTERN = re.compile(
    r"@/(entities|features)/([^/'\"]+)/api/([^/'\"]+)"
)
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
BASELINE_SHARED_ENTITY_IMPORTS = {
    "shared/components/session/SessionTimerBar.tsx",
    "shared/components/session/timer-automation-config.ts",
    "shared/hooks/timedSessionModel.ts",
    "shared/hooks/timedSessionRecovery.ts",
    "shared/hooks/timedSessionRestore.ts",
    "shared/hooks/timedSessionSnapshot.ts",
    "shared/hooks/useTimedSession.test.tsx",
    "shared/hooks/useTimedSession.ts",
    "shared/lib/localStorage.test.tsx",
    "shared/logs/components/AppLogDrawer.tsx",
    "shared/preferences/clientPreferences.test.ts",
    "shared/preferences/clientPreferences.ts",
    "shared/preferences/persistentPreferenceStore.test.ts",
}
BASELINE_PRESENTATION_SESSION_FILES = {
    "apps/api/src/memory_anki/modules/dashboard/presentation/router.py",
    "apps/api/src/memory_anki/modules/english/presentation/router.py",
    "apps/api/src/memory_anki/modules/english_reading/presentation/router.py",
    "apps/api/src/memory_anki/modules/freestyle/presentation/router.py",
    "apps/api/src/memory_anki/modules/knowledge/presentation/bilink_router.py",
    "apps/api/src/memory_anki/modules/knowledge/presentation/router.py",
    "apps/api/src/memory_anki/modules/palace_quiz/presentation/router.py",
    "apps/api/src/memory_anki/modules/palaces/presentation/import_router.py",
    "apps/api/src/memory_anki/modules/palaces/presentation/router.py",
    "apps/api/src/memory_anki/modules/reviews/presentation/router.py",
    "apps/api/src/memory_anki/modules/sessions/presentation/router.py",
    "apps/api/src/memory_anki/modules/settings/presentation/router.py",
    "apps/api/src/memory_anki/modules/time_records/presentation/router.py",
}
BASELINE_PERSONAL_PATH_TOOLS = {
    "tools/archive/1000-quiz/audit_1000_quiz_bank.py",
    "tools/archive/1000-quiz/backfill_1000_quiz_ocr_sources.py",
    "tools/archive/1000-quiz/build_1000_questions_manifest.py",
    "tools/archive/1000-quiz/locate_1000_quiz_pages.py",
    "tools/archive/1000-quiz/merge_1000_page_drafts.py",
    "tools/archive/1000-quiz/ocr_1000_questions.py",
    "tools/archive/1000-quiz/render_1000_question_pages.py",
    "tools/archive/1000-quiz/repair_1000_quiz_bank_local.py",
    "tools/archive/1000-quiz/run_1000_quiz_rerun_plan.py",
    "tools/import_manual_quiz_texts.py",
}
BASELINE_OVERSIZED_FILES = {
    "apps/web/src/features/freestyle/FreestylePage.tsx",
    "apps/web/src/features/palace-quiz/components/PalaceQuizGenerationPanel.tsx",
    "apps/web/src/shared/components/session/GlobalTimerProvider.test.tsx",
    "apps/web/src/shared/components/session/GlobalTimerProvider.tsx",
    "apps/web/src/shared/components/session/TimerAutomationDialog.tsx",
    "apps/web/src/shared/hooks/useTimedSession.test.tsx",
    "apps/web/src/shared/hooks/useTimedSession.ts",
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
REQUIRED_STORAGE_KEYS = {
    "database",
    "attachments",
    "english",
    "english_reading",
    "import_jobs",
    "ai_call_logs",
    "backups_full",
    "backups_rescue",
    "runtime_active_instances",
    "migration_state",
    "sync_state",
}
PERSONAL_ABSOLUTE_PATH_PATTERNS = (
    re.compile(r"[A-Za-z]:\\Users\\"),
    re.compile(r"D:\\"),
    re.compile(r"C:\\(?!Program Files\\nodejs|Program Files \(x86\)\\nodejs)"),
)
BACKEND_PRIVATE_CROSS_MODULE_SEGMENTS = (".infrastructure", ".presentation")
BACKEND_CROSS_MODULE_PRIVATE_NAMES = ("repository", "repositories", "_")
FRONTEND_STUDY_SESSION_LEGACY_ENDPOINT_PATTERN = re.compile(
    r"/(?:time-records|sessions/[^'\"\s`]*/progress)"
)
FRONTEND_STUDY_SESSION_LEGACY_SYMBOLS = ("appendTimeRecord",)
BACKEND_LEGACY_TIME_RECORD_MODULE = "modules/time_records/"
BACKEND_STUDY_SESSION_LEGACY_PATTERNS = (
    "memory_anki.modules.time_records",
    " TimeRecord",
    "(TimeRecord",
    ", TimeRecord",
    "TimeRecord,",
    "query(TimeRecord",
)
FRONTEND_IMPORT_FROM_PATTERN = re.compile(r"\bfrom\s+['\"]([^'\"]+)['\"]")
FRONTEND_DYNAMIC_IMPORT_PATTERN = re.compile(r"\bimport\s*\(\s*['\"]([^'\"]+)['\"]\s*\)")
FRONTEND_SIDE_EFFECT_IMPORT_PATTERN = re.compile(
    r"^\s*(?:import|export)\s+['\"]([^'\"]+)['\"]", re.MULTILINE
)
GENERATED_API_IMPORT_ALLOWED_SOURCES = ("shared/api/contracts.ts", "shared/api/contracts/")
GENERATED_API_MODULE = "shared/api/generated"


def iter_files(root: Path, suffixes: tuple[str, ...]):
    for path in root.rglob("*"):
        if path.is_file() and path.suffix in suffixes and "__pycache__" not in path.parts:
            yield path


def load_boundary_exceptions() -> list[dict]:
    if not BOUNDARY_EXCEPTIONS_PATH.exists():
        return []
    payload = json.loads(BOUNDARY_EXCEPTIONS_PATH.read_text(encoding="utf-8"))
    exceptions = payload.get("exceptions", [])
    return [item for item in exceptions if isinstance(item, dict)]


def path_for_exception(path: Path) -> str:
    return path.relative_to(REPO_ROOT).as_posix()


def is_backend_boundary_exception(
    *,
    source_module: str,
    imported_module: str,
    path: Path,
    exceptions: list[dict],
) -> bool:
    relative = path_for_exception(path)
    for item in exceptions:
        source = str(item.get("source") or "")
        target = str(item.get("target") or "")
        allowed_files = {str(value).replace("\\", "/") for value in item.get("allowed_files", [])}
        if not source_module.startswith(source):
            continue
        if not imported_module.startswith(target):
            continue
        if relative in allowed_files:
            return True
    return False


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
            for forbidden_prefix in FORBIDDEN_SHARED_BUSINESS_IMPORTS:
                if forbidden_prefix in content:
                    if relative in BASELINE_SHARED_ENTITY_IMPORTS:
                        continue
                    errors.append(
                        f"{relative}: shared modules must not import entities; move business-aware code to the owning entity or feature."
                    )
                    break


def check_file_sizes(errors: list[str]) -> None:
    for path in iter_files(WEB_SRC, (".ts", ".tsx")):
        line_count = len(path.read_text(encoding="utf-8").splitlines())
        relative_posix = path.relative_to(REPO_ROOT).as_posix()
        if relative_posix in BASELINE_OVERSIZED_FILES:
            continue
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


def iter_frontend_import_specifiers(content: str) -> set[str]:
    specifiers: set[str] = set()
    for pattern in (
        FRONTEND_IMPORT_FROM_PATTERN,
        FRONTEND_DYNAMIC_IMPORT_PATTERN,
        FRONTEND_SIDE_EFFECT_IMPORT_PATTERN,
    ):
        specifiers.update(match.group(1) for match in pattern.finditer(content))
    return specifiers


def frontend_import_matches_module(path: Path, specifier: str, module_path: str) -> bool:
    normalized_specifier = specifier.replace("\\", "/").split("?", 1)[0].split("#", 1)[0]
    if normalized_specifier == f"@/{module_path}" or normalized_specifier.startswith(
        f"@/{module_path}/"
    ):
        return True
    if not normalized_specifier.startswith("."):
        return False

    source_dir = path.relative_to(WEB_SRC).parent.as_posix()
    normalized_target = posixpath.normpath(posixpath.join(source_dir, normalized_specifier))
    for suffix in (".ts", ".tsx", ".js", ".jsx"):
        if normalized_target.endswith(suffix):
            normalized_target = normalized_target[: -len(suffix)]
            break
    return normalized_target == module_path or normalized_target.startswith(f"{module_path}/")


def check_frontend_generated_api_boundary(errors: list[str]) -> None:
    for path in iter_files(WEB_SRC, (".ts", ".tsx")):
        relative = path.relative_to(WEB_SRC).as_posix()
        if relative == "shared/api/generated.ts":
            continue
        if relative in GENERATED_API_IMPORT_ALLOWED_SOURCES or relative.startswith(
            GENERATED_API_IMPORT_ALLOWED_SOURCES
        ):
            continue
        if is_frontend_test_file(relative):
            continue
        content = path.read_text(encoding="utf-8")
        for specifier in iter_frontend_import_specifiers(content):
            if frontend_import_matches_module(path, specifier, GENERATED_API_MODULE):
                errors.append(
                    f"{relative}: production code must not import generated OpenAPI types directly; "
                    "import stable contracts from `@/shared/api/contracts` or an owner API facade."
                )
                break


def check_frontend_public_api_surfaces(errors: list[str]) -> None:
    for path in iter_files(WEB_SRC, (".ts", ".tsx")):
        relative = path.relative_to(WEB_SRC).as_posix()
        if is_frontend_test_file(relative):
            continue
        if relative.startswith("entities/") and "/api/" in relative:
            continue
        content = path.read_text(encoding="utf-8")
        for match in PUBLIC_API_DEEP_IMPORT_PATTERN.finditer(content):
            layer, owner, module_name = match.groups()
            if module_name == "index":
                continue
            errors.append(
                f"{relative}: production code must import {layer}/{owner} APIs through "
                f"`@/{layer}/{owner}/api`, not internal API file `{module_name}`."
            )
        for forbidden_import, message in FORBIDDEN_PRODUCTION_ENTITY_API_DEEP_IMPORTS.items():
            if forbidden_import in content:
                errors.append(f"{relative}: {message}")
        if not relative.startswith("features/mindmap-import/"):
            for forbidden_import, message in FORBIDDEN_PRODUCTION_FEATURE_DEEP_IMPORTS.items():
                if forbidden_import in content:
                    errors.append(f"{relative}: {message}")


def check_study_session_legacy_usage(errors: list[str]) -> None:
    for path in iter_files(WEB_SRC, (".ts", ".tsx")):
        relative = path.relative_to(WEB_SRC).as_posix()
        if is_frontend_test_file(relative):
            continue
        content = path.read_text(encoding="utf-8")
        if FRONTEND_STUDY_SESSION_LEGACY_ENDPOINT_PATTERN.search(content):
            errors.append(
                f"{relative}: production frontend must use /study-sessions APIs instead of legacy "
                "/time-records or /sessions/*/progress endpoints."
            )
        for symbol in FRONTEND_STUDY_SESSION_LEGACY_SYMBOLS:
            if symbol in content:
                errors.append(
                    f"{relative}: production frontend must persist learning sessions through "
                    "StudySession helpers, not the old TimeRecord helper name."
                )

    backend_roots = (API_SRC / "app", API_SRC / "modules")
    for root in backend_roots:
        for path in iter_files(root, (".py",)):
            relative = path.relative_to(API_SRC).as_posix()
            if relative.startswith(BACKEND_LEGACY_TIME_RECORD_MODULE):
                continue
            content = path.read_text(encoding="utf-8")
            if any(pattern in content for pattern in BACKEND_STUDY_SESSION_LEGACY_PATTERNS):
                errors.append(
                    f"{path.relative_to(REPO_ROOT)}: production backend modules must use "
                    "modules.sessions StudySession services instead of TimeRecord/time_records."
                )


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


def check_storage_layout_contract(errors: list[str]) -> None:
    payload = json.loads(STORAGE_LAYOUT_PATH.read_text(encoding="utf-8"))
    items = payload.get("managed_items", [])
    if not isinstance(items, list):
        errors.append("apps/api/storage-layout.json: managed_items must be a list.")
        return
    keys = set()
    for item in items:
        if not isinstance(item, dict):
            errors.append("apps/api/storage-layout.json: every managed item must be an object.")
            continue
        key = str(item.get("key") or "")
        keys.add(key)
        relative_path = str(item.get("relative_path") or "")
        kind = str(item.get("kind") or "")
        if not key or not relative_path:
            errors.append("apps/api/storage-layout.json: every managed item needs key and relative_path.")
        if kind not in {"file", "directory"}:
            errors.append(f"apps/api/storage-layout.json: `{key}` must declare kind file or directory.")
        if "backup" not in item:
            errors.append(f"apps/api/storage-layout.json: `{key}` must explicitly declare backup true/false.")
    missing = sorted(REQUIRED_STORAGE_KEYS - keys)
    for key in missing:
        errors.append(f"apps/api/storage-layout.json: missing managed runtime item `{key}`.")


def module_name_for_api_path(path: Path) -> str:
    relative = path.relative_to(API_SRC).with_suffix("")
    return "memory_anki." + ".".join(relative.parts)


def owning_backend_module(module_name: str) -> str | None:
    parts = module_name.split(".")
    if len(parts) >= 4 and parts[:3] == ["memory_anki", "modules", parts[2]]:
        return parts[2]
    if len(parts) >= 3 and parts[0] == "memory_anki" and parts[1] == "modules":
        return parts[2]
    return None


def imported_module_from_node(node: ast.AST) -> str | None:
    if isinstance(node, ast.ImportFrom):
        return node.module
    if isinstance(node, ast.Import) and node.names:
        return node.names[0].name
    return None


def is_private_backend_cross_module_import(source_module: str, imported_module: str) -> bool:
    if not imported_module.startswith("memory_anki.modules."):
        return False
    source_owner = owning_backend_module(source_module)
    target_owner = owning_backend_module(imported_module)
    if not source_owner or not target_owner or source_owner == target_owner:
        return False
    if any(segment in imported_module for segment in BACKEND_PRIVATE_CROSS_MODULE_SEGMENTS):
        return True
    tail = imported_module.split(".")[-1]
    if tail.startswith("_"):
        return True
    return any(name in imported_module.split(".") for name in BACKEND_CROSS_MODULE_PRIVATE_NAMES)


def check_backend_module_boundaries(errors: list[str]) -> None:
    exceptions = load_boundary_exceptions()
    for path in iter_files(API_SRC / "modules", (".py",)):
        source_module = module_name_for_api_path(path)
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except SyntaxError as exc:
            errors.append(f"{path.relative_to(REPO_ROOT)}: cannot parse imports: {exc}")
            continue
        for node in ast.walk(tree):
            imported_module = imported_module_from_node(node)
            if not imported_module:
                continue
            if is_private_backend_cross_module_import(source_module, imported_module):
                if is_backend_boundary_exception(
                    source_module=source_module,
                    imported_module=imported_module,
                    path=path,
                    exceptions=exceptions,
                ):
                    continue
                errors.append(
                    f"{path.relative_to(REPO_ROOT)}: cross-module import `{imported_module}` reaches a private layer; "
                    "use a public contract/port or register a bounded exception."
                )


def check_backend_presentation_orm_usage(errors: list[str]) -> None:
    for path in (API_SRC / "modules").glob("*/presentation/**/*.py"):
        relative = path.relative_to(REPO_ROOT).as_posix()
        if relative in BASELINE_PRESENTATION_SESSION_FILES:
            continue
        content = path.read_text(encoding="utf-8")
        forbidden_patterns = {
            "get_session": "presentation must receive use-case dependencies instead of owning DB sessions",
            ".query(": "presentation must not run ORM queries",
            ".commit(": "presentation must not commit transactions",
            "memory_anki.infrastructure.db.models": "presentation must not import SQLAlchemy models directly",
        }
        for pattern, message in forbidden_patterns.items():
            if pattern in content:
                errors.append(f"{relative}: {message}.")
                break


def check_tool_personal_paths(errors: list[str]) -> None:
    for path in iter_files(REPO_ROOT / "tools", (".py", ".ps1", ".bat", ".cmd")):
        relative = path.relative_to(REPO_ROOT).as_posix()
        if relative == "tools/check_architecture.py":
            continue
        if relative in BASELINE_PERSONAL_PATH_TOOLS:
            continue
        content = path.read_text(encoding="utf-8", errors="ignore")
        for pattern in PERSONAL_ABSOLUTE_PATH_PATTERNS:
            if pattern.search(content):
                errors.append(
                    f"{relative}: tool scripts must not hard-code personal absolute paths; use local-config or repo-relative paths."
                )
                break


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


def check_ai_gateway_boundary(errors: list[str]) -> None:
    llm_root = API_SRC / "infrastructure" / "llm"
    for path in iter_files(API_SRC, (".py",)):
        if path.is_relative_to(llm_root):
            continue
        content = path.read_text(encoding="utf-8", errors="ignore")
        if "/chat/completions" in content:
            relative = Path("apps/api/src/memory_anki") / path.relative_to(API_SRC)
            errors.append(
                f"{relative.as_posix()}: AI endpoints must be constructed by infrastructure.llm; "
                "business modules must not hard-code `/chat/completions`."
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
    check_frontend_generated_api_boundary(errors)
    check_frontend_public_api_surfaces(errors)
    check_study_session_legacy_usage(errors)
    check_runtime_data_ignored(errors)
    check_frontend_config_contract(errors)
    check_storage_layout_contract(errors)
    check_forward_compatible_migrations(errors)
    check_palace_quiz_application_facades(errors)
    check_settings_module_boundaries(errors)
    check_ai_gateway_boundary(errors)
    check_backend_module_boundaries(errors)
    check_backend_presentation_orm_usage(errors)
    check_tool_personal_paths(errors)

    if errors:
        print("Architecture check failed:")
        for error in errors:
            print(f"- {error}")
        return 1

    print("Architecture check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
