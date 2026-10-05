p = r"apps/web/node_modules/@xyflow/react/dist/esm/index.js"
t = open(p, encoding="utf-8").read()
chunk = t[141500:144500]
print("NodeRenderer" in chunk, "EdgeRenderer" in chunk)
i = chunk.find("NodeRenderer")
print("node at", i)
print(chunk[i-80:i+200] if i>=0 else chunk[-400:])
