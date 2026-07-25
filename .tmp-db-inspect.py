import sqlite3, json, re
db=r"E:\memory anki data\data\memory_palace.db"
con=sqlite3.connect(db)
con.row_factory=sqlite3.Row
cur=con.cursor()
tables=[r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
print("tables", tables)
for t in tables:
  if any(k in t.lower() for k in ["palace","mind","editor","content","node"]):
    cols=[r[1] for r in cur.execute(f"PRAGMA table_info({t})").fetchall()]
    print(t, cols)
