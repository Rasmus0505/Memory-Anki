import os
import sys
import time
from pathlib import Path

repo = Path(r"D:\BaiduSyncdisk\Memory Anki")
sys.path.insert(0, str(repo / "apps" / "api" / "src"))
os.chdir(repo)

from memory_anki.core.local_config import load_local_runtime_config

home = load_local_runtime_config().local_app_home
os.environ["MEMORY_ANKI_HOME"] = str(home)
root = Path(home) / "学习数据" / "time-ledger"
files = list(root.glob("devices/*/revisions/*.json")) if root.exists() else []
total_bytes = sum(path.stat().st_size for path in files)
print(f"ledger_files={len(files)} bytes={total_bytes} root={root}", flush=True)

from memory_anki.infrastructure.time_ledger_store import read_intervals

for label, kwargs in (("visible", {}), ("deleted", {"include_deleted": True})):
    started = time.perf_counter()
    rows = read_intervals(**kwargs)
    elapsed_ms = (time.perf_counter() - started) * 1000
    print(f"read_intervals {label} {elapsed_ms:.0f}ms rows={len(rows)}", flush=True)
