from pathlib import Path

import pytest

from tools import quality_gate


def test_isolated_validation_build_keeps_live_dist_untouched(monkeypatch):
    monkeypatch.setattr(quality_gate, "_executable", lambda name: name)
    monkeypatch.setenv("MEMORY_ANKI_VALIDATION_OUT_DIR", "dist-validation")
    steps = quality_gate.build_steps(area="frontend", full=True)
    build = next(step for step in steps if step.name == "frontend build")
    assert build.command[-3:] == ("--", "--outDir", "dist-validation")
    assert build.cwd == quality_gate.WEB_ROOT
    assert all("launcher" not in step.name.lower() for step in steps)


@pytest.mark.parametrize("output", ["dist", "../live", str(Path.cwd())])
def test_validation_output_rejects_live_or_external_directories(monkeypatch, output):
    monkeypatch.setattr(quality_gate, "_executable", lambda name: name)
    monkeypatch.setenv("MEMORY_ANKI_VALIDATION_OUT_DIR", output)
    with pytest.raises(ValueError, match="relative directory"):
        quality_gate.build_steps(area="frontend", full=True)
