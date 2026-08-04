from __future__ import annotations

from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from memory_anki.modules.english_lookup.application import (
    cambridge_engine,
    google_translate_engine,
    vocabulary_engine,
)
from memory_anki.modules.english_lookup.application.normalize import (
    is_valid_lookup_query,
    validate_lookup_query,
)
from memory_anki.modules.english_lookup.application.service import (
    translate_english_text,
)

FIXTURES = Path(__file__).parent / "fixtures" / "english_lookup"


class NormalizeLookupQueryTests(TestCase):
    def test_accepts_one_to_five_words(self) -> None:
        normalized, count = validate_lookup_query("  Mother-in-law  ")
        self.assertEqual(normalized, "Mother-in-law")
        self.assertEqual(count, 1)
        self.assertTrue(is_valid_lookup_query(normalized, count))

        normalized, count = validate_lookup_query("look up to")
        self.assertEqual(count, 3)

    def test_rejects_six_words(self) -> None:
        normalized, count = validate_lookup_query("one two three four five six")
        self.assertEqual(count, 6)
        self.assertFalse(is_valid_lookup_query(normalized, count))

    def test_rejects_non_english(self) -> None:
        normalized, count = validate_lookup_query("你好")
        self.assertEqual(normalized, "")
        self.assertEqual(count, 0)


class VocabularyEngineTests(TestCase):
    def test_parses_short_and_long(self) -> None:
        html = (FIXTURES / "vocabulary_sample.html").read_text(encoding="utf-8")
        with patch(
            "memory_anki.modules.english_lookup.application.vocabulary_engine.fetch_html",
            return_value=html,
        ):
            result = vocabulary_engine.search("example")
        self.assertEqual(result["status"], "ok")
        self.assertIn("characteristic", result["short"])
        self.assertIn("representative", result["long"])


class CambridgeEngineTests(TestCase):
    def test_parses_entries_and_audio(self) -> None:
        html = (FIXTURES / "cambridge_sample.html").read_text(encoding="utf-8")
        with patch(
            "memory_anki.modules.english_lookup.application.cambridge_engine.fetch_html",
            return_value=html,
        ):
            result = cambridge_engine.search("example")
        self.assertEqual(result["status"], "ok")
        self.assertEqual(len(result["entries"]), 1)
        self.assertIn("例子", result["entries"][0]["html"])
        self.assertEqual(
            result["audio"]["us"],
            "https://dictionary.cambridge.org/media/us/example.mp3",
        )
        self.assertEqual(
            result["audio"]["uk"],
            "https://dictionary.cambridge.org/media/uk/example.mp3",
        )
        self.assertIn("dict-speaker", result["entries"][0]["html"])
        self.assertNotIn("share", result["entries"][0]["html"])


class GoogleTranslateEngineTests(TestCase):
    def test_combines_google_translation_segments(self) -> None:
        payload = [[['你好，', 'Hello, ', None, None], ['世界！', 'world!', None, None]], None, 'en']
        with patch.object(google_translate_engine, "_fetch_translation", return_value=payload):
            result = google_translate_engine.search("Hello, world!")
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["translation"], "你好，世界！")
        self.assertEqual(result["detectedLanguage"], "en")

    def test_parses_batchexecute_response(self) -> None:
        inner = [
            None,
            [[[None, None, None, None, None, [["你好", None, None, None, None, None, "Hello", 1]]]]],
            "en",
        ]
        envelope = [["wrb.fr", "MkEWBc", __import__("json").dumps(inner), None, None, None, "generic"]]
        raw = ")]}'\n\n123\n" + __import__("json").dumps(envelope) + "\n"
        parsed = google_translate_engine._parse_batchexecute(raw)
        self.assertEqual(parsed[0][0][0], "你好")
        self.assertEqual(parsed[2], "en")

    def test_translate_service_returns_standalone_contract(self) -> None:
        translated = {
            "status": "ok",
            "translation": "你好",
            "detectedLanguage": "en",
            "error": None,
            "sourceUrl": "https://translate.google.com/",
        }
        with patch.object(google_translate_engine, "search", return_value=translated):
            result = translate_english_text("  Hello!  ")
        self.assertEqual(result["query"], "Hello!")
        self.assertEqual(result["translation"], "你好")
