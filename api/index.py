from __future__ import annotations

import os
import sys
from pathlib import Path

os.environ.setdefault("MEMORY_ANKI_DEPLOY_TARGET", "cloud")
os.environ.setdefault("MEMORY_ANKI_HOME", "/tmp/memory-anki")

API_SRC = Path(__file__).resolve().parents[1] / "apps" / "api" / "src"
if str(API_SRC) not in sys.path:
    sys.path.insert(0, str(API_SRC))

from memory_anki.app.main import app  # noqa: E402
