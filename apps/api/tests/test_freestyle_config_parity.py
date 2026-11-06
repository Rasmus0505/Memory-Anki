"""The frontend and backend must normalize the same feed config identically.

`freestyle_config_cases.json` is the shared golden file: the backend test pins
the expected shape, and the frontend test reads the same file. Adding a field on
one side only breaks one of the two tests, instead of shipping a config the
other side silently drops.
"""

from __future__ import annotations

import json
from pathlib import Path

from memory_anki.modules.practice.domain.feed_config import sanitize_feed_config

CASES_PATH = Path(__file__).parent / "fixtures" / "freestyle_config_cases.json"


def test_freestyle_config_sanitizer_matches_shared_goldens():
    cases = json.loads(CASES_PATH.read_text(encoding="utf-8"))
    assert cases, "shared config cases must not be empty"

    for case in cases:
        assert sanitize_feed_config(case["input"]) == case["expected"], case["name"]
