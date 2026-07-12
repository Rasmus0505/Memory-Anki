from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

CHECKER_PATH = Path(__file__).with_name("check_architecture_v3.py")
spec = importlib.util.spec_from_file_location("check_architecture_v3", CHECKER_PATH)
assert spec and spec.loader
checker = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = checker
spec.loader.exec_module(checker)


def test_declared_modules_have_matching_frontend_and_backend_roots() -> None:
    errors: list[str] = []
    checker.check_module_shape(errors, checker.load_modules())
    assert errors == []


def test_private_cross_module_backend_import_is_rejected(tmp_path, monkeypatch) -> None:
    modules_root = tmp_path / "modules"
    source = modules_root / "training" / "application" / "handler.py"
    source.parent.mkdir(parents=True)
    source.write_text(
        "from memory_anki.modules.assessment.domain.question import Question\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(checker, "API_MODULES", modules_root)
    monkeypatch.setattr(checker, "REPO_ROOT", tmp_path)
    modules = {
        "training": checker.ArchitectureModule("training", frozenset({"assessment"}), ("training_",)),
        "assessment": checker.ArchitectureModule("assessment", frozenset(), ("assessment_",)),
    }
    errors: list[str] = []
    checker.check_backend_dependencies(errors, modules)
    assert errors == [
        f"{source.relative_to(checker.REPO_ROOT).as_posix()}: cross-module imports must use assessment.public or assessment.contract"
    ]


def test_use_case_catalog_requires_existing_test(tmp_path, monkeypatch) -> None:
    catalog = tmp_path / "use-cases.yaml"
    catalog.write_text(json.dumps({"useCases": {"x": {"owner": "training", "tests": ["missing.py"]}}}), encoding="utf-8")
    monkeypatch.setattr(checker, "USE_CASES", catalog)
    monkeypatch.setattr(checker, "REPO_ROOT", tmp_path)
    modules = {"training": checker.ArchitectureModule("training", frozenset(), ("training_",))}
    errors: list[str] = []
    checker.check_use_case_catalog(errors, modules)
    assert errors == ["docs/architecture/use-cases.yaml: x test does not exist: missing.py"]
