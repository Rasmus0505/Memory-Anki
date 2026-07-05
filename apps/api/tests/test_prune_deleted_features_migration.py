import importlib.util
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


def _load_migration_module():
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0008_prune_deleted_features.py"
    spec = importlib.util.spec_from_file_location("migration_0008_prune_deleted_features", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load prune deleted features migration")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PruneDeletedFeaturesMigrationTests(unittest.TestCase):
    def test_drop_index_once_only_drops_existing_index(self):
        migration = _load_migration_module()

        with patch.object(migration, "_index_exists", return_value=True), patch.object(
            migration.op,
            "drop_index",
        ) as drop_index:
            migration._drop_index_once("ix_old", "session_progress")
        drop_index.assert_called_once_with("ix_old", table_name="session_progress")

        with patch.object(migration, "_index_exists", return_value=False), patch.object(
            migration.op,
            "drop_index",
        ) as drop_index:
            migration._drop_index_once("ix_old", "session_progress")
        drop_index.assert_not_called()

    def test_upgrade_preserves_review_schedule_algorithm_used(self):
        migration = _load_migration_module()

        with patch.object(migration, "_drop_table_once"), patch.object(
            migration,
            "_drop_index_once",
        ), patch.object(migration, "_drop_column_once") as drop_column, patch.object(
            migration,
            "_table_exists",
            return_value=False,
        ), patch.object(
            migration.op,
            "get_bind",
            return_value=Mock(),
        ):
            migration.upgrade()

        self.assertNotIn(
            ("review_schedules", "algorithm_used"),
            [call.args for call in drop_column.call_args_list],
        )


if __name__ == "__main__":
    unittest.main()
