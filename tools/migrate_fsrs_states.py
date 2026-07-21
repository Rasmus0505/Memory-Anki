from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps" / "api" / "src"))

from memory_anki.infrastructure.db._tables import get_session
from memory_anki.modules.reviews.application.legacy_migration import migrate_legacy_node_states

parser = argparse.ArgumentParser(description="Backfill node-level FSRS state from legacy palace stages")
parser.add_argument("--palace-id", type=int, default=None)
args = parser.parse_args()
with get_session() as session:
    print(json.dumps(migrate_legacy_node_states(session, palace_id=args.palace_id), ensure_ascii=False))
