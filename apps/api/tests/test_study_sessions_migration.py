import importlib.util
import unittest
from datetime import datetime
from pathlib import Path


def _load_migration_module():
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0007_study_sessions.py"
    spec = importlib.util.spec_from_file_location("migration_0007_study_sessions", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load study sessions migration")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class StudySessionsMigrationTests(unittest.TestCase):
    def test_iso_datetime_accepts_sqlite_string_values(self):
        migration = _load_migration_module()

        self.assertEqual(
            migration._iso_datetime("2026-07-05 13:00:00"),
            "2026-07-05 13:00:00",
        )
        self.assertEqual(
            migration._iso_datetime(datetime(2026, 7, 5, 13, 0, 0)),
            "2026-07-05T13:00:00",
        )


if __name__ == "__main__":
    unittest.main()
