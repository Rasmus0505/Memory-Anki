"""The frontend and backend must lock and reorder queue rows identically.

`queue_order_cases.json` is the shared golden file. The backend owns the rule
(`reorder_unscored_cards`); the frontend overlays a pending reorder on a
server snapshot with `reorderServerPresentedIds`. If either side grows a lock
the other does not know about, one of the two parity tests fails before a
dragged row lands somewhere the server will not keep it.
"""

from __future__ import annotations

import json
from pathlib import Path

from memory_anki.modules.practice.domain.round_plan_normalization import normalize_plan
from memory_anki.modules.practice.domain.round_plan_queue import reorder_unscored_cards

CASES_PATH = Path(__file__).parent / "fixtures" / "queue_order_cases.json"


def test_queue_order_matches_shared_goldens():
    cases = json.loads(CASES_PATH.read_text(encoding="utf-8"))
    assert cases, "shared queue order cases must not be empty"

    for case in cases:
        plan = case["plan"]
        # The frontend applies the rule to a server snapshot, which is already
        # normalized. A fixture normalization would change is not a fair case.
        assert normalize_plan(plan)["presented_ids"] == plan["presented_ids"], case["name"]
        result = reorder_unscored_cards(plan, case["order_ids"])
        assert result["presented_ids"] == case["expected_presented_ids"], case["name"]
