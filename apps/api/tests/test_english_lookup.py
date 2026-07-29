from __future__ import annotations

from pathlib import Path
from threading import Event
from unittest import TestCase
from unittest.mock import patch

from memory_anki.modules.english_lookup.application import (
    cambridge_engine,
    google_translate_engine,
    service,
    vocabulary_engine,
)
from memory_anki.modules.english_lookup.application.normalize import (
    is_valid_lookup_query,
    validate_lookup_query,
)
from memory_anki.modules.english_lookup.application.service import (
    search_english_lookup,
    translate_english_text,
)
from memory_anki.modules.english_lookup.domain.errors import EnglishLookupError

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


class SearchOrchestrationTests(TestCase):
    def test_rejects_invalid_query(self) -> None:
        with self.assertRaises(EnglishLookupError) as empty_ctx:
            search_english_lookup("   ")
        self.assertIn("1000", str(empty_ctx.exception))

    def test_merges_parallel_engine_results(self) -> None:
        vocab = {
            "status": "ok",
            "short": "s",
            "long": "l",
            "error": None,
            "sourceUrl": "https://www.vocabulary.com/dictionary/x",
        }
        cam = {
            "status": "ok",
            "entries": [{"id": "e0", "html": "<div/>"}],
            "audio": {"us": "https://a/us.mp3", "uk": None},
            "error": None,
            "sourceUrl": "https://dictionary.cambridge.org/x",
        }
        google = {
            "status": "ok",
            "translation": "例子",
            "detectedLanguage": "en",
            "error": None,
            "sourceUrl": "https://translate.google.com/",
        }
        with (
            patch(
                "memory_anki.modules.english_lookup.application.vocabulary_engine.search",
                return_value=vocab,
            ),
            patch(
                "memory_anki.modules.english_lookup.application.cambridge_engine.search",
                return_value=cam,
            ),
            patch(
                "memory_anki.modules.english_lookup.application.google_translate_engine.search",
                return_value=google,
            ),
        ):
            payload = search_english_lookup("example")
        self.assertEqual(payload["query"], "example")
        self.assertEqual(payload["wordCount"], 1)
        self.assertIn("vocabulary", payload)
        self.assertIn("cambridge", payload)
        self.assertEqual(payload["vocabulary"]["short"], "s")
        self.assertEqual(payload["vocabulary"]["long"], "l")
        self.assertEqual(payload["audio"]["us"], "https://a/us.mp3")
        self.assertIsNone(payload["audio"]["uk"])
        self.assertEqual(payload["cambridge"]["entries"][0]["id"], "e0")
        self.assertEqual(payload["google"]["translation"], "例子")
        self.assertEqual(
            payload["sourceUrls"]["vocabulary"],
            "https://www.vocabulary.com/dictionary/x",
        )
        self.assertEqual(
            payload["sourceUrls"]["cambridge"],
            "https://dictionary.cambridge.org/x",
        )

    def test_sentence_skips_dictionaries_but_runs_google(self) -> None:
        google = {
            "status": "ok",
            "translation": "这是一个完整的句子。",
            "detectedLanguage": "en",
            "error": None,
            "sourceUrl": "https://translate.google.com/",
        }
        with (
            patch.object(google_translate_engine, "search", return_value=google),
            patch.object(vocabulary_engine, "search") as vocabulary_search,
            patch.object(cambridge_engine, "search") as cambridge_search,
        ):
            payload = search_english_lookup("This is a complete English sentence.")
        vocabulary_search.assert_not_called()
        cambridge_search.assert_not_called()
        self.assertEqual(payload["google"]["translation"], "这是一个完整的句子。")
        self.assertEqual(payload["vocabulary"]["status"], "empty")

    def test_slow_upstream_does_not_block_the_whole_lookup(self) -> None:
        release = Event()
        google = {
            "status": "ok",
            "translation": "特别",
            "detectedLanguage": "en",
            "error": None,
            "sourceUrl": "https://translate.google.com/",
        }
        with (
            patch.object(service, "_ENGINE_TIMEOUT_SECONDS", 0.01),
            patch.object(vocabulary_engine, "search", side_effect=lambda _: release.wait(1)),
            patch.object(cambridge_engine, "search", side_effect=lambda _: release.wait(1)),
            patch.object(google_translate_engine, "search", return_value=google),
        ):
            payload = search_english_lookup("especially")
        release.set()
        self.assertEqual(payload["vocabulary"]["status"], "error")
        self.assertEqual(payload["cambridge"]["status"], "error")
        self.assertEqual(payload["google"]["translation"], "特别")
