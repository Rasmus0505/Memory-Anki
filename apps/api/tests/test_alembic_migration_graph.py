"""Validate revision metadata without loading env.py or connecting to a database."""

from __future__ import annotations

import ast
from io import StringIO
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory

MERGE_REVISION = "0067_merge_quiz_heads"
MERGED_HEADS = (
    "0050_quiz_node_binding_single_palace",
    "0066_quiz_practice_progress",
)


def _graph_config() -> Config:
    # Do not load alembic.ini, runtime configuration, or a database URL.
    config = Config(stdout=StringIO())
    config.set_main_option("script_location", str(Path(__file__).parents[1] / "alembic"))
    return config


def test_alembic_graph_has_one_head_without_running_environment(monkeypatch):
    def forbid_environment(_self):
        raise AssertionError("Revision graph checks must not execute env.py")

    monkeypatch.setattr(ScriptDirectory, "run_env", forbid_environment)
    config = _graph_config()
    command.heads(config)
    graph = ScriptDirectory.from_config(config)

    assert len(graph.get_heads()) == 1
    assert graph.get_current_head() is not None
    assert MERGE_REVISION in {revision.revision for revision in graph.walk_revisions()}


def test_quiz_merge_preserves_both_branch_heads():
    graph = ScriptDirectory.from_config(_graph_config())
    merge = graph.get_revision(MERGE_REVISION)

    assert merge is not None
    assert merge.down_revision == MERGED_HEADS
    assert merge.branch_labels == set()
    assert merge.dependencies is None
    for parent in MERGED_HEADS:
        assert graph.get_revision(parent) is not None


def test_quiz_merge_upgrade_and_downgrade_are_pass_only():
    graph = ScriptDirectory.from_config(_graph_config())
    merge = graph.get_revision(MERGE_REVISION)
    assert merge is not None
    tree = ast.parse(Path(merge.path).read_text(encoding="utf-8"))
    functions = {node.name: node for node in tree.body if isinstance(node, ast.FunctionDef)}

    for name in ("upgrade", "downgrade"):
        assert len(functions[name].body) == 1
        assert isinstance(functions[name].body[0], ast.Pass)
        # These functions must also remain callable without an Alembic operation context.
        assert getattr(merge.module, name)() is None
