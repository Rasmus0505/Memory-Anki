from pathlib import Path
# search built css for react-flow node overflow/max-width rules
css_dir = Path("apps/web/dist/assets") if Path("apps/web/dist/assets").exists() else None
# also source
import re
for p in Path("apps/web/src").rglob("*.css"):
  t=p.read_text(encoding="utf-8", errors="ignore")
  if "react-flow" in t or "mindmap-node" in t:
    print("===", p)
    for i,line in enumerate(t.splitlines(),1):
      if "react-flow" in line or "mindmap-node" in line or "overflow" in line and "node" in line:
        print(f"{i}:{line[:120]}")
# check node_modules @xyflow for default node overflow
for p in Path("apps/web/node_modules/@xyflow").rglob("*.css"):
  t=p.read_text(encoding="utf-8", errors="ignore")
  if "overflow" in t or "__node" in t:
    for i,line in enumerate(t.splitlines(),1):
      if "overflow" in line or "__node" in line and ("width" in line or "max" in line):
        if i<200 or "overflow" in line:
          print(f"{p.name}:{i}:{line.strip()[:100]}")
