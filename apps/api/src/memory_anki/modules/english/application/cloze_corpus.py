from __future__ import annotations

import json
from pathlib import Path

from memory_anki.core.config import LEARNING_DIR

CLOZE_SCHEMA = "english-ii-cloze.v1"
CORPUS_RELATIVE = Path("english-cloze") / "corpus.json"


def cloze_corpus_path() -> Path:
    return LEARNING_DIR / CORPUS_RELATIVE


def empty_cloze_corpus() -> dict:
    return {"schema": CLOZE_SCHEMA, "years": []}


def load_cloze_corpus(path: Path | None = None) -> dict:
    target = path or cloze_corpus_path()
    if not target.is_file():
        return empty_cloze_corpus()
    try:
        payload = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return empty_cloze_corpus()
    if not isinstance(payload, dict):
        return empty_cloze_corpus()
    years = payload.get("years")
    if not isinstance(years, list):
        return empty_cloze_corpus()
    return {"schema": CLOZE_SCHEMA, "years": [year for year in years if _year_ok(year)]}


def _year_ok(year: object) -> bool:
    if not isinstance(year, dict):
        return False
    if not isinstance(year.get("year"), int):
        return False
    paragraphs = year.get("paragraphs")
    blanks = year.get("blanks")
    return isinstance(paragraphs, list) and isinstance(blanks, list)
