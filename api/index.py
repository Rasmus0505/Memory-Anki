from __future__ import annotations

import sys
from pathlib import Path

API_SRC = Path(__file__).resolve().parents[1] / "apps" / "api" / "src"
if str(API_SRC) not in sys.path:
    sys.path.insert(0, str(API_SRC))

from memory_anki.app.main import app  # noqa: E402
