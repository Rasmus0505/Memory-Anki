from __future__ import annotations

import importlib.util
import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
CHECK_ARCHITECTURE_PATH = REPO_ROOT / "tools" / "check_architecture.py"

spec = importlib.util.spec_from_file_location(
    "check_architecture", CHECK_ARCHITECTURE_PATH
)
assert spec is not None
check_architecture = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(check_architecture)


def write_file(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def test_freestyle_facade_requires_round_plan_public_surface(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    web_src = tmp_path / "apps" / "web" / "src"
    write_file(
        api_src / "modules" / "practice" / "application" / "queue_service.py",
        "\n".join(
            [
                "from memory_anki.modules.content.public import x",
                "from memory_anki.modules.memory.public import y",
                "from memory_anki.modules.quiz.public import z",
                "def build_freestyle_queue(): pass",
                "merge_content_streams",
                "training_mode",
                "streams",
            ]
        ),
    )
    write_file(
        api_src / "modules" / "practice" / "domain" / "stream_mixer.py",
        "def merge_content_streams(): pass\n",
    )
    write_file(
        web_src / "shared" / "api" / "contracts" / "freestyle.ts",
        "FreestyleTrainingMode FreestyleTrainingStreams FreestyleTrainingMix\n",
    )
    write_file(
        web_src / "modules" / "practice" / "public.ts",
        "sanitizeFreestyleFeedConfig applySkip mergeRefreshQueue visibleMountIndices "
        "createRoundPlan reorderRoundPlan isSequentialPalaceBlocked\n",
    )
    write_file(
        web_src / "modules" / "practice" / "domain" / "roundPlan.ts",
        "createRoundPlan reorderRoundPlan planCardStatus\n"
        "if (targetIndex < currentIndex) return false\n",
    )
    write_file(
        web_src / "modules" / "practice" / "ui" / "freestyle" / "model" / "freestylePalaceClearance.ts",
        "export function isPalaceRoundCleared() { return true }\n",
    )
    write_file(
        api_src / "modules" / "practice" / "domain" / "leftover_due.py",
        "def leftover_due_by_palace():\n    return {}\n",
    )
    write_file(web_src / "app" / "shell" / "navSections.ts", "label: '随心'\n")
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)

    errors: list[str] = []
    check_architecture.check_freestyle_queue_facade_surface(errors)

    assert errors == []


def test_freestyle_canvas_pan_rejects_guided_yield_and_touch_pan_y(
    tmp_path: Path, monkeypatch
) -> None:
    web_src = tmp_path / "apps" / "web" / "src"
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)
    write_file(
        web_src
        / "modules"
        / "practice"
        / "ui"
        / "freestyle"
        / "components"
        / "FreestyleUnitReviewFlipPanel.tsx",
        'mobileViewPolicy="guided"\n',
    )
    write_file(
        web_src / "modules" / "practice" / "ui" / "freestyle" / "ImmersiveFreestylePage.tsx",
        'className="h-full touch-pan-y"\n',
    )

    errors: list[str] = []
    check_architecture.check_freestyle_canvas_pan(errors)

    assert any("auto" in error and "pan" in error for error in errors)
    assert any("touch-pan-y" in error for error in errors)
    assert any("FreestyleFeedPager" in error for error in errors)


def test_freestyle_canvas_pan_allows_auto_camera_and_pager(
    tmp_path: Path, monkeypatch
) -> None:
    web_src = tmp_path / "apps" / "web" / "src"
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)
    write_file(
        web_src
        / "modules"
        / "practice"
        / "ui"
        / "freestyle"
        / "components"
        / "FreestyleUnitReviewFlipPanel.tsx",
        "export function FreestyleUnitReviewFlipPanel() { return null }\n",
    )
    write_file(
        web_src / "modules" / "practice" / "ui" / "freestyle" / "ImmersiveFreestylePage.tsx",
        "function Page() { return <FreestyleFeedPager /> }\n",
    )

    errors: list[str] = []
    check_architecture.check_freestyle_canvas_pan(errors)

    assert errors == []


def test_frontend_generated_api_boundary_blocks_direct_production_imports(
    tmp_path: Path, monkeypatch
) -> None:
    web_src = tmp_path / "apps" / "web" / "src"
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)
    write_file(
        web_src / "shared" / "api" / "generated.ts", "export type Generated = {}\n"
    )
    write_file(
        web_src / "features" / "review" / "direct.ts",
        "import type { Generated } from '@/shared/api/generated'\n",
    )
    write_file(
        web_src / "features" / "review" / "relative.ts",
        "import type { Generated } from '../../shared/api/generated'\n",
    )

    errors: list[str] = []
    check_architecture.check_frontend_generated_api_boundary(errors)

    assert errors == [
        "features/review/direct.ts: production code must not import generated OpenAPI types directly; "
        "import stable contracts from `@/shared/api/contracts` or an owner API facade.",
        "features/review/relative.ts: production code must not import generated OpenAPI types directly; "
        "import stable contracts from `@/shared/api/contracts` or an owner API facade.",
    ]


def test_frontend_generated_api_boundary_allows_contract_wrappers_and_tests(
    tmp_path: Path, monkeypatch
) -> None:
    web_src = tmp_path / "apps" / "web" / "src"
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)
    write_file(
        web_src / "shared" / "api" / "generated.ts", "export type Generated = {}\n"
    )
    write_file(
        web_src / "shared" / "api" / "contracts" / "index.ts",
        "export type { Generated } from '../generated'\n",
    )
    write_file(
        web_src / "features" / "review" / "generated.test.ts",
        "import type { Generated } from '@/shared/api/generated'\n",
    )
    write_file(
        web_src / "features" / "review" / "stable.ts",
        "import type { Generated } from '@/shared/api/contracts'\n",
    )

    errors: list[str] = []
    check_architecture.check_frontend_generated_api_boundary(errors)

    assert errors == []


def test_ai_gateway_boundary_blocks_business_endpoint_literals(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    write_file(
        api_src / "infrastructure" / "llm" / "client.py", 'URL = "/chat/completions"\n'
    )
    write_file(
        api_src / "modules" / "quiz" / "application" / "service.py",
        'URL = "/chat/completions"\n',
    )

    errors: list[str] = []
    check_architecture.check_ai_gateway_boundary(errors)

    assert errors == [
        "apps/api/src/memory_anki/modules/quiz/application/service.py: AI endpoints must be constructed by infrastructure.llm; business modules must not hard-code `/chat/completions`."
    ]


def test_migration_guard_ignores_destructive_downgrade(
    tmp_path: Path, monkeypatch
) -> None:
    versions = tmp_path / "versions"
    monkeypatch.setattr(check_architecture, "ALEMBIC_VERSIONS", versions)
    write_file(
        versions / "0001_add_widget.py",
        "def upgrade():\n    op.create_table('widget')\n\ndef downgrade():\n    op.drop_table('widget')\n",
    )

    errors: list[str] = []
    check_architecture.check_forward_compatible_migrations(errors)

    assert errors == []


def test_migration_guard_blocks_destructive_upgrade(
    tmp_path: Path, monkeypatch
) -> None:
    versions = tmp_path / "versions"
    monkeypatch.setattr(check_architecture, "ALEMBIC_VERSIONS", versions)
    write_file(
        versions / "0002_drop_widget.py",
        "def upgrade():\n    op.drop_table('widget')\n\ndef downgrade():\n    op.create_table('widget')\n",
    )

    errors: list[str] = []
    check_architecture.check_forward_compatible_migrations(errors)

    assert len(errors) == 1
    assert "destructive migration pattern `drop_table(...)`" in errors[0]


def test_migration_guard_does_not_accept_comment_marker(
    tmp_path: Path, monkeypatch
) -> None:
    versions = tmp_path / "versions"
    monkeypatch.setattr(check_architecture, "ALEMBIC_VERSIONS", versions)
    write_file(
        versions / "0003_drop_widget.py",
        "def upgrade():\n"
        "    # memory-anki: allow-destructive-migration\n"
        "    op.drop_table('widget')\n",
    )

    errors: list[str] = []
    check_architecture.check_forward_compatible_migrations(errors)

    assert len(errors) == 1
    assert "destructive migration pattern `drop_table(...)`" in errors[0]


def test_migration_guard_accepts_review_history_retirement(tmp_path: Path, monkeypatch) -> None:
    versions = tmp_path / "versions"
    monkeypatch.setattr(check_architecture, "ALEMBIC_VERSIONS", versions)
    write_file(
        versions / "0051_remove_node_review_history.py",
        "def upgrade():\n    op.drop_table('mindmap_recall_events')\n",
    )

    errors: list[str] = []
    check_architecture.check_forward_compatible_migrations(errors)

    assert errors == []


def test_migration_guard_accepts_retired_ai_prompt_storage(tmp_path: Path, monkeypatch) -> None:
    versions = tmp_path / "versions"
    monkeypatch.setattr(check_architecture, "ALEMBIC_VERSIONS", versions)
    write_file(
        versions / "0056_remove_legacy_ai_prompt_storage.py",
        "def upgrade():\n    op.drop_table('ai_prompt_versions')\n",
    )

    errors: list[str] = []
    check_architecture.check_forward_compatible_migrations(errors)

    assert errors == []


def test_mindmap_architecture_blocks_process_identity(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    web_src = tmp_path / "apps" / "web" / "src"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)
    write_file(
        api_src / "modules" / "mindmap_document" / "document.py",
        "def unstable_uid(node):\n    return f'node-{id(node)}'\n",
    )

    errors: list[str] = []
    check_architecture.check_mindmap_architecture(errors)

    assert errors == [
        "apps/api/src/memory_anki/modules/mindmap_document/document.py: "
        "persisted mind-map identity must be deterministic; do not derive node IDs from Python object identity."
    ]


def test_mindmap_architecture_allows_content_hash_identity(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    web_src = tmp_path / "apps" / "web" / "src"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)
    write_file(
        api_src / "modules" / "mindmap_document" / "document.py",
        "import hashlib\ndef stable_uid(value):\n    return hashlib.sha256(value).hexdigest()\n",
    )

    errors: list[str] = []
    check_architecture.check_mindmap_architecture(errors)

    assert errors == []


def test_mindmap_architecture_requires_shared_overlay_coordination(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / 'apps' / 'api' / 'src' / 'memory_anki'
    web_src = tmp_path / 'apps' / 'web' / 'src'
    monkeypatch.setattr(check_architecture, 'REPO_ROOT', tmp_path)
    monkeypatch.setattr(check_architecture, 'API_SRC', api_src)
    monkeypatch.setattr(check_architecture, 'WEB_SRC', web_src)
    write_file(
        web_src / 'pages' / 'create' / 'PalaceEditorPage.tsx',
        'const importMindMapAction = { deferUntilMenuClose: true }\n',
    )

    errors: list[str] = []
    check_architecture.check_mindmap_architecture(errors)

    assert errors == [
        'apps/web/src/pages/create/PalaceEditorPage.tsx: overlay launch timing belongs in the shared dropdown coordinator, not the palace page.',
        'apps/web/src/pages/create/PalaceEditorPage.tsx: mind-map import actions opened from overflow menus must declare opensOverlay: true.',
    ]


def write_context_map(
    path: Path,
    *,
    backend_contexts: dict[str, dict] | None = None,
    backend_dependencies: dict[str, list[str]] | None = None,
    frontend_dependencies: dict[str, list[str]] | None = None,
) -> None:
    import json

    write_file(
        path,
        json.dumps(
            {
                "schemaVersion": 1,
                "backend": {
                    "contexts": backend_contexts or {},
                    "allowedCrossContextDependencies": backend_dependencies or {},
                },
                "frontend": {
                    "allowedFeatureDependencies": frontend_dependencies or {},
                },
            }
        ),
    )


def configure_context_map_paths(tmp_path: Path, monkeypatch):
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    web_src = tmp_path / "apps" / "web" / "src"
    context_map_path = tmp_path / "docs" / "architecture" / "context-map.yaml"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)
    monkeypatch.setattr(check_architecture, "CONTEXT_MAP_PATH", context_map_path)
    return api_src, web_src, context_map_path


def test_context_map_blocks_entity_to_feature_dependency(
    tmp_path: Path, monkeypatch
) -> None:
    _api_src, web_src, context_map_path = configure_context_map_paths(
        tmp_path, monkeypatch
    )
    write_context_map(context_map_path)
    write_file(
        web_src / "entities" / "review" / "model.ts",
        "import type { Editor } from '@/features/mindmap-editor'\n",
    )

    errors: list[str] = []
    check_architecture.check_context_dependency_map(errors)

    assert errors == [
        "entities/review/model.ts: entities must not import feature `mindmap-editor`; "
        "move the contract to an entity or shared module."
    ]


def test_context_map_keeps_dashboard_free_of_profile_feature_dependencies(
    tmp_path: Path, monkeypatch
) -> None:
    _api_src, web_src, context_map_path = configure_context_map_paths(
        tmp_path, monkeypatch
    )
    write_context_map(context_map_path)
    write_file(
        web_src / "features" / "dashboard" / "DashboardOverview.tsx",
        "import { TimeRecordsTable } from '@/features/profile/components/TimeRecordsTable'\n",
    )

    errors: list[str] = []
    check_architecture.check_context_dependency_map(errors)

    assert errors == [
        "features/dashboard/DashboardOverview.tsx: new feature dependency "
        "`dashboard -> profile` is not registered in context-map.yaml; "
        "compose features in pages/widgets instead."
    ]


def test_context_map_blocks_unregistered_feature_dependency(
    tmp_path: Path, monkeypatch
) -> None:
    _api_src, web_src, context_map_path = configure_context_map_paths(
        tmp_path, monkeypatch
    )
    write_context_map(context_map_path)
    write_file(
        web_src / "features" / "alpha" / "useAlpha.ts",
        "import { beta } from '@/features/beta'\n",
    )

    errors: list[str] = []
    check_architecture.check_context_dependency_map(errors)

    assert errors == [
        "features/alpha/useAlpha.ts: new feature dependency `alpha -> beta` is not registered "
        "in context-map.yaml; compose features in pages/widgets instead."
    ]


def test_context_map_keeps_mini_palace_free_of_palace_edit_dependency(
    tmp_path: Path, monkeypatch
) -> None:
    _api_src, web_src, context_map_path = configure_context_map_paths(
        tmp_path, monkeypatch
    )
    write_context_map(
        context_map_path, frontend_dependencies={"mini-palace": ["mindmap-editor"]}
    )
    write_file(
        web_src / "features" / "mini-palace" / "useMiniPalaceController.ts",
        "import { helper } from '@/features/palace-edit/model/mindmap-editor'\n",
    )

    errors: list[str] = []
    check_architecture.check_context_dependency_map(errors)

    assert (
        "features/mini-palace/useMiniPalaceController.ts: new feature dependency "
        "`mini-palace -> palace-edit` is not registered in context-map.yaml; "
        "compose features in pages/widgets instead."
    ) in errors


def test_context_map_keeps_palace_edit_free_of_cross_feature_dependencies(
    tmp_path: Path, monkeypatch
) -> None:
    _api_src, web_src, context_map_path = configure_context_map_paths(
        tmp_path, monkeypatch
    )
    write_context_map(context_map_path, frontend_dependencies={"palace-edit": []})
    write_file(
        web_src / "features" / "palace-edit" / "hooks" / "usePalaceEditPage.ts",
        "import { MindMapEditorSurface } from '@/features/mindmap-editor'\n",
    )

    errors: list[str] = []
    check_architecture.check_context_dependency_map(errors)

    assert errors == [
        "features/palace-edit/hooks/usePalaceEditPage.ts: new feature dependency "
        "`palace-edit -> mindmap-editor` is not registered in context-map.yaml; "
        "compose features in pages/widgets instead."
    ]


def test_context_map_keeps_palace_catalog_free_of_review_dependency(
    tmp_path: Path, monkeypatch
) -> None:
    _api_src, web_src, context_map_path = configure_context_map_paths(
        tmp_path, monkeypatch
    )
    write_context_map(context_map_path, frontend_dependencies={"palace-catalog": []})
    write_file(
        web_src / "features" / "palace-catalog" / "PalaceListPage.tsx",
        "import { prefetchStudySession } from '@/features/review/studyWarmup'\n",
    )

    errors: list[str] = []
    check_architecture.check_context_dependency_map(errors)

    assert errors == [
        "features/palace-catalog/PalaceListPage.tsx: new feature dependency "
        "`palace-catalog -> review` is not registered in context-map.yaml; "
        "compose features in pages/widgets instead."
    ]


def test_context_map_keeps_profile_free_of_cross_feature_dependencies(
    tmp_path: Path, monkeypatch
) -> None:
    _api_src, web_src, context_map_path = configure_context_map_paths(
        tmp_path, monkeypatch
    )
    write_context_map(context_map_path, frontend_dependencies={"profile": []})
    write_file(
        web_src / "features" / "profile" / "ProfileSettingsPage.tsx",
        "import { repairReviewStageProgressApi } from '@/features/review/api'\n",
    )

    errors: list[str] = []
    check_architecture.check_context_dependency_map(errors)

    assert errors == [
        "features/profile/ProfileSettingsPage.tsx: new feature dependency "
        "`profile -> review` is not registered in context-map.yaml; "
        "compose features in pages/widgets instead."
    ]


def test_context_map_keeps_review_free_of_mini_palace_dependency(
    tmp_path: Path, monkeypatch
) -> None:
    _api_src, web_src, context_map_path = configure_context_map_paths(
        tmp_path, monkeypatch
    )
    write_context_map(
        context_map_path, frontend_dependencies={"review": ["mindmap-editor"]}
    )
    write_file(
        web_src / "features" / "review" / "hooks" / "useReviewFlow.ts",
        "import { useMiniPalaceController } from '@/features/mini-palace'\n",
    )

    errors: list[str] = []
    check_architecture.check_context_dependency_map(errors)

    assert errors == [
        "features/review/hooks/useReviewFlow.ts: new feature dependency "
        "`review -> mini-palace` is not registered in context-map.yaml; "
        "compose features in pages/widgets instead."
    ]


def test_context_map_keeps_mini_palace_free_of_mindmap_editor_dependency(
    tmp_path: Path, monkeypatch
) -> None:
    _api_src, web_src, context_map_path = configure_context_map_paths(
        tmp_path, monkeypatch
    )
    write_context_map(context_map_path, frontend_dependencies={"mini-palace": []})
    write_file(
        web_src / "features" / "mini-palace" / "useMiniPalaceController.ts",
        "import type { MindMapSelection } from '@/features/mindmap-editor'\n",
    )

    errors: list[str] = []
    check_architecture.check_context_dependency_map(errors)

    assert (
        "features/mini-palace/useMiniPalaceController.ts: new feature dependency "
        "`mini-palace -> mindmap-editor` is not registered in context-map.yaml; "
        "compose features in pages/widgets instead."
    ) in errors


def test_context_map_keeps_mindmap_import_free_of_editor_dependency(
    tmp_path: Path, monkeypatch
) -> None:
    _api_src, web_src, context_map_path = configure_context_map_paths(
        tmp_path, monkeypatch
    )
    write_context_map(context_map_path, frontend_dependencies={"mindmap-import": []})
    write_file(
        web_src / "features" / "mindmap-import" / "components" / "results.tsx",
        "import { MindMapEditorSurface } from '@/features/mindmap-editor'\n",
    )

    errors: list[str] = []
    check_architecture.check_context_dependency_map(errors)

    assert errors == [
        "features/mindmap-import/components/results.tsx: new feature dependency "
        "`mindmap-import -> mindmap-editor` is not registered in context-map.yaml; "
        "compose features in pages/widgets instead."
    ]


def test_context_map_ignores_test_only_feature_dependencies(
    tmp_path: Path, monkeypatch
) -> None:
    _api_src, web_src, context_map_path = configure_context_map_paths(
        tmp_path, monkeypatch
    )
    write_context_map(context_map_path, frontend_dependencies={"palace-quiz": []})
    write_file(
        web_src / "features" / "palace-quiz" / "PalaceQuizPage.test.tsx",
        "import { MindMapEditorSurface } from '@/features/mindmap-editor'\n",
    )

    errors: list[str] = []
    check_architecture.check_context_dependency_map(errors)

    assert errors == []


def test_context_map_keeps_review_free_of_mindmap_editor_dependency(
    tmp_path: Path, monkeypatch
) -> None:
    _api_src, web_src, context_map_path = configure_context_map_paths(
        tmp_path, monkeypatch
    )
    write_context_map(context_map_path, frontend_dependencies={"review": []})
    write_file(
        web_src / "features" / "review" / "components" / "ReviewFlowMapPanel.tsx",
        "import { MindMapEditorSurface } from '@/features/mindmap-editor'\n",
    )

    errors: list[str] = []
    check_architecture.check_context_dependency_map(errors)

    assert errors == [
        "features/review/components/ReviewFlowMapPanel.tsx: new feature dependency "
        "`review -> mindmap-editor` is not registered in context-map.yaml; "
        "compose features in pages/widgets instead."
    ]


def test_context_map_keeps_knowledge_free_of_cross_feature_dependencies(
    tmp_path: Path, monkeypatch
) -> None:
    _api_src, web_src, context_map_path = configure_context_map_paths(
        tmp_path, monkeypatch
    )
    write_context_map(context_map_path, frontend_dependencies={"knowledge": []})
    write_file(
        web_src / "features" / "knowledge" / "KnowledgePage.tsx",
        "import { MindMapEditorSurface } from '@/features/mindmap-editor'\n",
    )

    errors: list[str] = []
    check_architecture.check_context_dependency_map(errors)

    assert errors == [
        "features/knowledge/KnowledgePage.tsx: new feature dependency "
        "`knowledge -> mindmap-editor` is not registered in context-map.yaml; "
        "compose features in pages/widgets instead."
    ]


def test_context_map_allows_registered_feature_dependency(
    tmp_path: Path, monkeypatch
) -> None:
    _api_src, web_src, context_map_path = configure_context_map_paths(
        tmp_path, monkeypatch
    )
    write_context_map(context_map_path, frontend_dependencies={"alpha": ["beta"]})
    write_file(
        web_src / "features" / "alpha" / "useAlpha.ts",
        "import { beta } from '@/features/beta'\n",
    )

    errors: list[str] = []
    check_architecture.check_context_dependency_map(errors)

    assert errors == []


def test_context_map_blocks_unregistered_backend_dependency(
    tmp_path: Path, monkeypatch
) -> None:
    api_src, _web_src, context_map_path = configure_context_map_paths(
        tmp_path, monkeypatch
    )
    write_context_map(
        context_map_path,
        backend_contexts={
            "alpha": {"status": "transitional"},
            "beta": {"status": "transitional"},
        },
    )
    write_file(
        api_src / "modules" / "alpha" / "application" / "service.py",
        "from memory_anki.modules.beta.application.service import run\n",
    )
    write_file(
        api_src / "modules" / "beta" / "application" / "service.py",
        "def run():\n    pass\n",
    )

    errors: list[str] = []
    check_architecture.check_context_dependency_map(errors)

    assert errors == [
        "apps/api/src/memory_anki/modules/alpha/application/service.py: new cross-context "
        "dependency `alpha -> beta` is not registered in context-map.yaml."
    ]


def test_context_map_requires_registered_backend_dependency_to_use_public_entry(
    tmp_path: Path, monkeypatch
) -> None:
    api_src, _web_src, context_map_path = configure_context_map_paths(
        tmp_path, monkeypatch
    )
    write_context_map(
        context_map_path,
        backend_contexts={
            "alpha": {"status": "migrated"},
            "beta": {
                "status": "migrated",
                "publicEntry": "memory_anki.modules.beta.api",
            },
        },
        backend_dependencies={"alpha": ["beta"]},
    )
    write_file(
        api_src / "modules" / "alpha" / "application" / "service.py",
        "from memory_anki.modules.beta.application.service import run\n",
    )
    write_file(
        api_src / "modules" / "beta" / "application" / "service.py",
        "def run():\n    pass\n",
    )

    errors: list[str] = []
    check_architecture.check_context_dependency_map(errors)

    assert errors == [
        "apps/api/src/memory_anki/modules/alpha/application/service.py: registered "
        "cross-context dependency `alpha -> beta` must import public entry "
        "`memory_anki.modules.beta.api` (or .api/.public), not "
        "`memory_anki.modules.beta.application.service`."
    ]


def test_context_map_allows_registered_backend_public_entry(
    tmp_path: Path, monkeypatch
) -> None:
    api_src, _web_src, context_map_path = configure_context_map_paths(
        tmp_path, monkeypatch
    )
    write_context_map(
        context_map_path,
        backend_contexts={
            "alpha": {"status": "migrated"},
            "beta": {
                "status": "migrated",
                "publicEntry": "memory_anki.modules.beta.api",
            },
        },
        backend_dependencies={"alpha": ["beta"]},
    )
    write_file(
        api_src / "modules" / "alpha" / "application" / "service.py",
        "from memory_anki.modules.beta.api import run\n",
    )
    write_file(api_src / "modules" / "beta" / "api.py", "def run():\n    pass\n")

    errors: list[str] = []
    check_architecture.check_context_dependency_map(errors)

    assert errors == []


def test_backend_boundary_requires_public_settings_facade_for_ai_runtime_adapter(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    exceptions_path = tmp_path / "docs" / "architecture" / "boundary-exceptions.json"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    monkeypatch.setattr(check_architecture, "BOUNDARY_EXCEPTIONS_PATH", exceptions_path)
    write_file(exceptions_path, '{"exceptions": []}\n')
    write_file(
        api_src / "modules" / "content" / "presentation" / "private.py",
        "from memory_anki.modules.settings.infrastructure import SettingsAiRuntimeProvider\n",
    )
    write_file(
        api_src / "modules" / "content" / "presentation" / "public.py",
        "from memory_anki.modules.settings.api import SettingsAiRuntimeProvider\n",
    )

    errors: list[str] = []
    check_architecture.check_backend_module_boundaries(errors)

    assert len(errors) == 1
    normalized_error = errors[0].replace("\\", "/")
    assert normalized_error == (
        "apps/api/src/memory_anki/modules/content/presentation/private.py: cross-module import "
        "`memory_anki.modules.settings.infrastructure` reaches a private layer; use a public "
        "contract/port or register a bounded exception."
    )


def test_context_map_blocks_direct_commit_in_managed_use_case(
    tmp_path: Path, monkeypatch
) -> None:
    api_src, _web_src, context_map_path = configure_context_map_paths(
        tmp_path, monkeypatch
    )
    write_context_map(
        context_map_path,
        backend_contexts={"alpha": {"status": "transitional"}},
    )
    payload = __import__("json").loads(context_map_path.read_text(encoding="utf-8"))
    payload["backend"]["unitOfWorkManagedUseCases"] = [
        "modules/alpha/application/service.py"
    ]
    context_map_path.write_text(__import__("json").dumps(payload), encoding="utf-8")
    write_file(
        api_src / "modules" / "alpha" / "application" / "service.py",
        "from memory_anki.platform.application import UnitOfWork\n"
        "def run(session):\n    session.commit()\n",
    )

    errors: list[str] = []
    check_architecture.check_context_dependency_map(errors)

    assert errors == [
        "apps/api/src/memory_anki/modules/alpha/application/service.py: transaction-managed "
        "use cases must commit or roll back through UnitOfWork."
    ]


def test_migrated_ai_runtime_use_case_cannot_reimport_settings_registry(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    monkeypatch.setattr(
        check_architecture,
        "AI_RUNTIME_PORT_MANAGED_FILES",
        {"modules/produce/application/mindmap_import_job_runtime.py"},
    )
    write_file(
        api_src
        / "modules"
        / "produce"
        / "application"
        / "mindmap_import_job_runtime.py",
        "from memory_anki.modules.settings.application.ai_model_registry import "
        "resolve_scenario_runtime\n",
    )

    errors: list[str] = []
    check_architecture.check_ai_runtime_port_boundaries(errors)

    assert errors == [
        "apps/api/src/memory_anki/modules/produce/application/mindmap_import_job_runtime.py: "
        "migrated AI use cases must depend on "
        "platform application ports, not settings application internals."
    ]


def test_migrated_ai_use_case_cannot_import_settings_prompt_registry(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    monkeypatch.setattr(
        check_architecture,
        "AI_RUNTIME_PORT_MANAGED_FILES",
        {"modules/produce/application/mindmap_ai_split/gateway.py"},
    )
    write_file(
        api_src
        / "modules"
        / "produce"
        / "application"
        / "mindmap_ai_split"
        / "gateway.py",
        "from memory_anki.modules.settings.application.ai_prompts import render_prompt\n",
    )

    errors: list[str] = []
    check_architecture.check_ai_runtime_port_boundaries(errors)

    assert errors == [
        "apps/api/src/memory_anki/modules/produce/application/mindmap_ai_split/gateway.py: "
        "migrated AI use cases must depend on platform application ports, not settings "
        "application internals."
    ]


def test_reviews_application_cannot_reimport_palace_context(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    path = api_src / "modules" / "memory" / "application" / "queue.py"
    write_file(
        path,
        "from memory_anki.modules.content.api import palace_json\n",
    )

    errors: list[str] = []
    check_architecture.check_review_application_boundary(errors)

    assert errors == [
        "apps/api/src/memory_anki/modules/memory/application/queue.py: memory "
        "application must depend on pure document contracts or injected ports, not the "
        "palace context."
    ]


def test_palace_context_must_use_review_public_facade(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    path = api_src / "modules" / "content" / "application" / "projection.py"
    write_file(
        path,
        "from memory_anki.modules.memory.application.schedule_service import "
        "is_schedule_due\n",
    )

    errors: list[str] = []
    check_architecture.check_palace_review_public_facade(errors)

    assert errors == [
        "apps/api/src/memory_anki/modules/content/application/projection.py: palace "
        "context must import review capabilities through memory_anki.modules.memory.api."
    ]


def test_palace_read_projection_cannot_repair_binding(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    path = api_src / "modules" / "content" / "application" / "palace_serializer.py"
    write_file(path, "reconcile_palace_chapter_binding(session, palace)\n")

    errors: list[str] = []
    check_architecture.check_palace_read_side_purity(errors)

    assert errors == [
        "apps/api/src/memory_anki/modules/content/application/palace_serializer.py: "
        "read projections must not repair palace chapter bindings."
    ]


def test_business_query_cannot_run_palace_maintenance(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    path = api_src / "modules" / "dashboard" / "application" / "service.py"
    write_file(path, "restore_all_archived_palaces(session)\n")

    errors: list[str] = []
    check_architecture.check_palace_read_side_purity(errors)

    assert errors == [
        "apps/api/src/memory_anki/modules/dashboard/application/service.py: legacy "
        "palace restoration is an explicit maintenance command and cannot run from "
        "business queries."
    ]


def test_dashboard_must_use_context_public_facades(tmp_path: Path, monkeypatch) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    path = api_src / "modules" / "dashboard" / "application" / "service.py"
    write_file(
        path,
        "from memory_anki.modules.session.application.study_session_service "
        "import today_bounds\n",
    )

    errors: list[str] = []
    check_architecture.check_dashboard_public_facades(errors)

    assert errors == [
        "apps/api/src/memory_anki/modules/dashboard/application/service.py: dashboard "
        "must consume session capabilities through memory_anki.modules.session.api."
    ]


def test_quiz_bank_display_order_requires_choice_before_short_answer(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    web_src = tmp_path / "apps" / "web" / "src"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)
    monkeypatch.setattr(
        check_architecture,
        "PALACE_QUIZ_APPLICATION",
        api_src / "modules" / "quiz" / "application",
    )
    write_file(
        api_src / "modules" / "quiz" / "application" / "question_contracts.py",
        "QUESTION_TYPE_DISPLAY_ORDER = (QUESTION_TYPE_SHORT_ANSWER, QUESTION_TYPE_MULTIPLE_CHOICE)\n",
    )
    write_file(
        api_src / "modules" / "quiz" / "application" / "questions" / "queries.py",
        "def list_aggregated_questions():\n    return []\n",
    )
    write_file(
        web_src / "modules" / "quiz" / "ui" / "palace-quiz" / "model" / "questionBankOrder.ts",
        "export const QUESTION_TYPE_DISPLAY_ORDER = ['short_answer']\n",
    )
    write_file(
        tmp_path / "docs" / "architecture" / "palace-quiz-boundary.md",
        "# Palace Quiz Boundary\n",
    )

    errors: list[str] = []
    check_architecture.check_quiz_bank_display_order(errors)

    assert any("multiple_choice before short_answer" in item for item in errors)
    assert any("sort_questions_for_bank_display" in item for item in errors)
    assert any("multiple choice first" in item for item in errors)


def test_palace_quiz_must_use_palace_public_facade(tmp_path: Path, monkeypatch) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    path = api_src / "modules" / "quiz" / "application" / "grouping.py"
    write_file(
        path,
        "from memory_anki.modules.content.application.segment_nodes import "
        "collect_doc_nodes_with_descendants\n",
    )

    errors: list[str] = []
    check_architecture.check_palace_quiz_palace_boundary(errors)

    assert errors == [
        "apps/api/src/memory_anki/modules/quiz/application/grouping.py: "
        "quiz application must consume palace capabilities through "
        "memory_anki.modules.content.api."
    ]


def test_freestyle_must_use_context_public_facades(tmp_path: Path, monkeypatch) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    path = api_src / "modules" / "practice" / "application" / "feed.py"
    write_file(
        path,
        "from memory_anki.modules.english.application.course_service import "
        "list_recent_courses\n",
    )

    errors: list[str] = []
    check_architecture.check_consumer_context_public_facades(errors)

    assert errors == [
        "apps/api/src/memory_anki/modules/practice/application/feed.py: practice "
        "must consume english through memory_anki.modules.english.api or .public."
    ]


def test_palaces_must_use_backups_public_facade(tmp_path: Path, monkeypatch) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    path = api_src / "modules" / "content" / "application" / "editor.py"
    write_file(
        path,
        "from memory_anki.modules.backups.application.editor_safety "
        "import count_editor_doc_nodes\n",
    )

    errors: list[str] = []
    check_architecture.check_consumer_context_public_facades(errors)

    assert errors == [
        "apps/api/src/memory_anki/modules/content/application/editor.py: content "
        "must consume backups through memory_anki.modules.backups.api or .public."
    ]


def test_english_reading_must_use_reviews_public_facade(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    path = api_src / "modules" / "english_reading" / "application" / "vocabulary.py"
    write_file(
        path,
        "from memory_anki.modules.memory.application.schedule_policy "
        "import load_review_schedule_policy\n",
    )

    errors: list[str] = []
    check_architecture.check_consumer_context_public_facades(errors)

    assert errors == [
        "apps/api/src/memory_anki/modules/english_reading/application/vocabulary.py: "
        "english_reading must consume memory through "
        "memory_anki.modules.memory.api or .public."
    ]


def test_english_reading_must_use_english_public_facade(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    path = api_src / "modules" / "english_reading" / "application" / "vocabulary.py"
    write_file(
        path,
        "from memory_anki.modules.english.application.fsrs_runtime import "
        "build_scheduler\n",
    )

    errors: list[str] = []
    check_architecture.check_consumer_context_public_facades(errors)

    assert errors == [
        "apps/api/src/memory_anki/modules/english_reading/application/vocabulary.py: "
        "english_reading must consume english through "
        "memory_anki.modules.english.api or .public."
    ]


def test_reviews_must_use_sessions_public_facade(tmp_path: Path, monkeypatch) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    path = api_src / "modules" / "memory" / "application" / "service.py"
    write_file(
        path,
        "from memory_anki.modules.session.application.study_session_service "
        "import today_bounds\n",
    )

    errors: list[str] = []
    check_architecture.check_consumer_context_public_facades(errors)

    assert errors == [
        "apps/api/src/memory_anki/modules/memory/application/service.py: memory "
        "must consume session through memory_anki.modules.session.api or .public."
    ]


def test_settings_must_use_backups_public_facade(tmp_path: Path, monkeypatch) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    path = api_src / "modules" / "settings" / "application" / "metrics.py"
    write_file(
        path,
        "from memory_anki.modules.backups.application.backup_lifecycle "
        "import list_backups\n",
    )

    errors: list[str] = []
    check_architecture.check_consumer_context_public_facades(errors)

    assert errors == [
        "apps/api/src/memory_anki/modules/settings/application/metrics.py: settings "
        "must consume backups through memory_anki.modules.backups.api or .public."
    ]


def test_knowledge_must_use_palace_public_commands(tmp_path: Path, monkeypatch) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    path = api_src / "modules" / "knowledge" / "application" / "chapter.py"
    write_file(
        path,
        "from memory_anki.modules.content.application.palace_chapter_binding "
        "import set_palace_chapter_links\n",
    )

    errors: list[str] = []
    check_architecture.check_knowledge_context_boundaries(errors)

    assert errors == [
        "apps/api/src/memory_anki/modules/knowledge/application/chapter.py: knowledge "
        "must consume content through memory_anki.modules.content.api."
    ]


def test_palace_context_does_not_import_persistence_internals():
    palace_root = check_architecture.API_SRC / "modules/content"
    offenders = []
    for path in check_architecture.iter_files(palace_root, (".py",)):
        if "memory_anki.modules.persistence" in path.read_text(encoding="utf-8"):
            offenders.append(path.relative_to(check_architecture.REPO_ROOT).as_posix())
    assert offenders == []


def test_knowledge_context_does_not_import_persistence_internals():
    knowledge_root = check_architecture.API_SRC / "modules/knowledge"
    offenders = []
    for path in check_architecture.iter_files(knowledge_root, (".py",)):
        if "memory_anki.modules.persistence" in path.read_text(encoding="utf-8"):
            offenders.append(path.relative_to(check_architecture.REPO_ROOT).as_posix())
    assert offenders == []


def test_palace_quiz_context_does_not_import_persistence_internals():
    palace_quiz_root = check_architecture.API_SRC / "modules/quiz"
    offenders = []
    for path in check_architecture.iter_files(palace_quiz_root, (".py",)):
        if "memory_anki.modules.persistence" in path.read_text(encoding="utf-8"):
            offenders.append(path.relative_to(check_architecture.REPO_ROOT).as_posix())
    assert offenders == []


def test_sessions_context_does_not_import_persistence_internals():
    sessions_root = check_architecture.API_SRC / "modules/session"
    offenders = []
    for path in check_architecture.iter_files(sessions_root, (".py",)):
        if "memory_anki.modules.persistence" in path.read_text(encoding="utf-8"):
            offenders.append(path.relative_to(check_architecture.REPO_ROOT).as_posix())
    assert offenders == []


def test_reviews_context_does_not_import_persistence_internals():
    reviews_root = check_architecture.API_SRC / "modules/memory"
    offenders = []
    for path in check_architecture.iter_files(reviews_root, (".py",)):
        if "memory_anki.modules.persistence" in path.read_text(encoding="utf-8"):
            offenders.append(path.relative_to(check_architecture.REPO_ROOT).as_posix())
    assert offenders == []


def test_mypy_typed_boundary_modules_cannot_regress_to_ignore_errors(
    tmp_path: Path, monkeypatch
) -> None:
    pyproject_path = tmp_path / "apps" / "api" / "pyproject.toml"
    monkeypatch.setattr(check_architecture, "API_PYPROJECT_PATH", pyproject_path)
    write_file(
        pyproject_path,
        """[tool.mypy]
[[tool.mypy.overrides]]
module = [
  "memory_anki.modules.content.application.segment_nodes",
]
ignore_errors = true
""",
    )

    errors: list[str] = []
    check_architecture.check_mypy_typed_boundary_modules(errors)

    assert errors == [
        "apps/api/pyproject.toml: whole-module mypy ignore_errors is forbidden for "
        "`memory_anki.modules.content.application.segment_nodes`; type the boundary or use a "
        "narrowly scoped error-code ignore at the external library import."
    ]


def _write_runtime_catalogs(root: Path) -> None:
    architecture = root / "docs/architecture"
    architecture.mkdir(parents=True, exist_ok=True)
    (architecture / "context-map.yaml").write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "runtime": {
                    "ports": {},
                    "useCases": {},
                    "events": {},
                    "frontendModules": {},
                },
            }
        ),
        encoding="utf-8",
    )


def test_runtime_module_boundary_rejects_xstate_in_domain_and_private_cross_import(tmp_path, monkeypatch):
    web_src = tmp_path / "apps/web/src"
    freestyle = web_src / "modules/practice"
    mindmap = web_src / "modules/mindmap"
    (freestyle / "domain").mkdir(parents=True)
    mindmap.mkdir(parents=True)
    manifest = {
        "name": "freestyle",
        "owns": [],
        "forbids": [],
        "publicEntry": "src/modules/practice/public.ts",
        "workflows": [],
        "dependencies": [],
        "requiredTests": [],
    }
    (freestyle / "module.yaml").write_text(json.dumps(manifest), encoding="utf-8")
    (freestyle / "public.ts").write_text("export {}", encoding="utf-8")
    (freestyle / "domain/rules.ts").write_text(
        "import { createMachine } from 'xstate'\nimport x from '@/modules/mindmap/domain/private'",
        encoding="utf-8",
    )
    mindmap_manifest = {**manifest, "name": "mindmap", "publicEntry": "src/modules/mindmap/public.ts"}
    (mindmap / "module.yaml").write_text(json.dumps(mindmap_manifest), encoding="utf-8")
    (mindmap / "public.ts").write_text("export {}", encoding="utf-8")
    _write_runtime_catalogs(tmp_path)
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)

    errors: list[str] = []
    check_architecture.check_frontend_runtime_module_boundaries(errors)

    assert any("domain code cannot depend" in error for error in errors)
    assert any("cross-module imports must use" in error for error in errors)


def test_runtime_module_boundary_accepts_workflow_and_public_import(tmp_path, monkeypatch):
    web_src = tmp_path / "apps/web/src"
    freestyle = web_src / "modules/practice"
    mindmap = web_src / "modules/mindmap"
    (freestyle / "application/workflows").mkdir(parents=True)
    mindmap.mkdir(parents=True)
    for module in (freestyle, mindmap):
        payload = {
            "name": module.name,
            "owns": [],
            "forbids": [],
            "publicEntry": f"src/modules/{module.name}/public.ts",
            "workflows": [],
            "dependencies": [],
            "requiredTests": [],
        }
        (module / "module.yaml").write_text(json.dumps(payload), encoding="utf-8")
        (module / "public.ts").write_text("export {}", encoding="utf-8")
    (freestyle / "application/workflows/machine.ts").write_text(
        "import { createMachine } from 'xstate'\nimport '@/modules/mindmap/public'",
        encoding="utf-8",
    )
    _write_runtime_catalogs(tmp_path)
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)

    errors: list[str] = []
    check_architecture.check_frontend_runtime_module_boundaries(errors)

    assert errors == []


def test_retired_placeholder_module_is_rejected(tmp_path, monkeypatch) -> None:
    api_src = tmp_path / "apps/api/src/memory_anki"
    web_src = tmp_path / "apps/web/src"
    (api_src / "modules/library").mkdir(parents=True)
    (web_src / "modules/practice").mkdir(parents=True)
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)

    errors: list[str] = []
    check_architecture.check_retired_placeholder_modules(errors)

    assert errors == [
        "ARCH-MODULE-001 apps/api/src/memory_anki/modules/library: retired placeholder module "
        "must not be recreated before it owns a complete runtime slice."
    ]

def test_mindmap_architecture_requires_import_pipeline_contract(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    web_src = tmp_path / "apps" / "web" / "src"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)
    write_file(
        api_src / "modules" / "content" / "application" / "mindmap_import_job_runtime.py",
        "vision_ai_runtime\nformatter_ai_runtime\n",
    )
    write_file(
        api_src / "modules" / "content" / "application" / "mindmap_import" / "job_worker.py",
        "ocr_combined.txt\nformatter_response.txt\nfinal_tree.json\nextract_then_format\n",
    )
    write_file(
        api_src / "modules" / "content" / "application" / "mindmap_import" / "runtime.py",
        "ai_prompt_import_image_text\nai_prompt_import_ocr_mindmap_format\n",
    )

    errors: list[str] = []
    check_architecture.check_mindmap_architecture(errors)


def test_prompt_catalog_boundary_rejects_hardcoded_batch_prompts(tmp_path, monkeypatch):
    api_src = tmp_path / "apps/api/src/memory_anki"
    web_src = tmp_path / "apps/web/src"
    page = web_src / "pages/create/BatchGenerationWorkspacePage.tsx"
    page.parent.mkdir(parents=True)
    page.write_text(
        "const systemPrompt = '将本节教材转换为结构清晰、可编辑的记忆宫殿草稿。'",
        encoding="utf-8",
    )
    models = api_src / "infrastructure/db/_tables/misc.py"
    models.parent.mkdir(parents=True)
    models.write_text(
        "\n".join(
            f"class {name}: pass"
            for name in (
                "AiPromptBlock",
                "AiPromptBlockVersion",
                "AiPromptSceneDefault",
                "AiPromptSceneVersion",
            )
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)

    errors: list[str] = []
    check_architecture.check_prompt_catalog_boundaries(errors)

    assert any("batch generation system prompts" in error for error in errors)


def test_prompt_catalog_boundary_rejects_settings_imports_in_application(tmp_path, monkeypatch):
    api_src = tmp_path / "apps/api/src/memory_anki"
    web_src = tmp_path / "apps/web/src"
    application = api_src / "modules/example/application/service.py"
    application.parent.mkdir(parents=True)
    application.write_text(
        "from memory_anki.modules.settings.infrastructure import SettingsPromptCatalog",
        encoding="utf-8",
    )
    models = api_src / "infrastructure/db/_tables/misc.py"
    models.parent.mkdir(parents=True)
    models.write_text(
        "\n".join(
            f"class {name}: pass"
            for name in (
                "AiPromptBlock",
                "AiPromptBlockVersion",
                "AiPromptSceneDefault",
                "AiPromptSceneVersion",
            )
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)

    errors: list[str] = []
    check_architecture.check_prompt_catalog_boundaries(errors)

    assert any("platform PromptCatalog" in error for error in errors)


def test_mindmap_architecture_requires_replacement_ai_split_contract(tmp_path, monkeypatch) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    web_src = tmp_path / "apps" / "web" / "src"
    split_service = api_src / "modules" / "produce" / "application" / "mindmap_ai_split_service.py"
    prompt_composition = api_src / "modules" / "settings" / "application" / "ai_prompt_split_seeds.py"
    capabilities = web_src / "modules" / "content" / "ui" / "mindmap-editor" / "capabilities.ts"
    split_service.parent.mkdir(parents=True)
    prompt_composition.parent.mkdir(parents=True)
    capabilities.parent.mkdir(parents=True)
    split_service.write_text("AI_SPLIT_REPLACEMENT_MODES\nfind_target_location\n", encoding="utf-8")
    prompt_composition.write_text(
        "content.split_source_fidelity\nboundary.split_in_place\noutput.mindmap_split_json\n",
        encoding="utf-8",
    )
    capabilities.write_text("AI 分卡\nsplit_mode\n", encoding="utf-8")
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)

    errors: list[str] = []
    check_architecture.check_mindmap_architecture(errors)

    assert any("operation_id" in error for error in errors)
    assert any("task.split_structure_judgment" in error for error in errors)
    assert any("auto" in error for error in errors)


def test_unit_review_boundary_rejects_waves_and_node_rating_routes(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps/api/src/memory_anki"
    web_src = tmp_path / "apps/web/src"
    router = api_src / "modules/memory/presentation/router.py"
    write_file(router, '@router.post("/review/waves/x")\ndef retired(): pass\n')
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)

    errors: list[str] = []
    check_architecture.check_unit_review_boundary(errors)

    assert any("retired review runtime route" in error for error in errors)


def test_unit_review_boundary_rejects_standalone_review_pages_and_shelf_session_start(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps/api/src/memory_anki"
    web_src = tmp_path / "apps/web/src"
    write_file(api_src / "modules/memory/presentation/router.py", "")
    write_file(web_src / "app/router/review/ReviewSession.tsx", "export default function ReviewSession() {}\n")
    write_file(
        web_src / "app/router/appRoutes.tsx",
        '<Route path="/review/session/:id" element={<ReviewSession />} />\n',
    )
    write_file(
        web_src / "modules/content/ui/palace-catalog/components/palace-list/usePalaceListCardActions.tsx",
        "startUnitReviewSessionApi(palace.id)\n",
    )
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)

    errors: list[str] = []
    check_architecture.check_unit_review_boundary(errors)

    assert any("standalone review page must stay deleted" in error for error in errors)
    assert any("standalone review routes must not be registered" in error for error in errors)
    assert any("shelf review must enter /freestyle directly" in error for error in errors)


def test_unit_review_boundary_rejects_temporary_mark_ui(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps/api/src/memory_anki"
    web_src = tmp_path / "apps/web/src"
    write_file(api_src / "modules/memory/presentation/router.py", "")
    write_file(
        web_src / "modules/practice/ui/freestyle/components/FreestyleMindMapBranchCardView.tsx",
        "TemporaryMarkDialog\n临时标记\n",
    )
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)

    errors: list[str] = []
    check_architecture.check_unit_review_boundary(errors)

    assert any("TemporaryMarkDialog" in error for error in errors)
    assert any("临时标记" in error for error in errors)


def test_unit_review_boundary_requires_scheduler_service_and_topology(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps/api/src/memory_anki"
    web_src = tmp_path / "apps/web/src"
    write_file(api_src / "modules/memory/presentation/router.py", "")
    write_file(api_src / "modules/memory/application/unit_review_service.py", "def rate_review_unit(): pass\n")
    write_file(api_src / "modules/memory/application/unit_review_projection.py", "")
    write_file(api_src / "modules/memory/application/unit_scheduler.py", "INTERVAL_DAYS = (1, 3)\n")
    write_file(api_src / "modules/mindmap_document/split_units.py", "")
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)

    errors: list[str] = []
    check_architecture.check_unit_review_boundary(errors)

    assert any("reconcile_palace_units" in error for error in errors)
    assert any("INTERVAL_DAYS" in error for error in errors)
    assert any("split_scheduling_units" in error for error in errors)


def test_unit_review_boundary_accepts_split_projection_and_encounter_lifecycle(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps/api/src/memory_anki"
    web_src = tmp_path / "apps/web/src"
    write_file(api_src / "modules/memory/presentation/router.py", "")
    write_file(
        api_src / "modules/memory/application/unit_review_projection.py",
        "def reconcile_palace_units(): pass\n",
    )
    write_file(
        api_src / "modules/memory/application/unit_review_service.py",
        "def open_unit_review_encounter(): pass\n"
        "def rate_review_unit(): pass\n"
        "def rate_palace_due_units(): pass\n"
        "def close_unit_review_encounter(): pass\n"
        "def undo_unit_rating(): pass\n"
        "normalized_seconds = wall_seconds\n",
    )
    write_file(
        api_src / "modules/memory/application/unit_scheduler.py",
        "INTERVAL_DAYS: tuple[int, ...] = (0, 1, 3, 7, 14, 30, 60, 120, 240, 365)\n",
    )
    write_file(
        api_src / "modules/mindmap_document/split_units.py",
        "def split_scheduling_units(): pass\n",
    )
    write_file(
        api_src / "modules/practice/domain/review_units.py",
        "class ReviewUnitCandidate: pass\ndef candidate_from_projection(): pass\n",
    )
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)

    errors: list[str] = []
    check_architecture.check_unit_review_boundary(errors)

    assert errors == []


def test_unit_review_boundary_rejects_close_wall_span_400(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps/api/src/memory_anki"
    web_src = tmp_path / "apps/web/src"
    write_file(api_src / "modules/memory/presentation/router.py", "")
    write_file(
        api_src / "modules/memory/application/unit_review_projection.py",
        "def reconcile_palace_units(): pass\n",
    )
    write_file(
        api_src / "modules/memory/application/unit_review_service.py",
        "def open_unit_review_encounter(): pass\n"
        "def rate_review_unit(): pass\n"
        "def rate_palace_due_units(): pass\n"
        "def close_unit_review_encounter(): pass\n"
        "def undo_unit_rating(): pass\n"
        "raise ValueError('effective_seconds cannot exceed the encounter wall-clock span')\n",
    )
    write_file(
        api_src / "modules/memory/application/unit_scheduler.py",
        "INTERVAL_DAYS: tuple[int, ...] = (0, 1, 3, 7, 14, 30, 60, 120, 240, 365)\n",
    )
    write_file(
        api_src / "modules/mindmap_document/split_units.py",
        "def split_scheduling_units(): pass\n",
    )
    write_file(
        api_src / "modules/practice/domain/review_units.py",
        "class ReviewUnitCandidate: pass\ndef candidate_from_projection(): pass\n",
    )
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)

    errors: list[str] = []
    check_architecture.check_unit_review_boundary(errors)

    assert any("clamp effective_seconds to the wall span, not 400" in error for error in errors)
    assert any("normalized_seconds = wall_seconds" in error for error in errors)


def test_english_reading_gap_loop_rejects_retired_colored_flow(
    tmp_path: Path, monkeypatch
) -> None:
    web_src = tmp_path / "apps/web/src"
    write_file(
        web_src / "modules/english-reading/ui/english-reading/EnglishReadingPage.tsx",
        "ReadingVersion\ncompleteEnglishReadingMaterialApi\n",
    )
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)

    errors: list[str] = []
    check_architecture.check_english_reading_gap_loop(errors)

    assert any("retired flow marker" in error for error in errors)
    assert any("createEnglishReadingTargetApi" in error for error in errors)

def test_ai_credential_tombstones_reject_environment_secret_reads(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps/api/src/memory_anki"
    write_file(
        api_src / "modules/english/infrastructure/dashscope_gateway.py",
        "def resolve():\n    return DASHSCOPE_API_KEY\n",
    )
    write_file(
        api_src / "modules/english_reading/application/dictionary_service.py",
        "def resolve(runtime):\n    return runtime.resolve('translation')\n",
    )
    write_file(
        api_src / "modules/produce/application/mindmap_ai_split/config_loader.py",
        "has_legacy_api_key_override = False\n",
    )
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)

    errors: list[str] = []
    check_architecture.check_ai_credential_tombstones(errors)

    assert any("DASHSCOPE_API_KEY" in error for error in errors)
    assert any("credential tombstone" in error for error in errors)


def test_ai_credential_tombstones_allow_compatibility_imports(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps/api/src/memory_anki"
    write_file(
        api_src / "modules/english/infrastructure/dashscope_gateway.py",
        "from memory_anki.core.config import DASHSCOPE_API_KEY\n"
        "def resolve(runtime):\n    return runtime.api_key\n",
    )
    write_file(
        api_src / "modules/english_reading/application/dictionary_service.py",
        "def resolve(runtime):\n    return runtime.resolve('translation')\n",
    )
    write_file(
        api_src / "modules/produce/application/mindmap_ai_split/config_loader.py",
        'has_legacy_api_key_override = "mindmap_ai_split_api_key" in values\n',
    )
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)

    errors: list[str] = []
    check_architecture.check_ai_credential_tombstones(errors)

    assert errors == []
