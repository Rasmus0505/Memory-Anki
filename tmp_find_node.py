import json
import sqlite3

db = r"F:\memory anki data\学习数据\memory_palace.db"
c = sqlite3.connect(db)
print("=== review_unit_states palace 17")
rows = c.execute(
    "SELECT id, anchor_uid, unit_kind, node_uids_json, active, stage_index FROM review_unit_states WHERE palace_id=17"
).fetchall()
for row in rows:
    uids = json.loads(row[3] or "[]")
    print(row[0], row[2], "anchor", row[1], "active", row[4], "stage", row[5], "n", len(uids))
    interesting = {
        "db564e38ea9a42ca84a17dfa1a9bfab5",
        "f298dfeb42084ff096d33e4dbeca79a3",
        "127211fe1d364471acd1cf9a6d8dce3e",
        "8055ba80-00d8-4206-8cab-604ba072345d",
        "361939713a6b427c96a2bfdc16fa77b4",
        "cdae0468506244ebb091cef94587e543",
    }
    hit = [u for u in uids if u in interesting]
    if row[1] in interesting or hit:
        print("  HIT anchor", row[1] in interesting, "members", hit)

print("=== freestyle_round_states cols")
print([r[1] for r in c.execute("PRAGMA table_info(freestyle_round_states)")])
