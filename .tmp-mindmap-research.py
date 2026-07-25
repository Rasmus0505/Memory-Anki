import json
import urllib.request
from urllib.parse import quote

repos = [
    "wanglin2/mind-map",
    "ssshooter/mind-elixir-core",
    "markmap/markmap",
    "hizzgdev/jsmind",
    "fex-team/kityminder-core",
    "xyflow/xyflow",
    "antvis/G6",
    "antvis/X6",
    "d3/d3-hierarchy",
    "awehook/react-mindmap",
    "NexusGPU/mind-elixir",
    "i5ting/mindmap",
    "pubuzhixing8/mind-elixir-core",
    "leungwensen/mindmap-layouts",
    "ondras/my-mind",
    "drichard/mindmaps",
    "somedays/mindmap",
    "Yomguithereal/react-sigma",
    "jacomyal/sigma.js",
    "vasturiano/react-force-graph",
]

print("=== Known mindmap / graph projects ===")
for full in repos:
    try:
        with urllib.request.urlopen(f"https://api.github.com/repos/{full}") as r:
            d = json.load(r)
        desc = (d.get("description") or "")[:110]
        print(f"{d['stargazers_count']:6d}  {d['full_name']:42s}  {desc}")
    except Exception as e:
        print(f"ERR    {full:42s}  {e}")

print("\n=== Search: mind map typescript ===")
url = (
    "https://api.github.com/search/repositories?q="
    + quote("mind map OR mindmap stars:>1000")
    + "&sort=stars&order=desc&per_page=20"
)
with urllib.request.urlopen(url) as r:
    d = json.load(r)
print("total", d.get("total_count"))
for i in d.get("items", []):
    desc = (i.get("description") or "")[:100]
    print(f"{i['stargazers_count']:6d}  {i['full_name']:42s}  {desc}")
