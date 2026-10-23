import io
import tempfile
from pathlib import Path

from memory_anki.infrastructure.db._tables.english import EnglishCourse
from memory_anki.modules.english.application import course_service, subtitle_import
from memory_anki.modules.english.domain.errors import EnglishCourseError
from memory_anki.modules.english.infrastructure import paths
from memory_anki.modules.english.presentation import router as english_router
from support import RouterTestCase

SRT_EN = """1
00:00:01,000 --> 00:00:03,200
The ocean was silent tonight.

2
00:00:03,400 --> 00:00:06,000
I could hear my own heartbeat.

3
00:00:06,200 --> 00:00:08,000
Then the storm arrived.

"""

SRT_ZH = """1
00:00:01,000 --> 00:00:03,200
今夜，大海一片寂静。

2
00:00:03,400 --> 00:00:06,000
我能听见自己的心跳。

3
00:00:06,200 --> 00:00:08,000
然后暴风雨来了。

"""

SRT_BILINGUAL = """1
00:00:00,000 --> 00:00:02,000
Where are you going?
你要去哪里？

2
00:00:02,100 --> 00:00:04,000
I am going home.
我要回家。

"""

VTT_EN = """WEBVTT

00:00:01.000 --> 00:00:03.000 align:start
Hello there.

00:00:03.200 --> 00:00:05.000
General Kenobi.
"""

ASS_EN = """[Script Info]
Title: test
ScriptType: v4.00+

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{\\i1}Hello{\\i0} there.
Dialogue: 0,0:00:03.20,0:00:05.00,Default,,0,0,0,,General Kenobi.
"""


class SubtitleParsingTests(RouterTestCase):
    def test_parses_srt_and_merges_continuation_cues(self):
        cues, fmt = subtitle_import.parse_subtitle_text(
            "1\n00:00:01,000 --> 00:00:03,000\nThe ocean was\n\n"
            "2\n00:00:03,100 --> 00:00:05,000\nsilent tonight.\n\n"
            "3\n00:00:06,000 --> 00:00:08,000\nThen the storm arrived.\n"
        )
        self.assertEqual(fmt, "srt")
        self.assertEqual(len(cues), 3)
        sentences = subtitle_import.build_imported_sentences(cues)
        self.assertEqual(len(sentences), 2)
        self.assertEqual(sentences[0].text_en, "The ocean was silent tonight.")
        self.assertEqual(sentences[0].start_ms, 1000)
        self.assertEqual(sentences[0].end_ms, 5000)
        self.assertEqual(sentences[1].text_en, "Then the storm arrived.")
        self.assertEqual(sentences[0].tokens, ["the", "ocean", "was", "silent", "tonight"])

    def test_parses_bilingual_srt_and_keeps_translation(self):
        cues, fmt = subtitle_import.parse_subtitle_text(SRT_BILINGUAL)
        self.assertEqual(fmt, "srt")
        self.assertEqual(len(cues), 2)
        self.assertEqual(cues[0].text_en, "Where are you going?")
        self.assertEqual(cues[0].text_zh, "你要去哪里？")
        sentences = subtitle_import.build_imported_sentences(cues)
        self.assertEqual([item.text_zh for item in sentences], ["你要去哪里？", "我要回家。"])

    def test_parses_vtt_and_ignores_cue_settings(self):
        cues, fmt = subtitle_import.parse_subtitle_text(VTT_EN)
        self.assertEqual(fmt, "vtt")
        self.assertEqual([cue.text_en for cue in cues], ["Hello there.", "General Kenobi."])
        self.assertEqual(cues[0].start_ms, 1000)

    def test_parses_ass_dialogue_and_strips_override_tags(self):
        cues, fmt = subtitle_import.parse_subtitle_text(ASS_EN)
        self.assertEqual(fmt, "ass")
        self.assertEqual([cue.text_en for cue in cues], ["Hello there.", "General Kenobi."])

    def test_decodes_gb18030_subtitles(self):
        raw = SRT_ZH.encode("gb18030")
        text = subtitle_import.decode_subtitle_bytes(raw)
        cues, _ = subtitle_import.parse_subtitle_text(text, allow_chinese_only=True)
        self.assertEqual(cues[0].text_zh, "今夜，大海一片寂静。")

    def test_aligns_chinese_track_by_time_overlap(self):
        english, _ = subtitle_import.parse_subtitle_text(SRT_EN)
        chinese, _ = subtitle_import.parse_subtitle_text(SRT_ZH, allow_chinese_only=True)
        sentences = subtitle_import.build_imported_sentences(english, chinese)
        self.assertEqual(len(sentences), 3)
        self.assertEqual(sentences[0].text_zh, "今夜，大海一片寂静。")
        self.assertEqual(sentences[2].text_zh, "然后暴风雨来了。")

    def test_aligns_chinese_track_when_cue_counts_differ(self):
        chinese_mixed = """1
00:00:01,000 --> 00:00:06,000
今夜大海寂静，我能听见心跳。

2
00:00:06,100 --> 00:00:08,000
然后暴风雨来了。
"""
        english, _ = subtitle_import.parse_subtitle_text(SRT_EN)
        chinese, _ = subtitle_import.parse_subtitle_text(
            chinese_mixed, allow_chinese_only=True
        )
        sentences = subtitle_import.build_imported_sentences(english, chinese)
        self.assertEqual(len(sentences), 3)
        self.assertEqual(sentences[0].text_zh, "今夜大海寂静，我能听见心跳。")
        self.assertEqual(sentences[1].text_zh, "今夜大海寂静，我能听见心跳。")
        self.assertEqual(sentences[2].text_zh, "然后暴风雨来了。")

    def test_keeps_real_sentences_that_start_with_music_or_sound_words(self):
        cues, _ = subtitle_import.parse_subtitle_text(
            """1
00:00:01,000 --> 00:00:03,000
Music is my whole life.

2
00:00:03,100 --> 00:00:05,000
[Music]

3
00:00:05,100 --> 00:00:07,000
Sound advice.
"""
        )
        self.assertEqual([cue.text_en for cue in cues], ["Music is my whole life.", "Sound advice."])

    def test_does_not_split_common_abbreviations_into_sentences(self):
        cues, _ = subtitle_import.parse_subtitle_text(
            """1
00:00:01,000 --> 00:00:05,000
Mr. Smith met Dr. Jones at 5 p.m.
"""
        )
        sentences = subtitle_import.build_imported_sentences(cues)
        self.assertEqual(len(sentences), 1)
        self.assertEqual(sentences[0].text_en, "Mr. Smith met Dr. Jones at 5 p.m.")

    def test_rejects_subtitle_without_english(self):
        with self.assertRaises(EnglishCourseError):
            subtitle_import.parse_subtitle_text(SRT_ZH)


class SubtitleImportRouteTests(RouterTestCase):
    ROUTER_MODULES = (english_router,)

    def setUp(self):
        self.original_media_dir = paths.ENGLISH_MEDIA_DIR
        self.original_tasks_dir = paths.ENGLISH_TASKS_DIR
        self.original_course_media_dir = course_service.ENGLISH_MEDIA_DIR
        self.original_probe = subtitle_import.probe_media_duration_seconds
        self.temp_dir = tempfile.TemporaryDirectory()
        paths.ENGLISH_MEDIA_DIR = Path(self.temp_dir.name) / "media"
        course_service.ENGLISH_MEDIA_DIR = paths.ENGLISH_MEDIA_DIR
        paths.ENGLISH_TASKS_DIR = Path(self.temp_dir.name) / "tasks"
        paths.ENGLISH_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
        paths.ENGLISH_TASKS_DIR.mkdir(parents=True, exist_ok=True)
        subtitle_import.probe_media_duration_seconds = lambda _path: 0
        super().setUp()

    def tearDown(self):
        paths.ENGLISH_MEDIA_DIR = self.original_media_dir
        course_service.ENGLISH_MEDIA_DIR = self.original_course_media_dir
        paths.ENGLISH_TASKS_DIR = self.original_tasks_dir
        subtitle_import.probe_media_duration_seconds = self.original_probe
        super().tearDown()
        self.temp_dir.cleanup()

    def test_imports_video_and_subtitles_into_a_course(self):
        response = self.client.post(
            "/api/v1/english/import",
            data={"title": "Ocean Night"},
            files={
                "video_file": ("lesson.mp4", io.BytesIO(b"fake-video-bytes"), "video/mp4"),
                "english_subtitle": ("lesson.en.srt", io.BytesIO(SRT_EN.encode("utf-8")), "text/plain"),
                "chinese_subtitle": ("lesson.zh.srt", io.BytesIO(SRT_ZH.encode("utf-8")), "text/plain"),
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        course_id = payload["course"]["id"]
        self.assertEqual(payload["course"]["title"], "Ocean Night")
        self.assertEqual(payload["course"]["sentenceCount"], 3)
        self.assertEqual(payload["course"]["completedSentenceCount"], 0)
        self.assertEqual(payload["matchedTranslationCount"], 3)

        detail = self.client.get(f"/api/v1/english/courses/{course_id}")
        self.assertEqual(detail.status_code, 200)
        body = detail.json()
        self.assertEqual(len(body["sentences"]), 3)
        self.assertEqual(body["sentences"][0]["textEn"], "The ocean was silent tonight.")
        self.assertEqual(body["sentences"][0]["textZh"], "今夜，大海一片寂静。")
        self.assertEqual(body["sentences"][0]["tokens"], ["the", "ocean", "was", "silent", "tonight"])
        self.assertEqual(body["durationSeconds"], 8)

        media = self.client.get(f"/api/v1/english/courses/{course_id}/media")
        self.assertEqual(media.status_code, 200)
        self.assertEqual(media.content, b"fake-video-bytes")

        with self.SessionLocal() as session:
            course = session.query(EnglishCourse).filter_by(id=course_id).one()
            self.assertEqual(course.sentence_count, 3)
            self.assertTrue((paths.ENGLISH_MEDIA_DIR / course.media_relative_path).exists())
            self.assertTrue((paths.ENGLISH_MEDIA_DIR / f"course-{course_id}" / "english.srt").exists())
            self.assertTrue((paths.ENGLISH_MEDIA_DIR / f"course-{course_id}" / "chinese.srt").exists())

    def test_import_without_translation_succeeds(self):
        response = self.client.post(
            "/api/v1/english/import",
            files={
                "video_file": ("lesson.mp4", io.BytesIO(b"fake-video-bytes"), "video/mp4"),
                "english_subtitle": ("lesson.en.srt", io.BytesIO(SRT_EN.encode("utf-8")), "text/plain"),
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["matchedTranslationCount"], 0)

    def test_import_rejects_chinese_only_english_track(self):
        response = self.client.post(
            "/api/v1/english/import",
            files={
                "video_file": ("lesson.mp4", io.BytesIO(b"fake-video-bytes"), "video/mp4"),
                "english_subtitle": ("lesson.zh.srt", io.BytesIO(SRT_ZH.encode("utf-8")), "text/plain"),
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("没有解析到可用句子", response.json()["detail"])

    def test_import_leaves_no_course_when_video_is_empty(self):
        response = self.client.post(
            "/api/v1/english/import",
            files={
                "video_file": ("lesson.mp4", io.BytesIO(b""), "video/mp4"),
                "english_subtitle": ("lesson.en.srt", io.BytesIO(SRT_EN.encode("utf-8")), "text/plain"),
            },
        )
        self.assertEqual(response.status_code, 400)
        with self.SessionLocal() as session:
            self.assertEqual(session.query(EnglishCourse).count(), 0)
