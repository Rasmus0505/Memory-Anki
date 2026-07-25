import sqlite3, json, re
db=r"E:\memory anki data\data\memory_palace.db"
con=sqlite3.connect(db)
cur=con.cursor()
rows=cur.execute("SELECT id, title FROM palaces WHERE deleted_at IS NULL").fetchall()
print("palace count", len(rows))
hits=[]
for pid, title in rows:
  doc=cur.execute("SELECT editor_doc FROM palaces WHERE id=?", (pid,)).fetchone()[0]
  if not doc: continue
  if "现实性" in doc or "夸美纽斯" in doc or "今生" in doc:
    hits.append((pid, title, "现实性" in doc, "夸美纽斯" in doc))
print("hits", hits)
for pid, title, *_ in hits:
  doc=cur.execute("SELECT editor_doc FROM palaces WHERE id=?", (pid,)).fetchone()[0]
  # find nodes with highlight near 现实性
  # search for markColor and highlight snippets
  for m in re.finditer(r".{0,80}现实性.{0,80}", doc):
    print("CONTEXT", pid, m.group(0)[:200])
  for m in re.finditer(r"markColor.{0,40}", doc):
    pass
  # count markColor and highlight
  print(pid, "title", title, "markColor count", doc.count("markColor"), "highlight count", doc.count("data-emphasis"))
  # extract nodes with markColor
  try:
    data=json.loads(doc)
  except Exception as e:
    print("json err", e)
    continue
  def walk(n, path=""):
    d=n.get("data") or {}
    text=str(d.get("text") or "")
    mark=d.get("markColor")
    if mark or "data-emphasis" in text or "现实性" in text or "今生" in text:
      plain=re.sub(r"<[^>]+>","",text)[:60]
      print(" NODE", path, "mark", mark, "plain", plain, "hasHL", "data-emphasis" in text)
    for i,c in enumerate(n.get("children") or []):
      walk(c, path+f"/{i}")
  walk(data.get("root") or data)
