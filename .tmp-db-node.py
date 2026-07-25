import sqlite3, json, re
db=r"E:\memory anki data\data\memory_palace.db"
con=sqlite3.connect(db)
cur=con.cursor()
doc=json.loads(cur.execute("SELECT editor_doc FROM palaces WHERE id=39").fetchone()[0])

def walk(n, path=""):
  d=n.get("data") or {}
  text=str(d.get("text") or "")
  uid=d.get("uid")
  if "现实性" in text or "今生" in text or "永生" in text or path.startswith("/1/0"):
    print("="*60)
    print("path", path, "uid", uid)
    print("TEXT RAW:")
    print(text[:500])
    print("markColor", d.get("markColor"), "richText", d.get("richText"))
  for i,c in enumerate(n.get("children") or []):
    walk(c, path+f"/{i}")
walk(doc.get("root") or doc)

# Also print parent structure of /1
root=doc["root"]
n=root
# print first two levels titles
def titles(n, depth=0):
  if depth>3: return
  d=n.get("data") or {}
  t=re.sub(r"<[^>]+>","", str(d.get("text") or ""))[:40]
  print("  "*depth + t)
  for c in (n.get("children") or [])[:8]:
    titles(c, depth+1)
print("\nTREE:")
titles(root)
