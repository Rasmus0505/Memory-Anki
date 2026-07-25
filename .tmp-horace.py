import sqlite3, json, re
db=r"E:\memory anki data\data\memory_palace.db"
con=sqlite3.connect(db)
cur=con.cursor()
# search 贺拉斯 or 内饰 or 美国近代
for pid, title, doc in cur.execute("SELECT id, title, editor_doc FROM palaces WHERE deleted_at IS NULL"):
  if not doc: continue
  if "贺拉斯" in doc or "内饰" in doc or "美国近代教育" in (title or "") or "第五节" in (title or ""):
    print("HIT", pid, title)
    if "贺拉斯" in doc:
      for m in re.finditer(r".{0,30}贺拉斯.{0,80}", doc):
        print(" ", m.group(0)[:120])
    if "内饰" in doc:
      for m in re.finditer(r".{0,40}内饰.{0,40}", doc):
        print(" NEISHI", m.group(0))
