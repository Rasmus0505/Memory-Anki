import json
from pathlib import Path

from memory_anki.modules.english.application.cloze_corpus import load_cloze_corpus


def test_missing_corpus_is_an_empty_reader(tmp_path: Path):
    payload = load_cloze_corpus(tmp_path / "missing.json")
    assert payload == {"schema": "english-ii-cloze.v1", "years": []}


def test_corpus_keeps_only_readable_years(tmp_path: Path):
    path = tmp_path / "corpus.json"
    path.write_text(
        json.dumps(
            {
                "schema": "other",
                "years": [
                    {"year": 2010, "paragraphs": ["__1__"], "blanks": []},
                    {"year": "bad", "paragraphs": [], "blanks": []},
                    "skip",
                ],
            }
        ),
        encoding="utf-8",
    )

    payload = load_cloze_corpus(path)

    assert payload["schema"] == "english-ii-cloze.v1"
    assert [item["year"] for item in payload["years"]] == [2010]
