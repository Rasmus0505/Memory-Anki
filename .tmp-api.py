import urllib.request, json, sys
sys.stdout.reconfigure(encoding="utf-8")
# list endpoints
req = urllib.request.Request("http://127.0.0.1:8012/api/v1/palaces/39")
try:
  with urllib.request.urlopen(req, timeout=5) as r:
    data = json.loads(r.read().decode("utf-8"))
    print("title", data.get("title") or data.get("palace",{}).get("title"))
except Exception as e:
  print("err", e)
# Try editor state
for path in [
  "/api/v1/palaces/39/editor-state",
  "/api/v1/palaces/39/editor",
  "/api/v1/content/palaces/39/editor-state",
]:
  try:
    with urllib.request.urlopen("http://127.0.0.1:8012"+path, timeout=5) as r:
      print(path, r.status, r.read()[:80])
  except Exception as e:
    print(path, type(e).__name__, e)
