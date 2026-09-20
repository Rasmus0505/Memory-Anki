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


SIX_NAV_LABELS = ("随心", "随心 2", "知识", "英语", "创建", "洞察")
FIVE_NAV_LABELS = ("随心", "知识", "英语", "创建", "洞察")


def write_unified_training_fixture(root: Path, *, labels: tuple[str, ...]) -> tuple[Path, Path]:
    api_src = root / "apps" / "api" / "src" / "memory_anki"
    web_src = root / "apps" / "web" / "src"
    write_file(
        web_src / "app" / "shell" / "navSections.ts",
        "\n".join(f"label: '{label}'" for label in labels) + "\n",
    )
    write_file(web_src / "app" / "router" / "appRoutes.tsx", 'path="/freestyle-2"\n')
    write_file(
        web_src / "shared" / "routing" / "routeManifest.ts",
        "path: '/freestyle-2'\n",
    )
    write_file(
        api_src / "modules" / "practice" / "domain" / "peer_progress.py",
        "def apply_peer_progress():\n    return None\n",
    )
    write_file(
        api_src / "modules" / "practice" / "application" / "round_state_service.py",
        "workspace = 'primary'\n",
    )
    return api_src, web_src


def test_unified_training_evidence_accepts_five_nav_labels(
    tmp_path: Path, monkeypatch
) -> None:
    api_src, web_src = write_unified_training_fixture(tmp_path, labels=FIVE_NAV_LABELS)
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)

    errors: list[str] = []
    check_architecture.check_unified_training_evidence(errors)

    assert errors == []


def test_unified_training_evidence_rejects_six_nav_labels(
    tmp_path: Path, monkeypatch
) -> None:
    api_src, web_src = write_unified_training_fixture(tmp_path, labels=SIX_NAV_LABELS)
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)

    errors: list[str] = []
    check_architecture.check_unified_training_evidence(errors)

    assert any("primary navigation must remain exactly" in error for error in errors)
    assert any("随心 2" in error for error in errors)


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
                "list_active_palace_ids_by_subject_ids",
                "subject_ids",
            ]
        ),
    )
    write_file(
        api_src / "modules" / "practice" / "domain" / "stream_mixer.py",
        "def merge_content_streams(): pass\n",
    )
    write_file(
        web_src / "shared" / "api" / "contracts" / "freestyle.ts",
        "FreestyleTrainingMode FreestyleTrainingStreams FreestyleTrainingMix subject_ids\n",
    )
    write_file(
        web_src / "modules" / "practice" / "public.ts",
        "sanitizeFreestyleFeedConfig applySkip mergeRefreshQueue visibleMountIndices "
        "createRoundPlan reorderRoundPlan isSequentialPalaceBlocked\n",
    )
    write_file(
        web_src / "modules" / "practice" / "domain" / "roundPlan.ts",
        "createRoundPlan reorderRoundPlan planCardStatus shouldReorderUnstartedFreestylePlan\n"
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
    write_file(
        tmp_path / "docs" / "architecture" / "freestyle-immersive-feed.md",
        "backend-authoritative occurrence_kind scheduledBase retryInserted faint palace-color fill faint amber fill not only the HUD rail queue-construction fields must not mint a new `round_id` does not move `current_card_id` orphan block retry occurrence has its own encounter leaves that occurrence in the viewport must not remount the map at the root one live retry must not mint a second copy overlapping identities append_today_cards replan_remaining entered_on\n",
    )
    write_file(
        api_src / "modules" / "practice" / "application" / "round_state_service.py",
        "expected_version = 1\noperation_id = 'op'\nplan_json = '{}'\nqueue_construction_signature = ''\n"
        "_latest_active_for_workspace = True\nplan_is_fully_handled = True\n"
        "if plan_is_fully_handled(next_plan) and not persist_config:\n    return _payload(row)\n",
    )
    write_file(
        api_src / "modules" / "practice" / "domain" / "round_plan.py",
        "def leave_card(): pass\nretry_attempt = 1\ndef insert_retry_after_gap(): pass\ndef _collapse_retries(): pass\ndef append_today_cards(): pass\ndef replan_remaining(): pass\nentered_on = ''\n_is_viewable_current = True\nlive_retry_sources = set()\n",
    )
    write_file(
        api_src / "modules" / "practice" / "presentation" / "router.py",
        "@router.post('/freestyle/rounds/active')\n@router.post('/freestyle/rounds/start')\n",
    )
    write_file(
        web_src / "modules" / "practice" / "ui" / "freestyle" / "model" / "freestyleProgressSegments.ts",
        "scheduledBase retryInserted progressHudText bg-sky-400/25 orderIds retryNodeToneClass bg-amber-400/25 retryChromeClass\n",
    )
    write_file(
        web_src / "modules" / "practice" / "ui" / "freestyle" / "ImmersiveFreestylePage.tsx",
        "handleRatingSettled autoAdvance planVersion\n",
    )
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)

    write_file(
        web_src / "modules" / "practice" / "ui" / "freestyle" / "hooks" / "useImmersiveQueue.ts",
        "rebuildKeepingProgress\n"
        "syncCompletedIdsToRoundPlan\n"
        "removeRetryOccurrencesForSource(cardsRef.current, graduatedSourceId, cardId)\n"
        "startFreestyleRoundApi\n"
        "forceStart\n",
    )
    write_file(
        web_src / "modules" / "practice" / "domain" / "queueState.ts",
        "Retry occurrences keep their own encounter\nkeepCardId\n",
    )
    write_file(
        web_src / "modules" / "practice" / "domain" / "serverRoundPlan.ts",
        "export function cardFromOriginalSnapshot() { return null }\n",
    )
    write_file(
        web_src / "modules" / "practice" / "ui" / "freestyle" / "components" / "FreestyleUnitReviewCardView.tsx",
        "function adoptRatedEncounter() { return null }\nconst sameRatedOpenGlance = true\n",
    )
    errors: list[str] = []
    check_architecture.check_freestyle_queue_facade_surface(errors)
    check_architecture.check_freestyle_scope_quiz_overlay(errors)

    assert errors == []


def test_freestyle_facade_rejects_refresh_wiping_round_progress(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    web_src = tmp_path / "apps" / "web" / "src"
    write_file(
        api_src / "modules" / "practice" / "application" / "queue_service.py",
        "placeholder\n",
    )
    write_file(web_src / "app" / "shell" / "navSections.ts", "label: '随心'\n")
    write_file(
        web_src / "modules" / "practice" / "ui" / "freestyle" / "hooks" / "useImmersiveQueue.ts",
        "startNewRound(queueStateRef.current, nextConfig.seed)\n"
        "startNewRound(queueStateRef.current, next.seed)\n"
        "planHasNewDueWork\n",
    )
    write_file(
        web_src / "modules" / "practice" / "domain" / "queueState.ts",
        "return existing.passed !== true\n",
    )
    write_file(
        web_src / "modules" / "practice" / "domain" / "serverRoundPlan.ts",
        "export function cardsForServerPlan() { return [] }\n",
    )
    write_file(
        web_src / "modules" / "practice" / "ui" / "freestyle" / "components" / "FreestyleUnitReviewCardView.tsx",
        "export function FreestyleUnitReviewCardView() { return null }\n",
    )
    write_file(
        tmp_path / "docs" / "architecture" / "freestyle-immersive-feed.md",
        "backend-authoritative occurrence_kind scheduledBase faint palace-color fill\n",
    )
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)

    errors: list[str] = []
    check_architecture.check_freestyle_queue_facade_surface(errors)

    assert any("must not mint via local startNewRound" in error for error in errors)
    assert any("startFreestyleRoundApi" in error for error in errors)
    assert any("forceStart" in error for error in errors)
    assert any("must not auto-start the next round via planHasNewDueWork" in error for error in errors)
    assert any("rebuild without minting a round" in error for error in errors)
    assert any("re-score" in error for error in errors)
    assert any("retry occurrence's own encounter" in error for error in errors)
    assert any("keep the card under the viewport" in error for error in errors)
    assert any("reconstruct completed review units" in error for error in errors)
    assert any("does not mint a new round_id" in error for error in errors)
    assert any("keep its own encounter instead of remounting the map" in error for error in errors)
    assert any("just-rated open glance must not reload" in error for error in errors)


def test_freestyle_facade_rejects_missing_unstarted_reorder(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    web_src = tmp_path / "apps" / "web" / "src"
    write_file(
        api_src / "modules" / "practice" / "application" / "queue_service.py",
        "placeholder\n",
    )
    write_file(web_src / "app" / "shell" / "navSections.ts", "label: '随心'\n")
    write_file(
        api_src / "modules" / "practice" / "domain" / "round_plan.py",
        "def leave_card(): pass\nretry_attempt = 1\ndef insert_retry_after_gap(): pass\n",
    )
    write_file(
        api_src / "modules" / "practice" / "application" / "round_state_service.py",
        "expected_version = 1\noperation_id = 'op'\nplan_json = '{}'\n",
    )
    write_file(
        web_src / "modules" / "practice" / "domain" / "roundPlan.ts",
        "createRoundPlan reorderRoundPlan planCardStatus\n"
        "if (targetIndex < currentIndex) return false\n",
    )
    write_file(
        tmp_path / "docs" / "architecture" / "freestyle-immersive-feed.md",
        "backend-authoritative occurrence_kind scheduledBase faint palace-color fill\n",
    )
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)

    errors: list[str] = []
    check_architecture.check_freestyle_queue_facade_surface(errors)

    assert any("append_today_cards" in error for error in errors)
    assert any("queue_construction_signature" in error for error in errors)
    assert any("shouldReorderUnstartedFreestylePlan" in error for error in errors)
    assert any("queue-construction fields" in error for error in errors)


def test_freestyle_progress_rail_rejects_near_identical_pending_done(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    web_src = tmp_path / "apps" / "web" / "src"
    write_file(
        api_src / "modules" / "practice" / "application" / "queue_service.py",
        "placeholder\n",
    )
    write_file(web_src / "app" / "shell" / "navSections.ts", "label: '随心'\n")
    write_file(
        web_src / "modules" / "practice" / "ui" / "freestyle" / "model" / "freestyleProgressSegments.ts",
        "scheduledBase retryInserted progressHudText\n"
        "pending: 'bg-sky-400/70'\ndone: 'bg-sky-400/90'\n",
    )
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)

    errors: list[str] = []
    check_architecture.check_freestyle_queue_facade_surface(errors)

    assert any("near-identical opacities" in error for error in errors)
    assert any("faint palace fill" in error for error in errors)
    assert any("faint amber fill" in error for error in errors)
    assert any("beyond the rail" in error for error in errors)


def test_freestyle_facade_rejects_client_local_round_authority(
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
                "list_active_palace_ids_by_subject_ids",
                "subject_ids",
            ]
        ),
    )
    write_file(
        api_src / "modules" / "practice" / "domain" / "stream_mixer.py",
        "def merge_content_streams(): pass\n",
    )
    write_file(
        web_src / "shared" / "api" / "contracts" / "freestyle.ts",
        "FreestyleTrainingMode FreestyleTrainingStreams FreestyleTrainingMix subject_ids\n",
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
    write_file(
        tmp_path / "docs" / "architecture" / "freestyle-immersive-feed.md",
        "Configuration and round state remain client-local per device.\n",
    )
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)

    errors: list[str] = []
    check_architecture.check_freestyle_queue_facade_surface(errors)

    assert any("client-local" in error for error in errors)
    assert any("round-plan service is required" in error for error in errors)


def test_freestyle_rating_retap_clears_requires_clickable_selected(
    tmp_path: Path, monkeypatch
) -> None:
    web_src = tmp_path / "apps" / "web" / "src"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)
    write_file(
        web_src / "modules" / "practice" / "ui" / "freestyle" / "components" / "FreestyleRatingBar.tsx",
        "disabled={busy || locked || selected || !hasEncounter}\n"
        "if (rating == null || rating === selectedRating) return\n",
    )
    write_file(
        web_src
        / "modules"
        / "practice"
        / "ui"
        / "freestyle"
        / "components"
        / "FreestyleUnitReviewCardView.tsx",
        "async function undo() {}\n",
    )
    write_file(
        tmp_path / "docs" / "architecture" / "freestyle-immersive-feed.md",
        "Freestyle uses the same rating and undo commands as formal review.\n",
    )

    errors: list[str] = []
    check_architecture.check_freestyle_rating_retap_clears(errors)

    assert any("selected rating must stay clickable" in error for error in errors)
    assert any("shortcuts for the selected rating must still fire" in error for error in errors)
    assert any("undo until the card is unrated" in error for error in errors)
    assert any("tapping the selected rating again clears it" in error for error in errors)


def test_freestyle_rating_retap_clears_accepts_clear_all(
    tmp_path: Path, monkeypatch
) -> None:
    web_src = tmp_path / "apps" / "web" / "src"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)
    write_file(
        web_src / "modules" / "practice" / "ui" / "freestyle" / "components" / "FreestyleRatingBar.tsx",
        "disabled={busy || locked || !hasEncounter}\n",
    )
    write_file(
        web_src
        / "modules"
        / "practice"
        / "ui"
        / "freestyle"
        / "components"
        / "FreestyleUnitReviewCardView.tsx",
        "await undoRating({ clearAll: true })\n",
    )
    write_file(
        tmp_path / "docs" / "architecture" / "freestyle-immersive-feed.md",
        "Tapping the currently selected rating again undoes until the card is unrated.\n",
    )

    errors: list[str] = []
    check_architecture.check_freestyle_rating_retap_clears(errors)

    assert errors == []


def test_freestyle_passed_unit_reopen_requires_finish_helper(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    web_src = tmp_path / "apps" / "web" / "src"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)
    write_file(
        api_src / "modules" / "memory" / "application" / "unit_review_service.py",
        "def start_freestyle_unit_review_session():\n    raise ValueError('passed review unit')\n",
    )
    write_file(
        web_src
        / "modules"
        / "practice"
        / "ui"
        / "freestyle"
        / "components"
        / "FreestyleUnitReviewCardView.tsx",
        "onSaveFailed(rawMessage)\n",
    )
    write_file(
        tmp_path / "docs" / "architecture" / "freestyle-immersive-feed.md",
        "Re-scoring a completed unit amends from that round's original baseline.\n",
    )

    errors: list[str] = []
    check_architecture.check_freestyle_passed_unit_reopen(errors)

    assert any("finish a stale passed session" in error for error in errors)
    assert any("重试 / 跳过这张 / 重建本轮 / 只看不评" in error for error in errors)
    assert any("must not toast English API text" in error for error in errors)
    assert any("passed-unit start must amend" in error for error in errors)


def test_freestyle_passed_unit_reopen_accepts_finish_helper(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    web_src = tmp_path / "apps" / "web" / "src"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)
    write_file(
        api_src / "modules" / "memory" / "application" / "unit_review_service.py",
        "def _finish_stale_passed_freestyle_session():\n    return None\n",
    )
    write_file(
        web_src
        / "modules"
        / "practice"
        / "ui"
        / "freestyle"
        / "components"
        / "FreestyleUnitReviewCardView.tsx",
        "重试\n跳过这张\n重建本轮\n只看不评\n",
    )
    write_file(
        tmp_path / "docs" / "architecture" / "freestyle-immersive-feed.md",
        "must not return `passed review unit cannot start another encounter`. 只看不评.\n",
    )

    errors: list[str] = []
    check_architecture.check_freestyle_passed_unit_reopen(errors)

    assert errors == []


def test_freestyle_rating_last_write_wins_requires_reopen_helper(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    write_file(
        api_src / "modules" / "memory" / "application" / "unit_review_service.py",
        "def rate_review_unit():\n    raise ValueError('active unit review session required')\n",
    )
    write_file(
        tmp_path / "docs" / "architecture" / "freestyle-immersive-feed.md",
        "Re-scoring a completed unit amends from that round's original baseline.\n",
    )

    errors: list[str] = []
    check_architecture.check_freestyle_rating_last_write_wins(errors)

    assert any("reopen a dead freestyle glance" in error for error in errors)
    assert any("latest rating reopens a dead glance" in error for error in errors)
    assert any("idempotent rating replay must stay on this retry glance" in error for error in errors)


def test_freestyle_rating_last_write_wins_accepts_reopen_helper(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    write_file(
        api_src / "modules" / "memory" / "application" / "unit_review_service.py",
        "def _ensure_open_freestyle_rating_target():\n"
        "    return start_freestyle_unit_review_session()\n"
        "retry occurrence must not return the source glance\n",
    )
    write_file(
        tmp_path / "docs" / "architecture" / "freestyle-immersive-feed.md",
        "applies the latest rating; it must not return `active unit review session required`.\n",
    )

    errors: list[str] = []
    check_architecture.check_freestyle_rating_last_write_wins(errors)

    assert errors == []


def test_freestyle_complete_slot_reachable_rejects_last_card_clamp(
    tmp_path: Path, monkeypatch
) -> None:
    web_src = tmp_path / "apps" / "web" / "src"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)
    write_file(
        web_src / "modules" / "practice" / "ui" / "freestyle" / "ImmersiveFreestylePage.tsx",
        "canGoNext={cards.length > 0 && currentIndex < cards.length - 1}\n",
    )
    write_file(
        web_src / "modules" / "practice" / "ui" / "freestyle" / "model" / "roundCompletion.ts",
        "export function isFreestyleRoundComplete() { return false }\n",
    )
    write_file(
        tmp_path / "docs" / "architecture" / "freestyle-immersive-feed.md",
        "the closing card counts sources once.\n",
    )

    errors: list[str] = []
    check_architecture.check_freestyle_complete_slot_reachable(errors)

    assert any("closing snap slot after the last unit" in error for error in errors)
    assert any("open the closing slot" in error for error in errors)
    assert any("canGoNext must include the closing slot" in error for error in errors)
    assert any("last unit still opens the closing slot" in error for error in errors)


def test_freestyle_complete_slot_reachable_accepts_feed_slot_helpers(
    tmp_path: Path, monkeypatch
) -> None:
    web_src = tmp_path / "apps" / "web" / "src"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)
    write_file(
        web_src / "modules" / "practice" / "ui" / "freestyle" / "ImmersiveFreestylePage.tsx",
        "clampFreestyleFeedIndex(index, cards.length, roundComplete)\n"
        "const viewingCompleteSlot = isFreestyleCompleteSlot(visualIndex, cards.length, roundComplete)\n",
    )
    write_file(
        web_src / "modules" / "practice" / "ui" / "freestyle" / "model" / "roundCompletion.ts",
        "export function freestyleFeedSlotCount(cardCount: number, roundComplete: boolean) {\n"
        "  return cardCount + (roundComplete ? 1 : 0)\n"
        "}\n",
    )
    write_file(
        tmp_path / "docs" / "architecture" / "freestyle-immersive-feed.md",
        "open that closing slot so 再来一轮 and 调整配置 stay reachable.\n"
        "settlement 再来一轮 mints via startFreestyleRoundApi.\n",
    )
    write_file(
        web_src
        / "modules"
        / "practice"
        / "ui"
        / "freestyle"
        / "components"
        / "FreestyleRoundCompleteCard.tsx",
        "onAnotherRound()\n再来一轮\ntotalEffectiveSeconds\nbySubject\n",
    )
    write_file(
        web_src
        / "modules"
        / "practice"
        / "ui"
        / "freestyle"
        / "hooks"
        / "useImmersiveQueue.ts",
        "forceStart\nstartNextRound\nstartFreestyleRoundApi\n",
    )

    errors: list[str] = []
    check_architecture.check_freestyle_complete_slot_reachable(errors)

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
        'mobileViewPolicy="guided"\nuseFreestylePhoneFeed()\n',
    )
    write_file(
        web_src / "modules" / "practice" / "ui" / "freestyle" / "ImmersiveFreestylePage.tsx",
        'className="h-full touch-pan-y" palaceMode={ratingScope === \'palace\'}\n',
    )
    write_file(
        web_src
        / "modules"
        / "practice"
        / "ui"
        / "freestyle"
        / "components"
        / "FreestyleFeedPager.tsx",
        "aria-label={palaceMode ? '上一宫殿' : '上一张'}\n",
    )

    errors: list[str] = []
    check_architecture.check_freestyle_canvas_pan(errors)

    assert any("auto" in error and "pan" in error for error in errors)
    assert any("useFreestylePhoneFeed" in error for error in errors)
    assert any("touch-pan-y" in error for error in errors)
    assert any("FreestyleFeedPager" in error for error in errors)
    assert any("page cards" in error for error in errors)
    assert any("上一张" in error for error in errors)


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
    write_file(
        web_src
        / "modules"
        / "practice"
        / "ui"
        / "freestyle"
        / "components"
        / "FreestyleFeedPager.tsx",
        "aria-label=\"上一张\"\n",
    )

    errors: list[str] = []
    check_architecture.check_freestyle_canvas_pan(errors)

    assert errors == []


def test_freestyle_inline_edit_scope_requires_config_and_settings(
    tmp_path: Path, monkeypatch
) -> None:
    web_src = tmp_path / "apps" / "web" / "src"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)
    write_file(
        web_src / "shared" / "preferences" / "flipCardRevealConfig.ts",
        "export interface FlipCardRevealConfig { granularity: 'level' }\n",
    )
    write_file(
        web_src
        / "modules"
        / "practice"
        / "ui"
        / "freestyle"
        / "components"
        / "FreestyleUnitReviewFlipPanel.tsx",
        "scopeBranchUid={isEditMode ? unit.anchor_uid : null}\n",
    )
    write_file(
        web_src / "modules" / "settings" / "ui" / "flip-card" / "FlipCardRevealSettingsDialog.tsx",
        "export function FlipCardRevealSettingsDialog() { return null }\n",
    )
    write_file(
        tmp_path / "docs" / "architecture" / "freestyle-immersive-feed.md",
        "Freestyle inline edit stays on the current unit.\n",
    )

    errors: list[str] = []
    check_architecture.check_freestyle_inline_edit_scope(errors)

    assert any("editScope" in error for error in errors)
    assert any("honor `editScope`" in error for error in errors)
    assert any("expose edit scope" in error for error in errors)
    assert any("configurable `editScope`" in error for error in errors)


def test_freestyle_inline_edit_scope_accepts_unit_or_palace(
    tmp_path: Path, monkeypatch
) -> None:
    web_src = tmp_path / "apps" / "web" / "src"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)
    write_file(
        web_src / "shared" / "preferences" / "flipCardRevealConfig.ts",
        "export type FlipCardEditScope = 'unit' | 'palace'\neditScope: 'unit'\n",
    )
    write_file(
        web_src
        / "modules"
        / "practice"
        / "ui"
        / "freestyle"
        / "components"
        / "FreestyleUnitReviewFlipPanel.tsx",
        "scopeBranchUid={isEditMode && flipCardRevealSettings.settings.editScope !== 'palace' ? unit.anchor_uid : null}\n",
    )
    write_file(
        web_src / "modules" / "settings" / "ui" / "flip-card" / "FlipCardRevealSettingsDialog.tsx",
        "进入编辑 当前专线 整座宫殿\n",
    )
    write_file(
        tmp_path / "docs" / "architecture" / "freestyle-immersive-feed.md",
        "configured in 翻卡设置 (`editScope`).\n",
    )

    errors: list[str] = []
    check_architecture.check_freestyle_inline_edit_scope(errors)

    assert errors == []


def test_freestyle_knowledge_entry_scope_rejects_saved_selection_override(
    tmp_path: Path, monkeypatch
) -> None:
    web_src = tmp_path / "apps" / "web" / "src"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)
    write_file(
        web_src / "modules" / "practice" / "ui" / "freestyle" / "model" / "freestyle-entry-scope.ts",
        "export function applyFreestyleEntryScope(config, palaceId) {\n"
        "  if (config.subject_scope !== 'all' || config.specific_palace_ids.length > 0) return config\n"
        "  return { ...config, specific_palace_ids: [palaceId] }\n"
        "}\n",
    )
    write_file(
        web_src / "modules" / "content" / "ui" / "palace-catalog" / "components" / "palace-list" / "usePalaceListCardActions.tsx",
        "navigate('/review')\n",
    )
    write_file(
        web_src / "modules" / "practice" / "ui" / "freestyle" / "hooks" / "useImmersiveQueue.ts",
        "export function useImmersiveQueue() {}\n",
    )
    write_file(
        tmp_path / "docs" / "architecture" / "freestyle-immersive-feed.md",
        "transient single-palace scope\n",
    )

    errors: list[str] = []
    check_architecture.check_freestyle_knowledge_entry_scope(errors)

    assert any("memory-palace stream" in error for error in errors)
    assert any("must not ignore knowledge-page review" in error for error in errors)
    assert any("shelf review must enter /freestyle?palaceId=" in error for error in errors)
    assert any("locks every stream to one palace" in error for error in errors)


def test_freestyle_knowledge_entry_scope_accepts_stream_lock(
    tmp_path: Path, monkeypatch
) -> None:
    web_src = tmp_path / "apps" / "web" / "src"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)
    write_file(
        web_src / "modules" / "practice" / "ui" / "freestyle" / "model" / "freestyle-entry-scope.ts",
        "lockStreamScope(config.streams.memory_palace, palaceId, 'all')\n"
        "lockStreamScope(config.streams.quiz, palaceId, 'all')\n"
        "export function persistFreestyleConfigWithoutEntryLock() {}\n",
    )
    write_file(
        web_src / "modules" / "content" / "ui" / "palace-catalog" / "components" / "palace-list" / "usePalaceListCardActions.tsx",
        "navigate(`/freestyle?palaceId=${palace.id}`)\n",
    )
    write_file(
        web_src / "modules" / "practice" / "ui" / "freestyle" / "hooks" / "useImmersiveQueue.ts",
        "persistFreestyleConfigWithoutEntryLock(requested, stored)\n",
    )
    write_file(
        tmp_path / "docs" / "architecture" / "freestyle-immersive-feed.md",
        "locking every training stream. A saved selection does not keep showing the full feed.\n",
    )

    errors: list[str] = []
    check_architecture.check_freestyle_knowledge_entry_scope(errors)

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


def test_quiz_create_requires_node_binding_anchor(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    monkeypatch.setattr(
        check_architecture,
        "PALACE_QUIZ_APPLICATION",
        api_src / "modules" / "quiz" / "application",
    )
    write_file(
        api_src / "modules" / "quiz" / "application" / "node_binding.py",
        "def list_palace_node_bindings():\n    return []\n",
    )
    write_file(
        api_src / "modules" / "quiz" / "application" / "questions" / "commands.py",
        "def create_question():\n    return {}\n",
    )
    write_file(
        tmp_path / "docs" / "architecture" / "palace-quiz-boundary.md",
        "# Palace Quiz Boundary\n",
    )

    errors: list[str] = []
    check_architecture.check_quiz_create_requires_node_binding(errors)

    assert any("ensure_create_question_node_bindings" in item for item in errors)
    assert any("DEFAULT_ROOT_BINDING_REASON" in item for item in errors)
    assert any("at least one" in item for item in errors)


def test_palace_memory_lookup_must_keep_full_palace_and_center_bound_node(
    tmp_path: Path, monkeypatch
) -> None:
    web_src = tmp_path / "apps" / "web" / "src"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)
    write_file(
        web_src / "widgets" / "palace-memory-lookup" / "model" / "memoryLookupDialogSupport.ts",
        "export function centerMemoryLookupEditorDocAtNode() {}\n",
    )
    write_file(
        web_src / "widgets" / "palace-memory-lookup" / "PalaceMemoryLookupDialog.tsx",
        "export function PalaceMemoryLookupDialog() { return centerMemoryLookupEditorDocAtNode() }\n",
    )
    write_file(
        tmp_path / "docs" / "architecture" / "quiz-frontend-boundary.md",
        "# Quiz Frontend Boundary\ncenterMemoryLookupEditorDocAtNode\n",
    )

    errors: list[str] = []
    check_architecture.check_palace_memory_lookup_binding_center(errors)

    assert any("resolveMemoryLookupFocusNodeUid" in item for item in errors)
    assert any("focusRequestNodeUid" in item for item in errors)
    assert any("must not re-root or clip editor_doc" in item for item in errors)
    assert any("must not clip the preview with `centerMemoryLookupEditorDocAtNode`" in item for item in errors)
    assert any("bound-node mind-map centering" in item for item in errors)
    assert any("must not document re-rooting or clipping" in item for item in errors)


def test_quiz_answer_mode_primitive_must_live_in_quiz_entity(
    tmp_path: Path, monkeypatch
) -> None:
    web_src = tmp_path / "apps" / "web" / "src"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)
    write_file(
        tmp_path / "docs" / "architecture" / "quiz-frontend-boundary.md",
        "# Quiz Frontend Boundary\n",
    )

    errors: list[str] = []
    check_architecture.check_quiz_answer_mode_primitive(errors)

    assert any("quiz answer-mode primitive is required" in item for item in errors)


def test_quiz_answer_mode_primitive_requires_reveal_and_enter_submit(
    tmp_path: Path, monkeypatch
) -> None:
    web_src = tmp_path / "apps" / "web" / "src"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)
    write_file(
        web_src / "modules" / "quiz" / "domain" / "quiz-entity" / "model" / "quizAnswerMode.ts",
        "export function canSwitchQuizAnswerMode() {}\n"
        "export function mcqReferenceAnswer() {}\n"
        "export function isQuizChoiceShortcutActive() {}\n",
    )
    write_file(
        web_src / "modules" / "quiz" / "domain" / "quiz-entity" / "ui" / "QuizQuestionInteraction.tsx",
        "export function QuizQuestionInteraction() { return '答题方式' }\n",
    )
    write_file(
        tmp_path / "docs" / "architecture" / "quiz-frontend-boundary.md",
        "quiz_answer_mode\n",
    )

    errors: list[str] = []
    check_architecture.check_quiz_answer_mode_primitive(errors)

    assert any("mcqRevealOptions" in item for item in errors)
    assert any("quizInteractionRestoreKey" in item for item in errors)
    assert any("restore shortcut focus" in item for item in errors)
    assert any("submit with Enter" in item for item in errors)


def test_quiz_answer_mode_primitive_requires_stem_rewrite_and_index_pager(
    tmp_path: Path, monkeypatch
) -> None:
    web_src = tmp_path / "apps" / "web" / "src"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)
    write_file(
        web_src / "modules" / "quiz" / "domain" / "quiz-entity" / "model" / "quizAnswerMode.ts",
        "export function canSwitchQuizAnswerMode() {}\n"
        "export function mcqReferenceAnswer() {}\n"
        "export function mcqRevealOptions() {}\n"
        "export function quizInteractionRestoreKey() {}\n"
        "export function isQuizChoiceShortcutActive() {}\n"
        "export function quizDisplayStem() {}\n"
        "export function mcqSubjectiveReferenceAnswer() {}\n",
    )
    write_file(
        web_src / "modules" / "quiz" / "domain" / "quiz-entity" / "ui" / "QuizQuestionInteraction.tsx",
        "export function QuizQuestionInteraction() { return '答题方式 data-quiz-shortcut-surface Enter 提交' }\n",
    )
    write_file(
        tmp_path / "docs" / "architecture" / "quiz-frontend-boundary.md",
        "quiz_answer_mode QuizQuestionIndexPager 题干\n",
    )
    write_file(
        web_src / "widgets" / "freestyle-scope-quiz" / "FreestyleScopeQuizDialog.tsx",
        "export function FreestyleScopeQuizDialog() { return 'flex size-7 items-center justify-center rounded-full' }\n",
    )
    write_file(
        web_src / "widgets" / "node-bound-quiz" / "NodeBoundQuizDialog.tsx",
        "export function NodeBoundQuizDialog() { return 'flex size-7 items-center justify-center rounded-full' }\n",
    )

    errors: list[str] = []
    check_architecture.check_quiz_answer_mode_primitive(errors)

    assert any("mcqSubjectiveRewrite.ts" in item for item in errors)
    assert any("formatMcqSubjectiveAnalysis" in item for item in errors)
    assert any("converted multiple-choice analysis answer line" in item for item in errors)
    assert any("subjective stem display" in item for item in errors)
    assert any("paginated question-index rail" in item for item in errors)
    assert any("FreestyleScopeQuizDialog.tsx" in item and "QuizQuestionIndexPager" in item for item in errors)
    assert any("must not inline the full question-number grid" in item for item in errors)


def test_quiz_answer_mode_primitive_forbids_marked_options_on_converted_mcq(
    tmp_path: Path, monkeypatch
) -> None:
    web_src = tmp_path / "apps" / "web" / "src"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)
    write_file(
        web_src / "modules" / "quiz" / "domain" / "quiz-entity" / "model" / "quizAnswerMode.ts",
        "export function canSwitchQuizAnswerMode() {}\n"
        "export function mcqReferenceAnswer() {}\n"
        "export function mcqRevealOptions() {}\n"
        "export function quizInteractionRestoreKey() {}\n"
        "export function isQuizChoiceShortcutActive() {}\n"
        "export function quizDisplayStem() {}\n"
        "export function mcqSubjectiveReferenceAnswer() {}\n"
        "export function formatMcqSubjectiveAnalysis() {}\n",
    )
    write_file(
        web_src / "modules" / "quiz" / "domain" / "quiz-entity" / "model" / "mcqSubjectiveRewrite.ts",
        "export function rewriteMcqForSubjective() {}\n",
    )
    write_file(
        web_src / "modules" / "quiz" / "domain" / "quiz-entity" / "ui" / "QuizQuestionInteraction.tsx",
        "export function QuizQuestionInteraction() { return '答题方式 data-quiz-shortcut-surface Enter 提交 QuizQuestionStem QuizQuestionIndexPager' }\n",
    )
    write_file(
        web_src / "modules" / "quiz" / "domain" / "quiz-entity" / "ui" / "QuizShortAnswerBlock.tsx",
        "export function ShortAnswerBlock() { return '（正确答案）' }\n",
    )
    write_file(
        tmp_path / "docs" / "architecture" / "quiz-frontend-boundary.md",
        "quiz_answer_mode QuizQuestionIndexPager 题干 first line of the analysis\n",
    )
    write_file(
        web_src / "widgets" / "freestyle-scope-quiz" / "FreestyleScopeQuizDialog.tsx",
        "export function FreestyleScopeQuizDialog() { return 'QuizQuestionIndexPager QuizQuestionStem' }\n",
    )
    write_file(
        web_src / "widgets" / "node-bound-quiz" / "NodeBoundQuizDialog.tsx",
        "export function NodeBoundQuizDialog() { return 'QuizQuestionIndexPager QuizQuestionStem' }\n",
    )

    errors: list[str] = []
    check_architecture.check_quiz_answer_mode_primitive(errors)

    assert any("must not mark options as the correct choice" in item for item in errors)
    assert any("first line of analysis" in item for item in errors)


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


def test_live_study_presence_rejects_sqlite_and_missing_sw_bypass(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    web_root = tmp_path / "apps" / "web"
    write_file(
        tmp_path / "docs" / "architecture" / "live-study-presence.md",
        "controller_client_id SSE 不写数据库\n",
    )
    write_file(
        api_src / "modules" / "session" / "application" / "live_study_room.py",
        "import sqlite3\nprojection = {}\n",
    )
    write_file(web_root / "public" / "sw.js", "self.addEventListener('fetch', () => {})\n")
    context_map = tmp_path / "docs" / "architecture" / "context-map.yaml"
    write_file(context_map, json.dumps({"runtime": {"ports": {}}}))
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    monkeypatch.setattr(check_architecture, "WEB_ROOT", web_root)
    monkeypatch.setattr(check_architecture, "CONTEXT_MAP_PATH", context_map)

    errors: list[str] = []
    check_architecture.check_live_study_presence(errors)

    assert any("sqlite" in error for error in errors)
    assert any("live study SSE" in error for error in errors)
    assert any("LiveStudyPresencePort" in error for error in errors)
    assert any("永久功能" in error for error in errors)
    assert any("useFreestyleLiveMirror" in error for error in errors)
    assert any("LiveStudyPresenceProvider" in error for error in errors)
    assert any("跟随重试" in error for error in errors)
    assert any("hello hydration" in error for error in errors)
    assert any("follow retry" in error for error in errors)
    assert any("BaseHTTPMiddleware" in error for error in errors)


def test_freestyle_scope_quiz_overlay_rejects_training_mode_switch(
    tmp_path: Path, monkeypatch
) -> None:
    web_src = tmp_path / "apps" / "web" / "src"
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    write_file(
        web_src / "widgets" / "freestyle-scope-quiz" / "FreestyleScopeQuizDialog.tsx",
        "training_mode = 'quiz'\n",
    )
    write_file(
        web_src / "shared" / "api" / "contracts" / "freestyle.ts",
        "export type X = never\n",
    )
    write_file(
        api_src / "modules" / "practice" / "presentation" / "router.py",
        "@router.post('/freestyle/rounds/active')\n",
    )
    errors: list[str] = []
    check_architecture.check_freestyle_scope_quiz_overlay(errors)
    assert any("training_mode" in error for error in errors)
    assert any("overlay_quiz_setup_done" in error for error in errors)
    assert any("overlay-quiz ensure" in error for error in errors)
    assert any("overlay-quiz drop-palaces" in error for error in errors)


def test_freestyle_scope_quiz_overlay_requires_parked_progress_and_carry(
    tmp_path: Path, monkeypatch
) -> None:
    web_src = tmp_path / "apps" / "web" / "src"
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    write_file(
        web_src / "widgets" / "freestyle-scope-quiz" / "FreestyleScopeQuizDialog.tsx",
        "export function FreestyleScopeQuizDialog() { return null }\n",
    )
    write_file(
        web_src / "shared" / "api" / "contracts" / "freestyle.ts",
        "export type FreestyleOverlayQuizState = { overlay_quiz_setup_done: boolean }\n"
        "export const overlay_quiz_setup_done = true\n"
        "export type FreestyleOverlayQuestionRange = 'due' | 'all'\n"
        "export const overlay_question_range = 'all'\n",
    )
    write_file(
        api_src / "modules" / "practice" / "presentation" / "router.py",
        "@router.post('/overlay-quiz/ensure')\n@router.post('/overlay-quiz/drop-palaces')\n",
    )
    write_file(
        api_src / "modules" / "practice" / "domain" / "overlay_quiz.py",
        "def normalize_overlay_quiz():\n    return {}\n",
    )
    write_file(
        api_src / "modules" / "practice" / "application" / "round_state_service.py",
        "def start_new_round():\n    return {}\n",
    )
    errors: list[str] = []
    check_architecture.check_freestyle_scope_quiz_overlay(errors)
    assert any("park out-of-scope progress" in error for error in errors)
    assert any("empty overlay quiz progress" in error for error in errors)


def test_freestyle_scope_quiz_overlay_requires_inline_english_and_no_zoom_chrome(
    tmp_path: Path, monkeypatch
) -> None:
    web_src = tmp_path / "apps" / "web" / "src"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)
    monkeypatch.setattr(check_architecture, "API_SRC", tmp_path / "apps" / "api" / "src" / "memory_anki")
    write_file(
        web_src / "widgets" / "freestyle-scope-quiz" / "FreestyleScopeQuizDialog.tsx",
        "export function FreestyleScopeQuizDialog() { return null }\n",
    )
    write_file(
        web_src / "shared" / "ui" / "mindmap-canvas" / "MindMapCanvas.tsx",
        "onZoomIn={state.zoomInCanvas}\nonZoomOut={state.zoomOutCanvas}\n",
    )
    write_file(
        web_src / "modules" / "content" / "ui" / "mindmap-editor" / "MindMapPageToolbar.tsx",
        "export function MindMapPageToolbar() { return quizAction.label }\n",
    )
    write_file(
        web_src
        / "modules"
        / "practice"
        / "ui"
        / "freestyle"
        / "components"
        / "FreestyleUnitReviewFlipPanel.tsx",
        "englishInOverflow\n",
    )
    write_file(
        tmp_path / "docs" / "architecture" / "freestyle-immersive-feed.md",
        "The immersive mind-map toolbar leads with 做题 and puts **英语** in ⋯.\n",
    )
    errors: list[str] = []
    check_architecture.check_freestyle_scope_quiz_overlay(errors)
    assert any("zoom in/out buttons" in error for error in errors)
    assert any("ClipboardList icon" in error for error in errors)
    assert any("keep 英语 inline" in error for error in errors)
    assert any("must not bury 英语" in error for error in errors)
    assert any("immediately left of 文字" in error for error in errors)


def test_timed_session_architecture_requires_dwell_and_segment_markers(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "WEB_SRC", tmp_path / "apps" / "web" / "src")
    monkeypatch.setattr(
        check_architecture,
        "CONTEXT_MAP_PATH",
        tmp_path / "docs" / "architecture" / "context-map.yaml",
    )
    write_file(
        tmp_path / "docs" / "architecture" / "timed-session.md",
        "session_key client_revision operation_id foreground duration_edited\n",
    )
    write_file(
        tmp_path / "docs" / "architecture" / "context-map.yaml",
        json.dumps(
            {
                "runtime": {
                    "ports": {
                        "SessionPort": {
                            "capabilities": [
                                "sessionKeyRegistry",
                                "foregroundIntervals",
                                "singleTerminalWrite",
                                "versionedWrite",
                            ]
                        }
                    }
                }
            }
        ),
    )
    write_file(
        tmp_path / "apps" / "web" / "src" / "modules" / "session" / "domain" / "study-session-entity" / "api" / "studySessionApi.ts",
        "session_key client_revision operation_id\n",
    )
    errors: list[str] = []
    check_architecture.check_timed_session_architecture(errors)
    assert any("sceneSegments" in error for error in errors)
    assert any("15 分钟" in error for error in errors)
    assert any("dwell" in error for error in errors)
    assert any("visiblePageDwell" in error for error in errors)
    assert any("continuousBlock" in error for error in errors)


def test_freestyle_viewing_playhead_rejects_rating_owned_tick(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    web_src = tmp_path / "apps" / "web" / "src"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)
    write_file(
        web_src / "modules" / "practice" / "ui" / "freestyle" / "model" / "freestyleProgressSegments.ts",
        "export function progressSegmentShapeClass(tone) { return tone === 'current' ? 'h-2.5' : 'h-1.5' }\n",
    )
    write_file(
        web_src / "modules" / "practice" / "ui" / "freestyle" / "ImmersiveFreestylePage.tsx",
        "onEarliestUnrated={handleGoToEarliestUnrated}\n",
    )
    write_file(
        web_src / "modules" / "practice" / "ui" / "freestyle" / "components" / "FreestyleFeedPager.tsx",
        "aria-label=\"下一张\"\n",
    )
    write_file(
        web_src / "modules" / "practice" / "ui" / "freestyle" / "hooks" / "useImmersiveQueue.ts",
        "action: 'complete'\n",
    )
    write_file(
        api_src / "modules" / "practice" / "domain" / "round_uncomplete.py",
        "def complete_card():\n    return None\n",
    )
    write_file(
        tmp_path / "docs" / "architecture" / "freestyle-immersive-feed.md",
        "the current tick is taller\n",
    )

    errors: list[str] = []
    check_architecture.check_freestyle_viewing_playhead(errors)

    assert any("viewing playhead must be independent" in error for error in errors)
    assert any("settle the round or seek the earliest unfinished unit" in error for error in errors)
    assert any("settles the round or seeks the earliest unfinished unit" in error for error in errors)
    assert any("uncomplete the round-plan tick" in error for error in errors)
    assert any("cancelled rating from completed_ids" in error for error in errors)
    assert any("viewing playhead and rating-cancel un-light" in error for error in errors)


def test_freestyle_viewing_playhead_accepts_independent_tick(
    tmp_path: Path, monkeypatch
) -> None:
    api_src = tmp_path / "apps" / "api" / "src" / "memory_anki"
    web_src = tmp_path / "apps" / "web" / "src"
    monkeypatch.setattr(check_architecture, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", api_src)
    monkeypatch.setattr(check_architecture, "WEB_SRC", web_src)
    write_file(
        web_src / "modules" / "practice" / "ui" / "freestyle" / "model" / "freestyleProgressSegments.ts",
        "viewing?: boolean\nif (viewing || tone === 'current') return 'h-3.5'\n",
    )
    write_file(
        web_src / "modules" / "practice" / "ui" / "freestyle" / "ImmersiveFreestylePage.tsx",
        "resolveFreestyleCompleteSeek\nonComplete={handleCompleteRound}\n",
    )
    write_file(
        web_src / "modules" / "practice" / "ui" / "freestyle" / "components" / "FreestyleFeedPager.tsx",
        'aria-label="完成"\nonComplete\n',
    )
    write_file(
        web_src / "modules" / "practice" / "ui" / "freestyle" / "hooks" / "useImmersiveQueue.ts",
        "action: 'uncomplete'\n",
    )
    write_file(
        web_src / "modules" / "practice" / "domain" / "queueState.ts",
        "An empty amend glance keeps this-round rating\n",
    )
    write_file(
        api_src / "modules" / "practice" / "domain" / "round_uncomplete.py",
        "def uncomplete_card():\n    return None\n",
    )
    write_file(
        tmp_path / "docs" / "architecture" / "freestyle-immersive-feed.md",
        "The viewing playhead is independent. Clearing the rating also uncompletes that card in the round plan. Fill follows this-round last rating until the learner changes or cancels it. The right-side pager has 完成, not 定位.\n",
    )

    errors: list[str] = []
    check_architecture.check_freestyle_viewing_playhead(errors)

    assert errors == []

