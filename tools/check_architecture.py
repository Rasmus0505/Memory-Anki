from __future__ import annotations

import ast
import json
import posixpath
import re
import subprocess
import tomllib
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
WEB_SRC = REPO_ROOT / "apps" / "web" / "src"
WEB_ROOT = REPO_ROOT / "apps" / "web"
API_SRC = REPO_ROOT / "apps" / "api" / "src" / "memory_anki"
ALEMBIC_VERSIONS = REPO_ROOT / "apps" / "api" / "alembic" / "versions"
STORAGE_LAYOUT_PATH = REPO_ROOT / "apps" / "api" / "storage-layout.json"
API_PYPROJECT_PATH = REPO_ROOT / "apps" / "api" / "pyproject.toml"
BOUNDARY_EXCEPTIONS_PATH = (
    REPO_ROOT / "docs" / "architecture" / "boundary-exceptions.json"
)
CONTEXT_MAP_PATH = REPO_ROOT / "docs" / "architecture" / "context-map.yaml"
PALACE_QUIZ_APPLICATION = API_SRC / "modules" / "palace_quiz" / "application"
SETTINGS_MODULE = API_SRC / "modules" / "settings"
WEB_LAYER_DIRS = ("app", "pages", "widgets", "features", "entities", "shared")
WEB_API_PORT = "8012"
WEB_API_BASE_URL = f"http://127.0.0.1:{WEB_API_PORT}"

AI_RUNTIME_PORT_MANAGED_FILES = {
    "modules/palaces/application/peg_association_service.py",
    "modules/palaces/application/mindmap_ai_split/config_loader.py",
    "modules/palaces/application/mindmap_ai_split/contracts.py",
    "modules/palaces/application/mindmap_ai_split/gateway.py",
    "modules/palaces/application/mindmap_ai_split_service.py",
    "modules/palaces/application/mindmap_import/runtime.py",
    "modules/palaces/application/mindmap_import_job_api.py",
    "modules/palaces/application/mindmap_import_job_execution.py",
    "modules/palaces/application/mindmap_import_job_runtime.py",
    "modules/palaces/application/mindmap_import_job_service.py",
}

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
    "features/english/api/englishApi.ts": "English course and task API wrappers belong in entities/english/api.",
    "features/palace-quiz/api/quizApi.ts": "quiz question and generation API wrappers belong in entities/quiz/api; palace-quiz may keep only page-specific API composition.",
    "features/mini-palace/api/miniPalaceApi.ts": "mini palace API wrappers are cross-feature entity endpoints; keep them in entities/mini-palace/api.",
    "features/palace-segments/api/palaceSegmentsApi.ts": "palace segment API wrappers are cross-feature entity endpoints; keep them in entities/palace-segment/api.",
    "entities/palace/api/structureApi.ts": "split palace structure API wrappers by owner: entities/mini-palace, entities/palace-segment, entities/palace/api/stateApi, or practiceApi.",
}
FORBIDDEN_REMOVED_FEATURE_FILES = {
    "features/ai-config": "reusable AI runtime selection and run configuration belong in entities/ai-runtime.",
    "features/review/hooks/useReviewFeedback.ts": "cross-scene review feedback orchestration belongs in entities/review/model.",
    "features/review/model/review-feedback.ts": "review reward and feedback state belongs in entities/review/model.",
    "features/review/reviewSessionRoutes.ts": "review route builders belong in entities/review/model/routes.",
    "features/review/studyWarmup.ts": "study-session promise warmup is shared infrastructure; business loaders stay with their composing page or feature.",
    "features/palace-edit/PalaceEditPage.tsx": "route-level Palace editor composition belongs in pages/create/PalaceEditorPage.tsx.",
    "features/palace-edit/PalaceEditSkeleton.tsx": "Palace editor page loading UI belongs beside the page in pages/create.",
    "features/palace-edit/components/PalaceKnowledgeOutlinePanel.tsx": "route-level Knowledge outline and mind-map editor composition belongs beside pages/create/PalaceEditorPage.tsx.",
    "features/palace-edit/components/PalaceVersionDialog.tsx": "route-level Palace version preview and mind-map editor composition belongs beside pages/create/PalaceEditorPage.tsx.",
    "features/knowledge/KnowledgePage.tsx": "route-level Knowledge composition belongs in pages/library/KnowledgeLibraryPage.tsx.",
    "features/knowledge/components/KnowledgeMindMapImportDrawer.tsx": "Knowledge import and editor composition belongs beside the Knowledge library page.",
    "features/palace-quiz/QuizLauncherProvider.tsx": "application-wide quiz launcher composition belongs in widgets/quiz-launcher.",
    "features/palace-quiz/QuizQuestionInteraction.tsx": "cross-scene quiz interaction UI belongs in entities/quiz.",
    "features/palace-quiz/hooks/useQuizAttemptOrchestration.ts": "cross-scene quiz attempt orchestration belongs in entities/quiz.",
    "features/palace-quiz/model/quizResultFeedback.ts": "cross-scene quiz feedback belongs in entities/quiz.",
    "features/palace-quiz/components/PalaceQuizMemoryLookupDialog.tsx": "cross-feature palace memory lookup composition belongs in widgets/palace-memory-lookup.",
    "features/palace-quiz/model/memoryLookupDialogSupport.ts": "palace memory lookup composition belongs in widgets/palace-memory-lookup.",
    "features/palace-quiz/model/memoryLookupLayout.ts": "palace memory lookup layout belongs in widgets/palace-memory-lookup.",
    "features/review/components/MindMapReviewFlow.tsx": "cross-feature review, mini-palace, quiz, and mind-map composition belongs in widgets/mindmap-review-flow.",
    "features/review/hooks/useMindMapReviewFlowController.ts": "cross-feature review-flow orchestration belongs in widgets/mindmap-review-flow.",
    "features/review/ReviewSessionContainer.tsx": "route-level review session composition belongs in widgets/mindmap-review-flow.",
    "features/review/components/ReviewFlowMapPanel.tsx": "mind-map editor composition for review sessions belongs in widgets/mindmap-review-flow.",
    "features/review/ReviewFeedbackPreviewPage.tsx": "the obsolete standalone feedback preview page was replaced by the profile feedback route and must not be recreated.",
    "features/mindmap-editor/useMindMapDocumentSession.ts": "persisted document session ownership belongs in entities/mindmap-document/model.",
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
HISTORICAL_DESTRUCTIVE_UPGRADE_EXCEPTIONS = {
    "0003_reset_english_reading_dictionary_cache.py": (
        "Drops only a rebuildable provider cache when its legacy schema is detected."
    ),
    "0005_relax_palace_quiz_question_palace_owner.py": (
        "SQLite batch recreation is required to relax nullability without removing question rows."
    ),
    "0020_ai_quality_engineering.py": (
        "Expands request identifiers in place; SQLite batch migration preserves existing AI call log rows."
    ),
    "0021_remove_mindmap_view_preferences.py": (
        "Retires obsolete collapsed-node UI preferences only; no knowledge, review, or learning records are stored in this table."
    ),
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
FRONTEND_DYNAMIC_IMPORT_PATTERN = re.compile(
    r"\bimport\s*\(\s*['\"]([^'\"]+)['\"]\s*\)"
)
FRONTEND_SIDE_EFFECT_IMPORT_PATTERN = re.compile(
    r"^\s*(?:import|export)\s+['\"]([^'\"]+)['\"]", re.MULTILINE
)
GENERATED_API_IMPORT_ALLOWED_SOURCES = (
    "shared/api/contracts.ts",
    "shared/api/contracts/",
)
GENERATED_API_MODULE = "shared/api/generated"


def iter_files(root: Path, suffixes: tuple[str, ...]):
    for path in root.rglob("*"):
        if (
            path.is_file()
            and path.suffix in suffixes
            and "__pycache__" not in path.parts
        ):
            yield path


def load_boundary_exceptions() -> list[dict]:
    if not BOUNDARY_EXCEPTIONS_PATH.exists():
        return []
    payload = json.loads(BOUNDARY_EXCEPTIONS_PATH.read_text(encoding="utf-8"))
    exceptions = payload.get("exceptions", [])
    return [item for item in exceptions if isinstance(item, dict)]


def path_for_exception(path: Path) -> str:
    return path.relative_to(REPO_ROOT).as_posix()


def load_context_map() -> dict:
    if not CONTEXT_MAP_PATH.exists():
        return {}
    payload = json.loads(CONTEXT_MAP_PATH.read_text(encoding="utf-8"))
    return payload if isinstance(payload, dict) else {}


def resolve_frontend_import_path(path: Path, specifier: str) -> str | None:
    normalized = specifier.replace("\\", "/").split("?", 1)[0].split("#", 1)[0]
    if normalized.startswith("@/"):
        return normalized[2:]
    if not normalized.startswith("."):
        return None
    source_dir = path.relative_to(WEB_SRC).parent.as_posix()
    resolved = posixpath.normpath(posixpath.join(source_dir, normalized))
    for suffix in (".ts", ".tsx", ".js", ".jsx"):
        if resolved.endswith(suffix):
            resolved = resolved[: -len(suffix)]
            break
    return resolved


def check_context_dependency_map(errors: list[str]) -> None:
    payload = load_context_map()
    if payload.get("schemaVersion") != 1:
        errors.append("docs/architecture/context-map.yaml: schemaVersion must be 1.")
        return

    backend = payload.get("backend") if isinstance(payload.get("backend"), dict) else {}
    contexts = (
        backend.get("contexts") if isinstance(backend.get("contexts"), dict) else {}
    )
    actual_contexts = (
        {
            path.name
            for path in (API_SRC / "modules").iterdir()
            if path.is_dir() and path.name != "__pycache__"
        }
        if (API_SRC / "modules").exists()
        else set()
    )
    declared_contexts = set(contexts)
    for name in sorted(actual_contexts - declared_contexts):
        errors.append(
            f"docs/architecture/context-map.yaml: backend context `{name}` is not declared."
        )
    for name in sorted(declared_contexts - actual_contexts):
        if contexts.get(name, {}).get("status") not in {"target", "retired"}:
            errors.append(
                f"docs/architecture/context-map.yaml: declared backend context `{name}` does not exist."
            )

    allowed_backend_raw = backend.get("allowedCrossContextDependencies")
    allowed_backend = {
        str(source): {str(target) for target in targets}
        for source, targets in (
            allowed_backend_raw.items() if isinstance(allowed_backend_raw, dict) else []
        )
        if isinstance(targets, list)
    }
    for path in iter_files(API_SRC / "modules", (".py",)):
        source_module = module_name_for_api_path(path)
        source_owner = owning_backend_module(source_module)
        if not source_owner:
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            imported_module = imported_module_from_node(node)
            if not imported_module:
                continue
            target_owner = owning_backend_module(imported_module)
            if not target_owner or target_owner == source_owner:
                continue
            relative = path.relative_to(REPO_ROOT).as_posix()
            if target_owner not in allowed_backend.get(source_owner, set()):
                errors.append(
                    f"{relative}: new cross-context dependency `{source_owner} -> {target_owner}` "
                    "is not registered in context-map.yaml."
                )
                continue
            public_entry = str(contexts.get(target_owner, {}).get("publicEntry") or "")
            if public_entry and imported_module != public_entry:
                errors.append(
                    f"{relative}: registered cross-context dependency `{source_owner} -> "
                    f"{target_owner}` must import public entry `{public_entry}`, not "
                    f"`{imported_module}`."
                )

    for path in iter_files(API_SRC / "modules/reviews", (".py",)):
        content = path.read_text(encoding="utf-8")
        if "memory_anki.modules.persistence" in content:
            errors.append(
                f"{path.relative_to(REPO_ROOT).as_posix()}: Reviews must use platform "
                "MutationIdentity/MutationResponseStore instead of Persistence internals."
            )

    for path in iter_files(API_SRC / "modules/sessions", (".py",)):
        content = path.read_text(encoding="utf-8")
        if "memory_anki.modules.persistence" in content:
            errors.append(
                f"{path.relative_to(REPO_ROOT).as_posix()}: Sessions must use platform "
                "MutationIdentity/MutationResponseStore instead of Persistence internals."
            )

    for path in iter_files(API_SRC / "modules/knowledge", (".py",)):
        content = path.read_text(encoding="utf-8")
        if "memory_anki.modules.persistence" in content:
            errors.append(
                f"{path.relative_to(REPO_ROOT).as_posix()}: Knowledge must use platform "
                "MutationIdentity/MutationResponseStore instead of Persistence internals."
            )

    for path in iter_files(API_SRC / "modules/palaces", (".py",)):
        content = path.read_text(encoding="utf-8")
        if "memory_anki.modules.persistence" in content:
            errors.append(
                f"{path.relative_to(REPO_ROOT).as_posix()}: Palace must use the platform "
                "MutationIdentity/MutationResponseStore boundary instead of Persistence internals."
            )

    managed_use_cases = backend.get("unitOfWorkManagedUseCases")
    for relative in managed_use_cases if isinstance(managed_use_cases, list) else []:
        path = API_SRC / str(relative)
        if not path.exists():
            errors.append(
                f"docs/architecture/context-map.yaml: managed use case `{relative}` does not exist."
            )
            continue
        content = path.read_text(encoding="utf-8")
        if re.search(r"\bsession\.(?:commit|rollback)\s*\(", content):
            errors.append(
                f"{path.relative_to(REPO_ROOT).as_posix()}: transaction-managed use cases must "
                "commit or roll back through UnitOfWork."
            )
        if "UnitOfWork" not in content:
            errors.append(
                f"{path.relative_to(REPO_ROOT).as_posix()}: transaction-managed use case must "
                "depend on the UnitOfWork protocol."
            )

    mini_palace_records = API_SRC / "modules/palaces/application/mini_palace_records.py"
    if mini_palace_records.exists():
        content = mini_palace_records.read_text(encoding="utf-8")
        list_match = re.search(
            r"def list_palace_mini_palaces\(.*?(?=\ndef |\Z)",
            content,
            flags=re.DOTALL,
        )
        if list_match and re.search(
            r"\b(?:cleanup_mini_palace_node_uids|session\.(?:commit|flush|refresh))\b",
            list_match.group(0),
        ):
            errors.append(
                "modules/palaces/application/mini_palace_records.py: mini-palace list "
                "queries must not repair or persist node bindings."
            )

    frontend = (
        payload.get("frontend") if isinstance(payload.get("frontend"), dict) else {}
    )
    allowed_frontend_raw = frontend.get("allowedFeatureDependencies")
    allowed_frontend = {
        str(source): {str(target) for target in targets}
        for source, targets in (
            allowed_frontend_raw.items()
            if isinstance(allowed_frontend_raw, dict)
            else []
        )
        if isinstance(targets, list)
    }
    for path in iter_files(WEB_SRC, (".ts", ".tsx")):
        relative = path.relative_to(WEB_SRC).as_posix()
        if is_frontend_test_file(relative):
            continue
        relative_parts = path.relative_to(WEB_SRC).parts
        if len(relative_parts) < 2 or relative_parts[0] not in {"features", "entities"}:
            continue
        source_layer, source_owner = relative_parts[0], relative_parts[1]
        for specifier in iter_frontend_import_specifiers(
            path.read_text(encoding="utf-8")
        ):
            resolved = resolve_frontend_import_path(path, specifier)
            if not resolved or not resolved.startswith("features/"):
                continue
            target_parts = resolved.split("/")
            if len(target_parts) < 2:
                continue
            target_owner = target_parts[1]
            if source_layer == "entities":
                errors.append(
                    f"{path.relative_to(WEB_SRC).as_posix()}: entities must not import feature `{target_owner}`; "
                    "move the contract to an entity or shared module."
                )
                continue
            if (
                target_owner != source_owner
                and target_owner not in allowed_frontend.get(source_owner, set())
            ):
                errors.append(
                    f"{path.relative_to(WEB_SRC).as_posix()}: new feature dependency "
                    f"`{source_owner} -> {target_owner}` is not registered in context-map.yaml; "
                    "compose features in pages/widgets instead."
                )


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
        allowed_files = {
            str(value).replace("\\", "/") for value in item.get("allowed_files", [])
        }
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
        if (
            not path.relative_to(WEB_SRC).parts
            or path.relative_to(WEB_SRC).parts[0] not in WEB_LAYER_DIRS
        ):
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
        if relative.startswith("features/review/") or relative.startswith(
            "app/router/"
        ):
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
        if any(
            part in FORBIDDEN_ROUTER_RESIDENT_DIRS
            for part in path.relative_to(router_dir).parts
        ):
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
    forbidden_registry = (
        WEB_SRC / "shared" / "preferences" / "localPreferenceRegistry.ts"
    )
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


def frontend_import_matches_module(
    path: Path, specifier: str, module_path: str
) -> bool:
    normalized_specifier = (
        specifier.replace("\\", "/").split("?", 1)[0].split("#", 1)[0]
    )
    if normalized_specifier == f"@/{module_path}" or normalized_specifier.startswith(
        f"@/{module_path}/"
    ):
        return True
    if not normalized_specifier.startswith("."):
        return False

    source_dir = path.relative_to(WEB_SRC).parent.as_posix()
    normalized_target = posixpath.normpath(
        posixpath.join(source_dir, normalized_specifier)
    )
    for suffix in (".ts", ".tsx", ".js", ".jsx"):
        if normalized_target.endswith(suffix):
            normalized_target = normalized_target[: -len(suffix)]
            break
    return normalized_target == module_path or normalized_target.startswith(
        f"{module_path}/"
    )


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
        for (
            forbidden_import,
            message,
        ) in FORBIDDEN_PRODUCTION_ENTITY_API_DEEP_IMPORTS.items():
            if forbidden_import in content:
                errors.append(f"{relative}: {message}")
        if not relative.startswith("features/mindmap-import/"):
            for (
                forbidden_import,
                message,
            ) in FORBIDDEN_PRODUCTION_FEATURE_DEEP_IMPORTS.items():
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
            if any(
                pattern in content for pattern in BACKEND_STUDY_SESSION_LEGACY_PATTERNS
            ):
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
    if (
        f"{WEB_API_BASE_URL}/openapi.json" not in openapi_script
        or "127.0.0.1:8000/openapi.json" in openapi_script
    ):
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
        errors.append(
            f"git ls-files failed while checking tracked generated output: {exc}"
        )
        return

    package_lock = "apps/web/package-lock.json"
    if package_lock not in tracked_files:
        errors.append(
            "apps/web/package-lock.json: npm lockfile must be tracked as the only frontend lockfile."
        )

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


def check_mypy_typed_boundary_modules(errors: list[str]) -> None:
    if not API_PYPROJECT_PATH.exists():
        return
    payload = tomllib.loads(API_PYPROJECT_PATH.read_text(encoding="utf-8"))
    overrides = payload.get("tool", {}).get("mypy", {}).get("overrides", [])
    ignored_modules: set[str] = set()
    for override in overrides:
        if not isinstance(override, dict) or not override.get("ignore_errors"):
            continue
        modules = override.get("module", [])
        if isinstance(modules, str):
            ignored_modules.add(modules)
        elif isinstance(modules, list):
            ignored_modules.update(item for item in modules if isinstance(item, str))
    for module in sorted(ignored_modules):
        errors.append(
            f"apps/api/pyproject.toml: whole-module mypy ignore_errors is forbidden for `{module}`; "
            "type the boundary or use a narrowly scoped error-code ignore at the external library import."
        )


def check_storage_layout_contract(errors: list[str]) -> None:
    payload = json.loads(STORAGE_LAYOUT_PATH.read_text(encoding="utf-8"))
    items = payload.get("managed_items", [])
    if not isinstance(items, list):
        errors.append("apps/api/storage-layout.json: managed_items must be a list.")
        return
    keys = set()
    for item in items:
        if not isinstance(item, dict):
            errors.append(
                "apps/api/storage-layout.json: every managed item must be an object."
            )
            continue
        key = str(item.get("key") or "")
        keys.add(key)
        relative_path = str(item.get("relative_path") or "")
        kind = str(item.get("kind") or "")
        if not key or not relative_path:
            errors.append(
                "apps/api/storage-layout.json: every managed item needs key and relative_path."
            )
        if kind not in {"file", "directory"}:
            errors.append(
                f"apps/api/storage-layout.json: `{key}` must declare kind file or directory."
            )
        if "backup" not in item:
            errors.append(
                f"apps/api/storage-layout.json: `{key}` must explicitly declare backup true/false."
            )
    missing = sorted(REQUIRED_STORAGE_KEYS - keys)
    for key in missing:
        errors.append(
            f"apps/api/storage-layout.json: missing managed runtime item `{key}`."
        )


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


def is_private_backend_cross_module_import(
    source_module: str, imported_module: str
) -> bool:
    if not imported_module.startswith("memory_anki.modules."):
        return False
    source_owner = owning_backend_module(source_module)
    target_owner = owning_backend_module(imported_module)
    if not source_owner or not target_owner or source_owner == target_owner:
        return False
    if any(
        segment in imported_module for segment in BACKEND_PRIVATE_CROSS_MODULE_SEGMENTS
    ):
        return True
    tail = imported_module.split(".")[-1]
    if tail.startswith("_"):
        return True
    return any(
        name in imported_module.split(".")
        for name in BACKEND_CROSS_MODULE_PRIVATE_NAMES
    )


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


def check_ai_runtime_port_boundaries(errors: list[str]) -> None:
    forbidden_prefixes = (
        "memory_anki.modules.settings.application.ai_model_registry",
        "memory_anki.modules.settings.application.ai_prompts",
        "memory_anki.modules.settings.application.ai_prompt_templates",
    )
    managed_paths = {API_SRC / relative for relative in AI_RUNTIME_PORT_MANAGED_FILES}
    managed_application_roots = (
        API_SRC / "modules" / "palace_quiz" / "application",
        API_SRC / "modules" / "english_reading" / "application",
        API_SRC / "modules" / "english" / "application",
    )
    for application_root in managed_application_roots:
        managed_paths.update(iter_files(application_root, (".py",)))
    for path in managed_paths:
        if not path.exists():
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            imported_module = imported_module_from_node(node)
            if imported_module and imported_module.startswith(forbidden_prefixes):
                errors.append(
                    f"{path.relative_to(REPO_ROOT).as_posix()}: migrated AI use cases must depend "
                    "on platform application ports, not settings application internals."
                )
                break


def check_review_application_boundary(errors: list[str]) -> None:
    application_root = API_SRC / "modules" / "reviews" / "application"
    forbidden_prefix = "memory_anki.modules.palaces"
    for path in iter_files(application_root, (".py",)):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            imported_module = imported_module_from_node(node)
            if imported_module and imported_module.startswith(forbidden_prefix):
                errors.append(
                    f"{path.relative_to(REPO_ROOT).as_posix()}: reviews application must "
                    "depend on pure document contracts or injected ports, not the palace context."
                )
                break


def check_palace_review_public_facade(errors: list[str]) -> None:
    palace_root = API_SRC / "modules" / "palaces"
    forbidden_prefix = "memory_anki.modules.reviews.application"
    for path in iter_files(palace_root, (".py",)):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            imported_module = imported_module_from_node(node)
            if imported_module and imported_module.startswith(forbidden_prefix):
                errors.append(
                    f"{path.relative_to(REPO_ROOT).as_posix()}: palace context must import "
                    "review capabilities through memory_anki.modules.reviews.api."
                )
                break


def check_palace_read_side_purity(errors: list[str]) -> None:
    forbidden_repair_files = (
        API_SRC / "modules" / "palaces" / "application" / "palace_serializer.py",
        API_SRC / "modules" / "palaces" / "application" / "palace_view_resolvers.py",
    )
    for path in forbidden_repair_files:
        if not path.exists():
            continue
        if "reconcile_palace_chapter_binding" in path.read_text(encoding="utf-8"):
            errors.append(
                f"{path.relative_to(REPO_ROOT).as_posix()}: read projections must not "
                "repair palace chapter bindings."
            )

    maintenance_symbol = "restore_all_archived_palaces"
    maintenance_path = (
        API_SRC / "modules" / "palaces" / "application" / "palace_maintenance.py"
    )
    for path in iter_files(API_SRC / "modules", (".py",)):
        if path == maintenance_path:
            continue
        if maintenance_symbol in path.read_text(encoding="utf-8"):
            errors.append(
                f"{path.relative_to(REPO_ROOT).as_posix()}: legacy palace restoration is "
                "an explicit maintenance command and cannot run from business queries."
            )


def check_dashboard_public_facades(errors: list[str]) -> None:
    dashboard_root = API_SRC / "modules" / "dashboard"
    protected_owners = {"palaces", "reviews", "sessions"}
    for path in iter_files(dashboard_root, (".py",)):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            imported_module = imported_module_from_node(node)
            if not imported_module or not imported_module.startswith(
                "memory_anki.modules."
            ):
                continue
            parts = imported_module.split(".")
            owner = parts[2] if len(parts) > 2 else ""
            if owner in protected_owners and imported_module != (
                f"memory_anki.modules.{owner}.api"
            ):
                errors.append(
                    f"{path.relative_to(REPO_ROOT).as_posix()}: dashboard must consume "
                    f"{owner} capabilities through memory_anki.modules.{owner}.api."
                )
                break


def check_palace_quiz_palace_boundary(errors: list[str]) -> None:
    quiz_application = API_SRC / "modules" / "palace_quiz" / "application"
    for path in iter_files(quiz_application, (".py",)):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            imported_module = imported_module_from_node(node)
            if not imported_module:
                continue
            if imported_module.startswith("memory_anki.modules.palaces") and (
                imported_module != "memory_anki.modules.palaces.api"
            ):
                errors.append(
                    f"{path.relative_to(REPO_ROOT).as_posix()}: palace_quiz application "
                    "must consume palace capabilities through memory_anki.modules.palaces.api."
                )
                break
            if imported_module.startswith("memory_anki.modules.mindmap_document") and (
                imported_module != "memory_anki.modules.mindmap_document.api"
            ):
                errors.append(
                    f"{path.relative_to(REPO_ROOT).as_posix()}: palace_quiz application "
                    "must consume mind-map document operations through its public facade."
                )
                break


def check_consumer_context_public_facades(errors: list[str]) -> None:
    protected_by_consumer = {
        "english": {"sessions"},
        "english_reading": {"reviews", "sessions"},
        "palace_quiz": {"backups"},
        "palaces": {"backups", "sessions"},
        "reviews": {"sessions"},
        "search": {"palaces"},
        "settings": {"backups", "reviews"},
        "freestyle": {
            "english",
            "english_reading",
            "palace_quiz",
            "palaces",
            "reviews",
        },
    }
    for consumer, protected_owners in protected_by_consumer.items():
        consumer_root = API_SRC / "modules" / consumer
        for path in iter_files(consumer_root, (".py",)):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                imported_module = imported_module_from_node(node)
                if not imported_module or not imported_module.startswith(
                    "memory_anki.modules."
                ):
                    continue
                parts = imported_module.split(".")
                owner = parts[2] if len(parts) > 2 else ""
                if owner in protected_owners and imported_module != (
                    f"memory_anki.modules.{owner}.api"
                ):
                    errors.append(
                        f"{path.relative_to(REPO_ROOT).as_posix()}: {consumer} must "
                        f"consume {owner} through memory_anki.modules.{owner}.api."
                    )
                    break


def check_knowledge_context_boundaries(errors: list[str]) -> None:
    knowledge_root = API_SRC / "modules" / "knowledge"
    protected_owners = {"backups", "mindmap_document", "palaces"}
    for path in iter_files(knowledge_root, (".py",)):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            imported_module = imported_module_from_node(node)
            if not imported_module or not imported_module.startswith(
                "memory_anki.modules."
            ):
                continue
            parts = imported_module.split(".")
            owner = parts[2] if len(parts) > 2 else ""
            if owner in protected_owners and imported_module != (
                f"memory_anki.modules.{owner}.api"
            ):
                errors.append(
                    f"{path.relative_to(REPO_ROOT).as_posix()}: knowledge must consume "
                    f"{owner} through memory_anki.modules.{owner}.api."
                )
                break


def check_contexts_without_persistence_dependency(errors: list[str]) -> None:
    for context in ("knowledge", "palace_quiz", "palaces", "reviews", "sessions"):
        context_root = API_SRC / "modules" / context
        for path in iter_files(context_root, (".py",)):
            if "memory_anki.modules.persistence" not in path.read_text(
                encoding="utf-8"
            ):
                continue
            errors.append(
                f"{path.relative_to(REPO_ROOT).as_posix()}: {context} must use "
                "platform mutation and persistence contracts instead of the "
                "transitional persistence context."
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
        try:
            relative = path.relative_to(REPO_ROOT)
        except ValueError:
            relative = Path("apps/api/alembic/versions") / path.name
        content = path.read_text(encoding="utf-8-sig")
        try:
            module = ast.parse(content)
        except SyntaxError as exc:
            errors.append(f"{relative}: cannot parse migration: {exc}")
            continue
        upgrade = next(
            (
                node
                for node in module.body
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                and node.name == "upgrade"
            ),
            None,
        )
        if upgrade is None:
            continue
        destructive_pattern = None
        for node in ast.walk(upgrade):
            if not isinstance(node, ast.Call):
                continue
            call_name = ""
            if isinstance(node.func, ast.Attribute):
                call_name = node.func.attr.casefold()
            if call_name in {
                "drop_column",
                "drop_table",
                "alter_column",
                "rename_table",
            }:
                destructive_pattern = f"{call_name}(...)"
                break
            for argument in (*node.args, *(keyword.value for keyword in node.keywords)):
                if not isinstance(argument, ast.Constant) or not isinstance(
                    argument.value, str
                ):
                    continue
                normalized_argument = argument.value.casefold()
                matching_pattern = next(
                    (
                        pattern
                        for pattern in DESTRUCTIVE_MIGRATION_PATTERNS
                        if pattern in normalized_argument
                    ),
                    None,
                )
                if matching_pattern:
                    destructive_pattern = matching_pattern
                    break
            if destructive_pattern:
                break
        if destructive_pattern is None:
            continue
        if path.name in HISTORICAL_DESTRUCTIVE_UPGRADE_EXCEPTIONS:
            continue
        errors.append(
            f"{relative.as_posix()}: destructive migration pattern `{destructive_pattern}` is not allowed by default; "
            "prefer additive migrations for shared-runtime compatibility."
        )


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


def check_mindmap_architecture(errors: list[str]) -> None:
    removed_paths = (
        WEB_SRC / "shared" / "components" / "mindmap",
        WEB_SRC / "shared" / "components" / "mindmap-host",
        API_SRC / "modules" / "mindmap" / "application" / "editor_state_service.py",
        API_SRC / "modules" / "mindmap" / "application" / "editor_state_documents.py",
        API_SRC / "modules" / "mindmap" / "application" / "editor_state_tree_sync.py",
    )
    for path in removed_paths:
        if path.exists():
            errors.append(
                f"{path.relative_to(REPO_ROOT)}: removed mixed mind-map boundary must not be recreated."
            )

    entity_root = WEB_SRC / "entities" / "mindmap-document"
    for path in iter_files(entity_root, (".ts", ".tsx")):
        relative = path.relative_to(REPO_ROOT)
        content = path.read_text(encoding="utf-8")
        forbidden = (
            "from 'react'",
            'from "react"',
            "@xyflow/react",
            "@/features/",
            "@/entities/palace",
            "@/entities/knowledge",
            "@/entities/review",
        )
        for token in forbidden:
            if token in content:
                errors.append(
                    f"{relative}: pure mind-map document entity must not depend on `{token}`."
                )

    canvas_root = WEB_SRC / "shared" / "ui" / "mindmap-canvas"
    business_tokens = (
        "miniPalace",
        "masteryStatus",
        "manualMasteryLabel",
        "segmentColor",
        "focusMarked",
        "revealState",
    )
    for path in iter_files(canvas_root, (".ts", ".tsx")):
        relative_web = path.relative_to(WEB_SRC).as_posix()
        if is_frontend_test_file(relative_web):
            continue
        content = path.read_text(encoding="utf-8")
        for token in business_tokens:
            if token in content:
                errors.append(
                    f"{path.relative_to(REPO_ROOT)}: generic canvas must use visual decorations instead of business field `{token}`."
                )

    document_root = API_SRC / "modules" / "mindmap_document"
    forbidden_backend = (
        "sqlalchemy",
        "fastapi",
        "memory_anki.infrastructure",
        "memory_anki.modules.palaces",
        "memory_anki.modules.knowledge",
        "memory_anki.modules.backups",
        "memory_anki.modules.mindmap_learning",
    )
    for path in iter_files(document_root, (".py",)):
        content = path.read_text(encoding="utf-8")
        for token in forbidden_backend:
            if token in content:
                errors.append(
                    f"{path.relative_to(REPO_ROOT)}: pure mindmap_document must not depend on `{token}`."
                )
        if re.search(r"\bid\s*\(", content):
            errors.append(
                f"{path_for_exception(path)}: persisted mind-map identity must be deterministic; "
                "do not derive node IDs from Python object identity."
            )

    for path in iter_files(API_SRC / "modules", (".py",)):
        if document_root in path.parents:
            continue
        content = path.read_text(encoding="utf-8")
        if (
            "memory_anki.modules.mindmap_document.document" in content
            or "memory_anki.modules.mindmap_document.snapshot" in content
        ):
            errors.append(
                f"{path.relative_to(REPO_ROOT)}: import mindmap_document through its public facade or aggregate-owned service."
            )


def main() -> int:
    errors: list[str] = []
    check_context_dependency_map(errors)
    check_forbidden_imports(errors)
    check_mindmap_architecture(errors)
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
    check_mypy_typed_boundary_modules(errors)
    check_forward_compatible_migrations(errors)
    check_palace_quiz_application_facades(errors)
    check_settings_module_boundaries(errors)
    check_ai_gateway_boundary(errors)
    check_ai_runtime_port_boundaries(errors)
    check_review_application_boundary(errors)
    check_palace_review_public_facade(errors)
    check_palace_read_side_purity(errors)
    check_dashboard_public_facades(errors)
    check_palace_quiz_palace_boundary(errors)
    check_consumer_context_public_facades(errors)
    check_knowledge_context_boundaries(errors)
    check_contexts_without_persistence_dependency(errors)
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
