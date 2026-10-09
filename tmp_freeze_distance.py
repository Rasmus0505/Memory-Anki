from pathlib import Path

arch = Path("tools/check_architecture.py").read_text(encoding="utf-8")
src = Path(
    "apps/api/src/memory_anki/modules/practice/application/round_state_service.py"
).read_text(encoding="utf-8")
marker = "plan_is_fully_handled(next_plan) and not persist_config"
needle_at = arch.find(marker)
quote = arch.find('"return _payload(row)"', needle_at)
needle = arch[quote + 1 : arch.find('"', quote + 1)]
suffix = src.split(marker, 1)[1]
print("in220", needle in suffix[:220])
print("pos", suffix.find(needle))
print("crlf", "\r\n" in src)
