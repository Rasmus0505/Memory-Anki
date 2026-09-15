from __future__ import annotations

import json
import urllib.error
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from memory_anki.modules.english_lookup.application import (
    bing_engine,
    caiyun_engine,
    cambridge_engine,
    collins_engine,
    google_translate_engine,
    oxford_engine,
    vocabulary_engine,
    youdao_engine,
)
from memory_anki.modules.english_lookup.application.audio_proxy import (
    is_allowed_audio_url,
    proxied_audio_url,
    rewrite_speaker_urls,
)
from memory_anki.modules.english_lookup.application.html_result import finalize_html_result
from memory_anki.modules.english_lookup.application.http_fetch import (
    FetchError,
    fetch_html,
    reset_proxy_probe_cache,
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


class YoudaoEngineTests(TestCase):
    def test_parses_phonetics_definitions_and_audio(self) -> None:
        payload = (FIXTURES / "youdao_sample.json").read_text(encoding="utf-8")
        with patch(
            "memory_anki.modules.english_lookup.application.youdao_engine.fetch_raw",
            return_value=(payload.encode("utf-8"), "utf-8"),
        ):
            result = youdao_engine.search("adapt")
        self.assertEqual(result["status"], "ok")
        self.assertIn("youdao.com", result["sourceUrl"])
        self.assertIn('<span class="headword">adapt</span>', result["entries"][0]["html"])
        self.assertIn("适应", result["entries"][0]["html"])
        self.assertIn("əˈdæpt", result["entries"][0]["html"])
        self.assertIn("dict-speaker", result["entries"][0]["html"])
        self.assertEqual(
            result["audio"]["us"],
            "https://dict.youdao.com/dictvoice?audio=adapt&type=2",
        )


class CambridgeFallbackTests(TestCase):
    def test_uses_youdao_when_cambridge_is_forbidden(self) -> None:
        youdao_html = (
            '<div class="entry-body__el"><span class="headword">adapt</span><p>v. 适应</p></div>'
        )
        with (
            patch(
                "memory_anki.modules.english_lookup.application.cambridge_engine.fetch_html",
                side_effect=FetchError("HTTP 403 fetching dictionary page", status_code=403),
            ),
            patch.object(
                youdao_engine,
                "search",
                return_value={
                    "status": "ok",
                    "error": None,
                    "sourceUrl": "https://www.youdao.com/result?word=adapt&lang=en",
                    "entries": [{"id": "d-youdao-entry0", "html": youdao_html}],
                    "audio": {
                        "us": "https://dict.youdao.com/dictvoice?audio=adapt&type=2",
                        "uk": None,
                    },
                },
            ),
        ):
            result = cambridge_engine.search("adapt")
        self.assertEqual(result["status"], "ok")
        self.assertIn("youdao.com", result["sourceUrl"])
        self.assertIn("适应", result["entries"][0]["html"])


class HttpFetchProxyTests(TestCase):
    def setUp(self) -> None:
        reset_proxy_probe_cache()

    def tearDown(self) -> None:
        reset_proxy_probe_cache()

    def test_skips_dead_system_proxy(self) -> None:
        with (
            patch(
                "urllib.request.getproxies",
                return_value={"http": "http://127.0.0.1:7897", "https": "http://127.0.0.1:7897"},
            ),
            patch(
                "memory_anki.modules.english_lookup.application.http_fetch._probe_proxy",
                return_value=False,
            ),
            patch(
                "memory_anki.modules.english_lookup.application.http_fetch._urlopen",
                return_value=_FakeHttpResponse(b"<html>ok</html>"),
            ) as urlopen,
        ):
            html = fetch_html("https://www.vocabulary.com/dictionary/adapt")
        self.assertEqual(html, "<html>ok</html>")
        self.assertEqual(urlopen.call_count, 1)

    def test_retries_direct_when_live_proxy_refuses(self) -> None:
        calls: list[int] = []

        def fake_urlopen(opener, request, timeout):  # noqa: ANN001
            calls.append(id(opener))
            if len(calls) == 1:
                raise urllib.error.URLError(ConnectionRefusedError(10061, "refused"))
            return _FakeHttpResponse(b"<html>direct</html>")

        with (
            patch(
                "urllib.request.getproxies",
                return_value={"http": "http://127.0.0.1:7897", "https": "http://127.0.0.1:7897"},
            ),
            patch(
                "memory_anki.modules.english_lookup.application.http_fetch._probe_proxy",
                return_value=True,
            ),
            patch(
                "memory_anki.modules.english_lookup.application.http_fetch._urlopen",
                side_effect=fake_urlopen,
            ),
        ):
            html = fetch_html("https://www.vocabulary.com/dictionary/adapt")
        self.assertEqual(html, "<html>direct</html>")
        self.assertEqual(len(calls), 2)


class _FakeHttpResponse:
    def __init__(self, body: bytes) -> None:
        self._body = body
        self.headers = self

    def get_content_charset(self) -> str:
        return "utf-8"

    def read(self) -> bytes:
        return self._body

    def __enter__(self) -> _FakeHttpResponse:
        return self

    def __exit__(self, *args: object) -> bool:
        return False


class GoogleTranslateEngineTests(TestCase):
    def test_combines_google_translation_segments(self) -> None:
        payload = [
            [["你好，", "Hello, ", None, None], ["世界！", "world!", None, None]],
            None,
            "en",
        ]
        with patch.object(google_translate_engine, "_fetch_translation", return_value=payload):
            result = google_translate_engine.search("Hello, world!")
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["translation"], "你好，世界！")
        self.assertEqual(result["detectedLanguage"], "en")

    def test_parses_batchexecute_response(self) -> None:
        inner = [
            None,
            [
                [
                    [
                        None,
                        None,
                        None,
                        None,
                        None,
                        [["你好", None, None, None, None, None, "Hello", 1]],
                    ]
                ]
            ],
            "en",
        ]
        envelope = [
            ["wrb.fr", "MkEWBc", __import__("json").dumps(inner), None, None, None, "generic"]
        ]
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


class OxfordEngineTests(TestCase):
    def test_parses_headword_senses_and_audio(self) -> None:
        document = (FIXTURES / "oxford_sample.html").read_text(encoding="utf-8")
        with patch(
            "memory_anki.modules.english_lookup.application.oxford_engine.fetch_html",
            return_value=document,
        ):
            result = oxford_engine.search("love")
        self.assertEqual(result["status"], "ok")
        html = result["entries"][0]["html"]
        self.assertIn("love", html)
        self.assertIn("strong feeling", html)
        self.assertIn("dict-speaker", html)
        self.assertEqual(
            result["audio"]["uk"],
            "https://www.oxfordlearnersdictionaries.com/media/english/uk_pron/love_uk.mp3",
        )
        self.assertEqual(
            result["audio"]["us"],
            "https://www.oxfordlearnersdictionaries.com/media/english/us_pron/love_us.mp3",
        )


class BingEngineTests(TestCase):
    def test_parses_lex_definitions_and_audio(self) -> None:
        document = (FIXTURES / "bing_sample.html").read_text(encoding="utf-8")
        with patch(
            "memory_anki.modules.english_lookup.application.bing_engine.fetch_html",
            return_value=document,
        ):
            result = bing_engine.search("love")
        self.assertEqual(result["status"], "ok")
        html = result["entries"][0]["html"]
        self.assertIn("爱；热爱", html)
        self.assertEqual(result["audio"]["us"], "https://cn.bing.com/dict/mediamp3?blob=us-love")
        self.assertEqual(result["audio"]["uk"], "https://cn.bing.com/dict/mediamp3?blob=uk-love")


class CollinsEngineTests(TestCase):
    def test_parses_cobuild_section_and_rewrites_speakers(self) -> None:
        document = (FIXTURES / "collins_sample.html").read_text(encoding="utf-8")
        with patch(
            "memory_anki.modules.english_lookup.application.collins_engine.fetch_html",
            return_value=document,
        ):
            result = collins_engine.search("love")
        self.assertEqual(result["status"], "ok")
        html = result["entries"][0]["html"]
        self.assertIn("strong feeling of affection", html)
        self.assertIn("dict-speaker", html)
        self.assertEqual(
            result["audio"]["uk"],
            "https://www.collinsdictionary.com/sounds/love.mp3",
        )


class CaiyunEngineTests(TestCase):
    def test_parses_caiyun_target_list(self) -> None:
        payload = json.dumps({"target": ["摔跤", "扭打"]}).encode("utf-8")
        with patch(
            "memory_anki.modules.english_lookup.application.caiyun_engine.fetch_raw",
            return_value=(payload, "utf-8"),
        ):
            result = caiyun_engine.search("wrestle")
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["translation"], "摔跤\n扭打")
        self.assertIn("caiyunapp.com", result["sourceUrl"])

    def test_falls_back_to_google_when_caiyun_fails(self) -> None:
        with (
            patch(
                "memory_anki.modules.english_lookup.application.caiyun_engine.fetch_raw",
                side_effect=FetchError("HTTP 401 fetching dictionary page", status_code=401),
            ),
            patch.object(
                google_translate_engine,
                "search",
                return_value={
                    "status": "ok",
                    "translation": "摔跤",
                    "detectedLanguage": "en",
                    "error": None,
                    "sourceUrl": "https://translate.google.com/",
                },
            ),
        ):
            result = caiyun_engine.search("wrestle")
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["translation"], "摔跤")
        self.assertIn("caiyunapp.com", result["sourceUrl"])


class AudioProxyTests(TestCase):
    def test_allows_dictionary_hosts_and_rejects_ssrf(self) -> None:
        self.assertTrue(
            is_allowed_audio_url(
                "https://www.oxfordlearnersdictionaries.com/media/english/us_pron/love.mp3"
            )
        )
        self.assertFalse(is_allowed_audio_url("http://www.oxfordlearnersdictionaries.com/x.mp3"))
        self.assertFalse(is_allowed_audio_url("https://127.0.0.1/secret.mp3"))
        self.assertFalse(is_allowed_audio_url("https://evil.example/x.mp3"))

    def test_rewrites_speaker_urls_and_fills_youdao_fallback(self) -> None:
        result = finalize_html_result(
            "love",
            {
                "status": "ok",
                "entries": [
                    {
                        "id": "e0",
                        "html": '<button class="dict-speaker" data-src-mp3="https://www.collinsdictionary.com/sounds/love.mp3"></button>',
                    }
                ],
                "audio": {"us": None, "uk": None},
                "error": None,
                "sourceUrl": "https://www.collinsdictionary.com/dictionary/english/love",
            },
        )
        self.assertEqual(result["audio"]["us"], "/api/v1/english-lookup/voice?q=love&accent=us")
        self.assertEqual(result["audio"]["uk"], "/api/v1/english-lookup/voice?q=love&accent=uk")
        self.assertIn("/api/v1/english-lookup/voice?q=love", result["entries"][0]["html"])
        self.assertIn("accent=us", result["entries"][0]["html"])
        self.assertEqual(
            proxied_audio_url("https://dict.youdao.com/dictvoice?audio=love&type=2"),
            "/api/v1/english-lookup/audio?url=https%3A%2F%2Fdict.youdao.com%2Fdictvoice%3Faudio%3Dlove%26type%3D2",
        )
        rewritten = rewrite_speaker_urls(
            'data-src-mp3="https://www.oxfordlearnersdictionaries.com/media/english/uk_pron/a.mp3"',
            "love",
        )
        self.assertIn("accent=uk", rewritten)

    def test_fetch_voice_uses_youdao_and_caches(self) -> None:
        from memory_anki.modules.english_lookup.application.audio_proxy import (
            fetch_voice,
            reset_voice_cache,
        )

        reset_voice_cache()
        with patch(
            "memory_anki.modules.english_lookup.application.audio_proxy.fetch_binary",
            return_value=(b"ID3fake", "audio/mpeg"),
        ) as mocked:
            body, media_type = fetch_voice("love", "us")
            self.assertEqual(body, b"ID3fake")
            self.assertEqual(media_type, "audio/mpeg")
            url = mocked.call_args[0][0]
            self.assertIn("dict.youdao.com", url)
            self.assertIn("type=2", url)
            fetch_voice("love", "us")
            self.assertEqual(mocked.call_count, 1)
        reset_voice_cache()

