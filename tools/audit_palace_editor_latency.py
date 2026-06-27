from __future__ import annotations

import json
import sys
import time
from dataclasses import dataclass, asdict
from typing import Any
from urllib.error import URLError
from urllib.request import urlopen


BASE_URL = "http://127.0.0.1:5173/api/v1"


@dataclass
class PalaceEditorAuditRow:
    id: int
    title: str
    review_id: int | None
    bytes: int | None
    latency_ms: float
    doc_chars: int | None
    error: str | None = None


def fetch_json(url: str, timeout: float = 60.0) -> Any:
    with urlopen(url, timeout=timeout) as response:
        return json.load(response)


def main() -> int:
    try:
        grouped = fetch_json(f"{BASE_URL}/palaces/grouped-summary")
    except URLError as exc:
        print(json.dumps({"error": f"无法访问 grouped-summary: {exc}"}, ensure_ascii=False))
        return 1

    rows: list[PalaceEditorAuditRow] = []
    for group in grouped.get("groups", []):
        for palace in group.get("palaces", []):
            palace_id = int(palace["id"])
            title = str(palace.get("resolved_title") or palace.get("title") or "")
            review_id = palace.get("current_review_schedule_id")
            started_at = time.perf_counter()
            try:
                with urlopen(f"{BASE_URL}/palaces/{palace_id}/editor", timeout=60.0) as response:
                    raw = response.read()
                latency_ms = round((time.perf_counter() - started_at) * 1000, 2)
                parsed = json.loads(raw)
                doc = parsed.get("editor_doc")
                doc_chars = len(json.dumps(doc, ensure_ascii=False)) if isinstance(doc, dict) else None
                rows.append(
                    PalaceEditorAuditRow(
                        id=palace_id,
                        title=title,
                        review_id=int(review_id) if isinstance(review_id, int) else None,
                        bytes=len(raw),
                        latency_ms=latency_ms,
                        doc_chars=doc_chars,
                    )
                )
            except Exception as exc:  # noqa: BLE001 - audit tool should keep going
                latency_ms = round((time.perf_counter() - started_at) * 1000, 2)
                rows.append(
                    PalaceEditorAuditRow(
                        id=palace_id,
                        title=title,
                        review_id=int(review_id) if isinstance(review_id, int) else None,
                        bytes=None,
                        latency_ms=latency_ms,
                        doc_chars=None,
                        error=repr(exc),
                    )
                )

    rows.sort(key=lambda item: (item.error is None, -(item.latency_ms)), reverse=True)
    payload = {
        "base_url": BASE_URL,
        "palace_count": len(rows),
        "high_risk": [asdict(row) for row in rows[:10]],
        "all": [asdict(row) for row in rows],
    }
    json.dump(payload, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
