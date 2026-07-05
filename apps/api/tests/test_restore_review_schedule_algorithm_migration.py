import importlib.util
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


def _load_migration_module():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0009_restore_review_schedule_algorithm_used.py"
    )
    spec = importlib.util.spec_from_file_location(
        "migration_0009_restore_review_schedule_algorithm_used",
        path,
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load restore review schedule algorithm migration")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class RestoreReviewScheduleAlgorithmMigrationTests(unittest.TestCase):
    def test_upgrade_adds_and_backfills_missing_algorithm_used(self):
        migration = _load_migration_module()
        bind = Mock()

        with patch.object(migration, "_column_exists", return_value=False), patch.object(
            migration.op,
            "get_bind",
            return_value=bind,
        ):
            migration.upgrade()

        statements = [call.args[0] for call in bind.exec_driver_sql.call_args_list]
        self.assertIn(
            'ALTER TABLE "review_schedules" ADD COLUMN "algorithm_used" VARCHAR(30)',
            statements,
        )
        self.assertIn(
            'UPDATE "review_schedules" SET "algorithm_used" = ? '
            'WHERE "algorithm_used" IS NULL OR "algorithm_used" = ?',
            statements,
        )

    def test_upgrade_skips_when_algorithm_used_exists(self):
        migration = _load_migration_module()

        with patch.object(migration, "_column_exists", return_value=True), patch.object(
            migration.op,
            "get_bind",
        ) as get_bind:
            migration.upgrade()

        get_bind.assert_not_called()


if __name__ == "__main__":
    unittest.main()
