"""颜色门禁自身的正反例：扫描器失效时，不能靠空基线蒙混通过。"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    "color_gate", Path(__file__).with_name("check_architecture.py")
)
assert spec is not None and spec.loader is not None
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


@pytest.mark.parametrize("literal", [
    "'#abc'", '"#abcd"', "color: #AABBcc;", "#aabbccdd",
    "hsl(262 60% 50%)", "hsla(10, 20%, 30%, .2)",
    "rgb(1 2 3)", "rgba(1, 2, 3, .5)", "oklch(.5 .2 100)",
    "oklab(0.5 0.1 0.1)", "hover:bg-violet-300/50", "text-slate-950",
])
def test_counts_literal(literal: str) -> None:
    assert gate.count_color_literals(literal) == 1


@pytest.mark.parametrize("text", [
    "hsl(var(--accent))", "var(--paper)", "text-foreground", "bg-primary/50",
    "#ab", "#abcde", "#abcdefg", "&#123;", "url(/icons.svg#abc)",
    "id-#abc", "src='#anchor'",
])
def test_ignores_tokens_and_non_colors(text: str) -> None:
    assert gate.count_color_literals(text) == 0


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


@pytest.fixture
def workspace(tmp_path: Path, monkeypatch):
    source = tmp_path / "apps/web/src"
    baseline = tmp_path / "docs/architecture/color-literal-baseline.json"
    monkeypatch.setattr(gate, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(gate, "WEB_SRC", source)
    monkeypatch.setattr(gate, "COLOR_LITERAL_BASELINE_PATH", baseline)
    return tmp_path, source, baseline


def test_scans_production_sources_only(workspace) -> None:
    _, source, _ = workspace
    for relative in ["styles/foundation.css", "thing.test.ts", "thing.test.tsx", "test/setup.ts", "readme.md"]:
        write(source / relative, "#abc")
    write(source / "view.tsx", "#abc bg-violet-300 rgb(1 2 3)")
    write(source / "styles/view.css", "color: #abcd;")
    write(source / "tokens.ts", "var(--paper)")
    assert gate.scan_color_literals() == {
        "apps/web/src/view.tsx": 3, "apps/web/src/styles/view.css": 1,
    }


@pytest.mark.parametrize(("allowed", "actual", "message"), [
    (1, 1, None),
    (None, 1, "baseline 0"),
    (1, 2, "baseline 1"),
    (2, 1, "lower the entry"),
    (1, 0, "delete it at 0"),
])
def test_baseline_only_moves_down(workspace, allowed, actual, message) -> None:
    _, source, baseline = workspace
    relative = "apps/web/src/view.tsx"
    write(baseline, json.dumps({relative: allowed} if allowed is not None else {}))
    if actual:
        write(source / "view.tsx", "#abc " * actual)
    errors: list[str] = []
    gate.check_color_literal_ratchet(errors)
    if message is None:
        assert errors == []
    else:
        assert len(errors) == 1
        assert message in errors[0]


def test_missing_baseline_is_an_error(workspace) -> None:
    errors: list[str] = []
    gate.check_color_literal_ratchet(errors)
    assert len(errors) == 1 and "baseline is required" in errors[0]


@pytest.mark.parametrize("payload", ["[", "[]", "null", '{"a": 0}', '{"a": -1}', '{"a": true}', '{"a": "1"}'])
def test_invalid_baseline_is_reported_not_crashed(workspace, payload: str) -> None:
    _, _, baseline = workspace
    write(baseline, payload)
    errors: list[str] = []
    gate.check_color_literal_ratchet(errors)
    assert len(errors) == 1 and "invalid colour literal baseline" in errors[0]
