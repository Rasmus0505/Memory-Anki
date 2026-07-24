# temp validate — safe to delete
import json
from pathlib import Path
p = Path(__file__).with_name("ch6_quizzes.json")
d = json.loads(p.read_text(encoding="utf-8"))
assert len(d) == 7
assert sum(len(v) for v in d.values()) == 75
print("json.load OK", {k: len(v) for k, v in d.items()})
