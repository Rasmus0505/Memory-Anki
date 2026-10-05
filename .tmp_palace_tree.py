import json
import sqlite3

db = r"F:\memory anki data\学习数据\memory_palace.db"
con = sqlite3.connect(db)
con.row_factory = sqlite3.Row
cur = con.cursor()
import re

def plain(text):
    text = str(text or "")
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    return text.replace("&nbsp;", " ").strip()

row = cur.execute("SELECT editor_doc FROM palaces WHERE id=17").fetchone()
doc = json.loads(row[0])
root = doc.get("root") or doc

found = []

def walk(node, parent, depth):
    if not isinstance(node, dict):
        return
    data = node.get("data") or {}
    uid = str(data.get("uid") or data.get("id") or "")
    text = plain(data.get("text"))
    children = node.get("children") or []
    item = {
        "uid": uid,
        "text": text[:40],
        "raw": str(data.get("text") or "")[:80],
        "rich": data.get("richText"),
        "split": data.get("permanentSplitMark"),
        "parent": parent,
        "nchildren": len(children),
        "child_texts": [plain((c.get("data") or {}).get("text"))[:24] for c in children if isinstance(c, dict)],
        "depth": depth,
    }
    if "智者" in text or "古典时期" in text or (parent and parent.get("text", "").startswith("智者")):
        found.append(item)
    for child in children:
        walk(child, {"uid": uid, "text": text[:40]}, depth + 1)

walk(root, None, 0)
print("matches", len(found))
for item in found:
    print(json.dumps(item, ensure_ascii=False))
