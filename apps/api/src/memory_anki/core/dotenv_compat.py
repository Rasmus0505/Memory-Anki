from __future__ import annotations

import os
from pathlib import Path

try:
    from dotenv import load_dotenv as _load_dotenv
except (ImportError, AttributeError):
    _load_dotenv = None


def _fallback_load_dotenv(dotenv_path: str | os.PathLike[str] = ".env") -> bool:
    path = Path(dotenv_path)
    if not path.exists():
        return False
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue
        os.environ[key] = value.strip().strip('"').strip("'")
    return True


def load_dotenv(dotenv_path: str | os.PathLike[str] = ".env", *args, **kwargs) -> bool:
    if _load_dotenv is not None:
        return bool(_load_dotenv(dotenv_path, *args, **kwargs))
    return _fallback_load_dotenv(dotenv_path)
