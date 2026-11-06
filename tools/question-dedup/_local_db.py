# -*- coding: utf-8 -*-
"""解析题库去重脚本要连的数据库。

环境变量 ``MEMORY_ANKI_DB`` 优先；否则读仓库 ``local-config`` 里的
``local_app_home``。个人机器的盘符和目录不写进脚本，换机器只改 local-config。
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def resolve_db_path() -> Path:
    override = os.environ.get("MEMORY_ANKI_DB")
    if override:
        return Path(override).expanduser()
    api_src = REPO_ROOT / "apps" / "api" / "src"
    if str(api_src) not in sys.path:
        sys.path.insert(0, str(api_src))
    from memory_anki.core.local_config import load_local_runtime_config

    config = load_local_runtime_config(repo_root=REPO_ROOT)
    return config.local_app_home / "学习数据" / "memory_palace.db"
