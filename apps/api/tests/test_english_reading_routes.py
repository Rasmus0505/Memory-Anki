import io
import json
import tempfile
from datetime import timedelta
from pathlib import Path

import fitz

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.english_reading import (
    EnglishReadingDictionaryCache,
    EnglishReadingLexiconCache,
    EnglishReadingVocabularyNote,
)
from memory_anki.infrastructure.db._tables.misc import Config
from memory_anki.modules.english_reading.application import service as reading_service
from memory_anki.modules.english_reading.presentation import router as english_reading_router
from support import RouterTestCase


def build_pdf_bytes() -> bytes:
    document = fitz.open()
    try:
        for page_number in range(1, 3):
            page = document.new_page()
            page.insert_text((72, 72), "Weekly Reader")
            page.insert_text((72, 108), f"Page {page_number}")
            page.insert_text((72, 160), "Important acquisition was recalcitrant.")
            page.insert_text((72, 188), "According to rules, she cheated.")
            page.insert_text((72, 216), f"Body line {page_number}")
            page.insert_text((72, 244), "Footer note")
        return document.tobytes()
    finally:
        document.close()


def build_bilingual_pdf_bytes() -> bytes:
    document = fitz.open()
    try:
        page = document.new_page()
        page.insert_text((72, 72), "P1")
        page.insert_text((72, 108), "这是一段中文导读。")
        page.insert_text((72, 144), "Napoleon retreated through brutal winter conditions.")
        page.insert_text((72, 180), "Food was scarce and disease spread quickly.")
        page.insert_text((72, 216), "拿破仑的军队遭受重创。")
        return document.tobytes()
    finally:
        document.close()


class EnglishReadingRouteTests(RouterTestCase):
    ROUTER_MODULES = (english_reading_router,)

    def setUp(self):
        self.original_runtime = reading_service.get_english_reading_runtime()
        self.original_call_chat_completion_text = reading_service.call_chat_completion_text
        self.original_fetch_xxapi_dictionary_payload = reading_service.fetch_xxapi_dictionary_payload
        self.original_api_key = reading_service.DASHSCOPE_API_KEY
        self.original_text_model = reading_service.DASHSCOPE_TEXT_MODEL
        self.original_cefr_path = reading_service.ENGLISH_READING_CEFR_PATH
        self.original_lexicon_state = reading_service._lexicon_state
        self.generation_calls = 0
        self.temp_dir = tempfile.TemporaryDirectory()
        self.source_cefr_path = Path(self.temp_dir.name) / "source-cefr.json"
        self.managed_cefr_path = Path(self.temp_dir.name) / "managed" / "cefr.json"
        self.source_cefr_path.write_text(
            json.dumps(
                [
                    {"word": "according to", "cefr": ["A1"]},
                    {"word": "acquire", "cefr": ["B2"]},
                    {"word": "important", "cefr": ["A1"]},
                    {"word": "was", "cefr": ["A1"]},
                    {"word": "rule", "cefr": ["A1"]},
                    {"word": "she", "cefr": ["A1"]},
                    {"word": "change", "cefr": ["A2"]},
                    {"word": "cheat", "cefr": ["A2"]},
                    {"word": "crucial", "cefr": ["B1"]},
                    {"word": "stubborn", "cefr": ["A2"]},
                    {"word": "recalcitrant", "cefr": ["C1"]},
                ],
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        reading_service.ENGLISH_READING_CEFR_PATH = self.managed_cefr_path
        reading_service.configure_english_reading_runtime(
            reading_service.EnglishReadingRuntime(cefr_source_path=self.source_cefr_path)
        )
        reading_service._lexicon_state = None
        reading_service.DASHSCOPE_API_KEY = "test-key"
        reading_service.DASHSCOPE_TEXT_MODEL = "qwen3.6-flash"

        super().setUp()

    def seed(self, session):
        reading_service.prepare_english_reading_runtime(session)

    def tearDown(self):
        reading_service.configure_english_reading_runtime(self.original_runtime)
        reading_service.call_chat_completion_text = self.original_call_chat_completion_text
        reading_service.fetch_xxapi_dictionary_payload = self.original_fetch_xxapi_dictionary_payload
        reading_service.DASHSCOPE_API_KEY = self.original_api_key
        reading_service.DASHSCOPE_TEXT_MODEL = self.original_text_model
        reading_service.ENGLISH_READING_CEFR_PATH = self.original_cefr_path
        reading_service._lexicon_state = self.original_lexicon_state
        super().tearDown()
        self.temp_dir.cleanup()

    def mock_llm(self, *, config, messages, response_format=None):
        del config, response_format
        prompt = str(messages[-1]["content"])
        if "输入数据：" not in prompt:
            raise AssertionError(f"Unexpected prompt: {prompt}")
        payload = json.loads(prompt.split("输入数据：", 1)[1])
        self.generation_calls += 1
        response = {
            "surfaceItems": [],
            "sentenceItems": [],
        }

        unknown_surfaces = payload.get("unknown_surfaces") or []
        if "acquision" in unknown_surfaces:
            response["surfaceItems"].append(
                {
                    "surface": "acquision",
                    "candidates": ["acquire", "acquisition"],
                    "cefr": "B2",
                    "confidence": 0.93,
                    "note": "Likely noun form related to acquire.",
                }
            )

        for task in payload.get("sentence_tasks") or []:
            sentence = task.get("sentence")
            candidates = {
                (item.get("kind"), item.get("text")): item.get("candidateId")
                for item in task.get("candidates") or []
            }
            if sentence == "Important acquisition was recalcitrant.":
                response["sentenceItems"].append(
                    {
                        "sentenceId": task["sentenceId"],
                        "parts": [
                            {
                                "text": "Crucial",
                                "kind": "yellow",
                                "candidateId": candidates.get(("yellow", "Important")),
                            },
                            {"text": " "},
                            {
                                "text": "acquisition",
                                "kind": "green",
                                "candidateId": candidates.get(("green", "acquisition")),
                            },
                            {"text": " was "},
                            {
                                "text": "stubborn",
                                "kind": "red",
                                "candidateId": candidates.get(("red", "recalcitrant")),
                            },
                            {"text": "."},
                        ],
                        "sentenceAnnotation": {
                            "kind": "syntax_simplified",
                            "originalText": "Important acquisition was recalcitrant.",
                            "displayText": "Crucial acquisition was stubborn.",
                            "skeletonHints": ["subject", "verb"],
                        },
                    }
                )
            elif sentence == "Important acquision was recalcitrant.":
                response["sentenceItems"].append(
                    {
                        "sentenceId": task["sentenceId"],
                        "parts": [
                            {
                                "text": "Crucial",
                                "kind": "yellow",
                                "candidateId": candidates.get(("yellow", "Important")),
                            },
                            {"text": " "},
                            {
                                "text": "acquision",
                                "kind": "green",
                                "candidateId": candidates.get(("green", "acquision"))
                                or candidates.get(("unknown", "acquision")),
                            },
                            {"text": " was "},
                            {
                                "text": "stubborn",
                                "kind": "red",
                                "candidateId": candidates.get(("red", "recalcitrant")),
                            },
                            {"text": "."},
                        ],
                        "sentenceAnnotation": {
                            "kind": "syntax_simplified",
                            "originalText": "Important acquision was recalcitrant.",
                            "displayText": "Crucial acquision was stubborn.",
                            "skeletonHints": ["subject", "verb"],
                        },
                    }
                )
            elif sentence == "According to rules, she cheated.":
                response["sentenceItems"].append(
                    {
                        "sentenceId": task["sentenceId"],
                        "parts": [{"text": "According to rules, she cheated."}],
                        "sentenceAnnotation": {
                            "kind": "unchanged",
                            "originalText": "According to rules, she cheated.",
                            "displayText": "According to rules, she cheated.",
                            "skeletonHints": [],
                        },
                    }
                )

        return json.dumps(response, ensure_ascii=False)

    def mock_dictionary_entries(self, word: str):
        normalized = reading_service.normalize_dictionary_query_word(word)
        if normalized in {"acquisition", "acquisitions"}:
            return [
                {
                    "word": "acquisition",
                    "phonetic": "/ˌæk.wəˈzɪʃ.ən/",
                    "phonetics": [
                        {
                            "text": "/ˌæk.wəˈzɪʃ.ən/",
                            "audio": "https://api.dictionaryapi.dev/media/pronunciations/en/acquisition-us.mp3",
                        }
                    ],
                    "meanings": [
                        {
                            "partOfSpeech": "noun",
                            "definitions": [
                                {
                                    "definition": "The act of acquiring something.",
                                    "example": "The acquisition improved the business.",
                                }
                            ],
                        }
                    ],
                }
            ]
        raise reading_service.EnglishReadingError(f"未找到单词“{word}”的词典结果。")

    def mock_xxapi_dictionary_payload(self, word: str):
        normalized = reading_service.normalize_dictionary_query_word(word)
        if normalized in {"cancel", "cancels"}:
            return {
                "word": "cancel",
                "usphone": "'kænsl",
                "usspeech": "https://dict.youdao.com/dictvoice?audio=cancel&type=2",
                "translations": [
                    {"pos": "v", "tran_cn": "取消；删去"},
                    {"pos": "n", "tran_cn": "取消，撤销"},
                ],
            }
        raise reading_service.EnglishReadingError(f"未找到单词“{word}”的词典结果。")

    def test_profile_get_and_update(self):
        profile = self.client.get("/api/v1/english-reading/profile")
        self.assertEqual(profile.status_code, 200)
        self.assertEqual(profile.json()["declaredCefr"], "B1")
        self.assertEqual(profile.json()["workingLexicalI"], 2.4)
        self.assertEqual(profile.json()["workingSyntacticI"], 2.25)

        updated = self.client.put("/api/v1/english-reading/profile", json={"declaredCefr": "A2"})
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["declaredCefr"], "A2")
        self.assertEqual(updated.json()["workingLexicalI"], 1.4)
        self.assertEqual(updated.json()["workingSyntacticI"], 1.25)
        self.assertEqual(updated.json()["xp"], 0)

    def test_create_material_from_paste_and_pdf(self):
        paste_response = self.client.post(
            "/api/v1/english-reading/materials",
            data={"text": "Important acquisition was recalcitrant."},
        )
        self.assertEqual(paste_response.status_code, 200)
        self.assertEqual(paste_response.json()["sourceType"], "paste")
        self.assertEqual(paste_response.json()["wordCount"], 4)

        pdf_response = self.client.post(
            "/api/v1/english-reading/materials",
            files={
                "reading_file": ("reader.pdf", io.BytesIO(build_pdf_bytes()), "application/pdf")
            },
        )
        self.assertEqual(pdf_response.status_code, 200)
        self.assertEqual(pdf_response.json()["sourceType"], "pdf")
        material_id = pdf_response.json()["id"]
        with self.SessionLocal() as session:
            material = session.get(reading_service.EnglishReadingMaterial, material_id)
            self.assertIsNotNone(material)
            self.assertIn("Important acquisition was recalcitrant.", material.cleaned_text)
            self.assertIn("According to rules, she cheated.", material.cleaned_text)
            self.assertNotIn("Weekly Reader", material.cleaned_text)
            self.assertNotIn("Page 1", material.cleaned_text)
            self.assertNotIn("Footer note", material.cleaned_text)

    def test_generate_version_uses_single_ai_call_local_priority_and_cache(self):
        reading_service.call_chat_completion_text = self.mock_llm

        material = self.client.post(
            "/api/v1/english-reading/materials",
            data={"text": "Important acquision was recalcitrant. According to rules, she cheated."},
        )
        self.assertEqual(material.status_code, 200)
        material_id = material.json()["id"]

        version = self.client.post(
            f"/api/v1/english-reading/materials/{material_id}/generate",
            json={"mode": "initial"},
        )
        self.assertEqual(version.status_code, 200)
        payload = version.json()
        self.assertEqual(payload["summary"]["greenCount"], 1)
        self.assertGreaterEqual(payload["summary"]["yellowCount"], 1)
        self.assertEqual(payload["summary"]["redCount"], 1)
        self.assertEqual(payload["summary"]["sentenceSimplifiedCount"], 1)
        self.assertGreaterEqual(len(payload["generationTrace"]), 1)
        self.assertGreaterEqual(len(payload["aiLogIds"]), 1)
        self.assertEqual(len(payload["spanAnnotations"]), 3)
        self.assertEqual(
            [item["kind"] for item in payload["spanAnnotations"]], ["yellow", "green", "red"]
        )
        self.assertEqual(payload["spanAnnotations"][0]["displayText"], "Crucial")
        self.assertEqual(payload["spanAnnotations"][1]["displayText"], "acquision")
        self.assertEqual(payload["spanAnnotations"][2]["displayText"], "stubborn")
        self.assertEqual(payload["sentenceAnnotations"][0]["kind"], "syntax_simplified")
        self.assertEqual(payload["sentenceAnnotations"][0]["skeletonHints"], ["subject", "verb"])
        self.assertEqual(payload["spanAnnotations"][0]["cefr"], "A1")
        self.assertEqual(payload["spanAnnotations"][0]["resolutionSource"], "dictionary")
        self.assertEqual(payload["spanAnnotations"][1]["cefr"], "B2")
        self.assertEqual(payload["spanAnnotations"][1]["resolvedLemma"], "acquire")
        self.assertEqual(payload["spanAnnotations"][1]["resolutionSource"], "dictionary")
        self.assertEqual(payload["spanAnnotations"][2]["cefr"], "C1")
        self.assertEqual(payload["spanAnnotations"][2]["resolutionSource"], "dictionary")

        with self.SessionLocal() as session:
            cached_rows = session.query(EnglishReadingLexiconCache).all()
            self.assertEqual([row.normalized_surface for row in cached_rows], ["acquision"])
            self.assertEqual(cached_rows[0].lemma, "acquire")
            self.assertEqual(cached_rows[0].cefr, "B2")
            self.assertEqual(cached_rows[0].source, "dictionary")

        second_material = self.client.post(
            "/api/v1/english-reading/materials",
            data={"text": "Acquision acquisition."},
        )
        self.assertEqual(second_material.status_code, 200)
        second_id = second_material.json()["id"]
        second_version = self.client.post(
            f"/api/v1/english-reading/materials/{second_id}/generate",
            json={"mode": "initial"},
        )
        self.assertEqual(second_version.status_code, 200)
        second_payload = second_version.json()
        self.assertGreaterEqual(second_payload["summary"]["greenCount"], 1)
        self.assertEqual(self.generation_calls, 2)

    def test_regenerate_supports_same_easier_harder_and_legacy_ease(self):
        reading_service.call_chat_completion_text = self.mock_llm
        material = self.client.post(
            "/api/v1/english-reading/materials",
            data={"text": "Important acquisition was recalcitrant."},
        )
        self.assertEqual(material.status_code, 200)
        material_id = material.json()["id"]

        same_response = self.client.post(
            f"/api/v1/english-reading/materials/{material_id}/generate",
            json={"mode": "regenerate", "difficultyDirection": "same"},
        )
        self.assertEqual(same_response.status_code, 200)
        same_payload = same_response.json()
        self.assertEqual(same_payload["workingLexicalI"], 2.4)
        self.assertEqual(same_payload["workingSyntacticI"], 2.25)

        easier_response = self.client.post(
            f"/api/v1/english-reading/materials/{material_id}/generate",
            json={"mode": "regenerate", "difficultyDirection": "easier", "difficultyDelta": 1.5},
        )
        self.assertEqual(easier_response.status_code, 200)
        easier_payload = easier_response.json()
        self.assertEqual(easier_payload["workingLexicalI"], 1.05)
        self.assertEqual(easier_payload["workingSyntacticI"], 1.2)

        harder_response = self.client.post(
            f"/api/v1/english-reading/materials/{material_id}/generate",
            json={"mode": "regenerate", "difficultyDirection": "harder", "difficultyDelta": 2.0},
        )
        self.assertEqual(harder_response.status_code, 200)
        harder_payload = harder_response.json()
        self.assertEqual(harder_payload["workingLexicalI"], 4.2)
        self.assertEqual(harder_payload["workingSyntacticI"], 3.65)

        legacy_ease_response = self.client.post(
            f"/api/v1/english-reading/materials/{material_id}/generate",
            json={"mode": "ease"},
        )
        self.assertEqual(legacy_ease_response.status_code, 200)
        legacy_ease_payload = legacy_ease_response.json()
        self.assertEqual(legacy_ease_payload["workingLexicalI"], 1.95)
        self.assertEqual(legacy_ease_payload["workingSyntacticI"], 1.9)

    def test_generate_stream_returns_status_and_result_events(self):
        reading_service.call_chat_completion_text = self.mock_llm
        material = self.client.post(
            "/api/v1/english-reading/materials",
            data={"text": "Important acquisition was recalcitrant."},
        )
        self.assertEqual(material.status_code, 200)

        response = self.client.post(
            f"/api/v1/english-reading/materials/{material.json()['id']}/generate/stream",
            json={"mode": "initial"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/event-stream", response.headers["content-type"])
        self.assertIn("event: status", response.text)
        self.assertIn("event: result", response.text)

    def test_regenerate_rejects_invalid_direction_and_delta(self):
        material = self.client.post(
            "/api/v1/english-reading/materials",
            data={"text": "Important acquisition was recalcitrant."},
        )
        self.assertEqual(material.status_code, 200)
        material_id = material.json()["id"]

        invalid_direction = self.client.post(
            f"/api/v1/english-reading/materials/{material_id}/generate",
            json={"mode": "regenerate", "difficultyDirection": "lower"},
        )
        self.assertEqual(invalid_direction.status_code, 400)
        self.assertIn("难度方向", invalid_direction.json()["detail"])

        invalid_delta = self.client.post(
            f"/api/v1/english-reading/materials/{material_id}/generate",
            json={"mode": "regenerate", "difficultyDirection": "easier", "difficultyDelta": 0.3},
        )
        self.assertEqual(invalid_delta.status_code, 400)
        self.assertIn("难度变化幅度", invalid_delta.json()["detail"])

    def test_local_fallback_keeps_only_natural_green_words_colored(self):
        reading_service.DASHSCOPE_API_KEY = ""

        material = self.client.post(
            "/api/v1/english-reading/materials",
            data={"text": "Important acquisition was recalcitrant."},
        )
        self.assertEqual(material.status_code, 200)

        version = self.client.post(
            f"/api/v1/english-reading/materials/{material.json()['id']}/generate",
            json={"mode": "initial"},
        )
        self.assertEqual(version.status_code, 200)
        payload = version.json()
        self.assertEqual(payload["summary"]["greenCount"], 1)
        import json as _j
        from pathlib import Path as _P
        _P("_DEBUG_FALLBACK.json").write_text(_j.dumps({"summary": payload["summary"], "spans": payload["spanAnnotations"]}, ensure_ascii=False, indent=2), encoding="utf-8")
        self.assertEqual(payload["summary"]["yellowCount"], 0)
        self.assertEqual(payload["summary"]["redCount"], 0)
        self.assertEqual(payload["summary"]["sentenceSimplifiedCount"], 0)
        self.assertEqual(len(payload["spanAnnotations"]), 4)
        acquisition_annotation = next(
            item for item in payload["spanAnnotations"] if item["originalText"] == "acquisition"
        )
        self.assertEqual(acquisition_annotation["kind"], "green")
        self.assertEqual(acquisition_annotation["displayText"], "acquisition")
        self.assertEqual(acquisition_annotation["resolvedLemma"], "acquire")
        self.assertEqual(acquisition_annotation["resolutionSource"], "dictionary")
        recalcitrant_annotation = next(
            item for item in payload["spanAnnotations"] if item["originalText"] == "recalcitrant"
        )
        self.assertEqual(recalcitrant_annotation["kind"], "black")
        self.assertTrue(recalcitrant_annotation["rewriteNeeded"])

    def test_basic_lemma_candidates_cover_common_inflections_and_nominalizations(self):
        self.assertIn("cheat", reading_service.basic_lemma_candidates("cheated"))
        self.assertIn("retreat", reading_service.basic_lemma_candidates("retreating"))
        self.assertIn("acquire", reading_service.basic_lemma_candidates("acquisition"))

    def test_invalid_ai_surface_result_does_not_fallback_to_b2(self):
        def invalid_surface_mock(*, config, messages, response_format=None):
            del config, response_format
            prompt = str(messages[-1]["content"])
            self.assertIn("acquision", prompt)
            return json.dumps({"surfaceItems": [], "sentenceItems": []}, ensure_ascii=False)

        reading_service.call_chat_completion_text = invalid_surface_mock

        material = self.client.post(
            "/api/v1/english-reading/materials",
            data={"text": "Acquision changed."},
        )
        self.assertEqual(material.status_code, 200)

        version = self.client.post(
            f"/api/v1/english-reading/materials/{material.json()['id']}/generate",
            json={"mode": "initial"},
        )
        self.assertEqual(version.status_code, 200)
        payload = version.json()
        self.assertEqual(payload["summary"]["greenCount"], 0)
        self.assertFalse(
            any(item["originalText"].lower() == "acquision" for item in payload["spanAnnotations"])
        )
        changed_annotation = next(
            item for item in payload["spanAnnotations"] if item["originalText"] == "changed"
        )
        self.assertEqual(changed_annotation["kind"], "black")

    def test_sentence_simplification_without_word_rewrites_stays_uncolored(self):
        def sentence_only_mock(*, config, messages, response_format=None):
            del config, response_format
            prompt = str(messages[-1]["content"])
            if "According to rules, she cheated." not in prompt:
                raise AssertionError(f"Unexpected prompt: {prompt}")
            payload = json.loads(prompt.split("输入数据：", 1)[1])
            sentence_task = payload["sentence_tasks"][0]
            return json.dumps(
                {
                    "surfaceItems": [],
                    "sentenceItems": [
                        {
                            "sentenceId": sentence_task["sentenceId"],
                            "parts": [{"text": "She cheated by the rules."}],
                            "sentenceAnnotation": {
                                "kind": "syntax_simplified",
                                "originalText": "According to rules, she cheated.",
                                "displayText": "She cheated by the rules.",
                                "skeletonHints": ["subject", "verb"],
                            },
                        }
                    ],
                },
                ensure_ascii=False,
            )

        reading_service.call_chat_completion_text = sentence_only_mock

        material = self.client.post(
            "/api/v1/english-reading/materials",
            data={"text": "According to rules, she cheated."},
        )
        self.assertEqual(material.status_code, 200)

        version = self.client.post(
            f"/api/v1/english-reading/materials/{material.json()['id']}/generate",
            json={"mode": "initial"},
        )
        self.assertEqual(version.status_code, 200)
        payload = version.json()
        self.assertEqual(payload["summary"]["sentenceSimplifiedCount"], 1)
        self.assertEqual(payload["summary"]["yellowCount"], 0)
        self.assertEqual(payload["summary"]["redCount"], 0)
        self.assertEqual(payload["spanAnnotations"], [])
        self.assertEqual(payload["sentenceAnnotations"][0]["kind"], "syntax_simplified")

    def test_generate_version_from_bilingual_pdf_returns_english_only_result(self):
        reading_service.call_chat_completion_text = self.mock_llm
        material = self.client.post(
            "/api/v1/english-reading/materials",
            files={
                "reading_file": (
                    "bilingual.pdf",
                    io.BytesIO(build_bilingual_pdf_bytes()),
                    "application/pdf",
                )
            },
        )
        self.assertEqual(material.status_code, 200)
        self.assertIn(
            "Napoleon retreated through brutal winter conditions.", material.json()["title"]
        )
        material_id = material.json()["id"]

        version = self.client.post(
            f"/api/v1/english-reading/materials/{material_id}/generate",
            json={"mode": "initial"},
        )
        self.assertEqual(version.status_code, 200)
        payload = version.json()
        rendered_text = "\n".join(
            sentence["displayText"]
            for block in payload["renderBlocks"]
            for sentence in block["sentences"]
        )
        self.assertIn("Napoleon retreated through brutal winter conditions.", rendered_text)
        self.assertIn("Food was scarce and disease spread quickly.", rendered_text)
        self.assertNotIn("这是一段中文导读", rendered_text)
        self.assertNotIn("拿破仑的军队遭受重创", rendered_text)

    def test_complete_flow_updates_profile_and_session_stats(self):
        reading_service.call_chat_completion_text = self.mock_llm

        material = self.client.post(
            "/api/v1/english-reading/materials",
            data={"text": "Important acquisition was recalcitrant."},
        )
        material_id = material.json()["id"]
        version = self.client.post(
            f"/api/v1/english-reading/materials/{material_id}/generate",
            json={"mode": "initial"},
        )
        version_id = version.json()["id"]

        completion = self.client.post(
            f"/api/v1/english-reading/materials/{material_id}/complete",
            json={
                "versionId": version_id,
                "feedback": "just_right",
                "durationSeconds": 120,
                "hoverCount": 2,
                "expandCount": 1,
            },
        )
        self.assertEqual(completion.status_code, 200)
        payload = completion.json()
        self.assertEqual(payload["session"]["feedback"], "just_right")
        self.assertEqual(payload["session"]["durationSeconds"], 120)
        self.assertEqual(payload["session"]["wordsPerMinute"], 2)
        self.assertEqual(payload["session"]["xpAwarded"], 5)
        self.assertEqual(payload["profile"]["levelProgress"], 5)
        self.assertGreater(payload["profile"]["workingLexicalI"], 2.4)
        self.assertGreater(payload["profile"]["workingSyntacticI"], 2.25)

    def test_vocabulary_notes_can_be_saved_listed_and_review_scheduled(self):
        with self.SessionLocal() as session:
            session.add(Config(key="ebbinghaus_intervals", value="1,2,4"))
            session.commit()

        material = self.client.post(
            "/api/v1/english-reading/materials",
            data={"text": "Important acquisition was recalcitrant."},
        )
        self.assertEqual(material.status_code, 200)
        material_id = material.json()["id"]

        created = self.client.post(
            "/api/v1/english-reading/vocabulary-notes",
            json={
                "word": "acquisition",
                "definitionZh": "获得；习得",
                "note": "Reader hovered this word.",
                "context": "Important acquisition was recalcitrant.",
                "materialId": material_id,
                "spanAnnotationId": "span-2",
                "cefr": "B2",
            },
        )
        self.assertEqual(created.status_code, 200)
        created_payload = created.json()
        self.assertEqual(created_payload["word"], "acquisition")
        self.assertEqual(created_payload["normalizedSurface"], "acquisition")
        self.assertEqual(created_payload["materialId"], material_id)
        self.assertEqual(created_payload["spanAnnotationId"], "span-2")
        self.assertEqual(created_payload["reviewNumber"], 0)
        self.assertEqual(created_payload["reviewCount"], 0)
        self.assertGreater(created_payload["nextDueDate"], created_payload["anchorDate"])
        self.assertEqual(created_payload["algorithmUsed"], "ebbinghaus")

        notes = self.client.get("/api/v1/english-reading/vocabulary-notes")
        self.assertEqual(notes.status_code, 200)
        self.assertEqual(notes.json()["total"], 1)
        self.assertEqual(notes.json()["items"][0]["definitionZh"], "获得；习得")

        with self.SessionLocal() as session:
            row = session.query(EnglishReadingVocabularyNote).first()
            row.next_due_at = utc_now_naive() - timedelta(minutes=5)
            row.next_due_date = row.next_due_at.date()
            session.commit()

        due_notes = self.client.get(
            "/api/v1/english-reading/vocabulary-notes",
            params={"dueOnly": "true"},
        )
        self.assertEqual(due_notes.status_code, 200)
        self.assertEqual(due_notes.json()["dueCount"], 1)
        self.assertTrue(due_notes.json()["items"][0]["isDue"])

        reviewed = self.client.post(
            f"/api/v1/english-reading/vocabulary-notes/{created_payload['id']}/review",
            json={"result": "good"},
        )
        self.assertEqual(reviewed.status_code, 200)
        reviewed_payload = reviewed.json()
        self.assertEqual(reviewed_payload["reviewNumber"], 1)
        self.assertEqual(reviewed_payload["reviewCount"], 1)
        self.assertEqual(reviewed_payload["correctCount"], 1)
        self.assertEqual(reviewed_payload["incorrectCount"], 0)
        self.assertEqual(reviewed_payload["intervalDays"], 2)
        self.assertFalse(reviewed_payload["isDue"])

    def test_xxapi_lookup_returns_chinese_and_caches_result(self):
        reading_service.fetch_xxapi_dictionary_payload = self.mock_xxapi_dictionary_payload
        response = self.client.get(
            "/api/v1/english-reading/dictionary",
            params={"word": "cancel"},
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["word"], "cancel")
        self.assertEqual(payload["lemma"], "cancel")
        self.assertEqual(payload["phoneticUs"], "/'kænsl/")
        self.assertEqual(
            payload["audioUsUrl"],
            "https://dict.youdao.com/dictvoice?audio=cancel&type=2",
        )
        self.assertEqual(payload["partsOfSpeech"], ["v", "n"])
        self.assertEqual(payload["summaryZh"], ["取消；删去", "取消，撤销"])
        self.assertEqual(payload["senses"][0]["definitionZh"], "取消；删去")
        self.assertEqual(payload["senses"][0]["definition"], "")

        with self.SessionLocal() as session:
            cached_row = (
                session.query(EnglishReadingDictionaryCache)
                .filter_by(normalized_surface="cancel")
                .first()
            )
            self.assertIsNotNone(cached_row)
            self.assertEqual(cached_row.source, "xxapi")
            self.assertEqual(json.loads(cached_row.summary_zh_json), ["取消；删去", "取消，撤销"])

        reading_service.fetch_xxapi_dictionary_payload = lambda _word: (_ for _ in ()).throw(
            AssertionError("cache should have been used")
        )
        cached_response = self.client.get(
            "/api/v1/english-reading/dictionary",
            params={"word": "cancel"},
        )
        self.assertEqual(cached_response.status_code, 200)
        self.assertEqual(cached_response.json()["summaryZh"], ["取消；删去", "取消，撤销"])

    def test_dictionary_lookup_falls_back_to_lemma_candidates(self):
        reading_service.fetch_xxapi_dictionary_payload = self.mock_xxapi_dictionary_payload

        response = self.client.get(
            "/api/v1/english-reading/dictionary",
            params={"word": "cancels"},
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["word"], "cancels")
        self.assertEqual(payload["lemma"], "cancel")
        self.assertEqual(payload["partsOfSpeech"], ["v", "n"])

        with self.SessionLocal() as session:
            cached_surfaces = {
                row.normalized_surface
                for row in session.query(EnglishReadingDictionaryCache).all()
            }
            self.assertIn("cancels", cached_surfaces)
            self.assertIn("cancel", cached_surfaces)

    def test_dictionary_lookup_returns_not_found(self):
        reading_service.fetch_xxapi_dictionary_payload = self.mock_xxapi_dictionary_payload

        response = self.client.get(
            "/api/v1/english-reading/dictionary",
            params={"word": "zzzzword"},
        )
        self.assertEqual(response.status_code, 404)
        self.assertIn("未找到单词", response.json()["detail"])

    def test_sentence_translation_uses_translation_options_and_normalizes_text(self):
        captured: dict[str, object] = {}

        def translation_mock(*, config, messages, response_format=None, extra_payload=None):
            del response_format
            captured["model"] = config.model
            captured["messages"] = messages
            captured["extra_payload"] = extra_payload
            return "  你好吗  "

        reading_service.call_chat_completion_text = translation_mock

        response = self.client.post(
            "/api/v1/english-reading/sentence-translation",
            json={"text": "  how   are   you?  "},
        )
        self.assertEqual(response.status_code, 200)
        response_body = response.json()
        self.assertEqual(response_body["originalText"], "how are you?")
        self.assertEqual(response_body["translatedText"], "你好吗")
        self.assertEqual(captured["model"], "qwen-mt-flash")
        self.assertEqual(
            captured["messages"],
            [{"role": "user", "content": "how are you?"}],
        )
        self.assertEqual(
            captured["extra_payload"],
            {
                "translation_options": {
                    "source_lang": "English",
                    "target_lang": "Chinese",
                }
            },
        )

    def test_sentence_translation_rejects_invalid_text(self):
        blank_response = self.client.post(
            "/api/v1/english-reading/sentence-translation",
            json={"text": "   "},
        )
        self.assertEqual(blank_response.status_code, 400)
        self.assertIn("选中", blank_response.json()["detail"])

        no_english_response = self.client.post(
            "/api/v1/english-reading/sentence-translation",
            json={"text": "你好，世界"},
        )
        self.assertEqual(no_english_response.status_code, 400)
        self.assertIn("英文内容", no_english_response.json()["detail"])

        too_long_response = self.client.post(
            "/api/v1/english-reading/sentence-translation",
            json={"text": "a" * 401},
        )
        self.assertEqual(too_long_response.status_code, 400)
        self.assertIn("400", too_long_response.json()["detail"])

    def test_sentence_translation_returns_gateway_error_when_upstream_fails(self):
        def failed_translation_mock(*, config, messages, response_format=None, extra_payload=None):
            del config, messages, response_format, extra_payload
            raise RuntimeError("upstream failed")

        reading_service.call_chat_completion_text = failed_translation_mock

        response = self.client.post(
            "/api/v1/english-reading/sentence-translation",
            json={"text": "how are you?"},
        )
        self.assertEqual(response.status_code, 502)
        self.assertIn("翻译失败", response.json()["detail"])

    def test_material_can_be_renamed_and_deleted(self):
        material = self.client.post(
            "/api/v1/english-reading/materials",
            data={"text": "Important acquisition was recalcitrant."},
        )
        self.assertEqual(material.status_code, 200)
        material_id = material.json()["id"]

        renamed = self.client.patch(
            f"/api/v1/english-reading/materials/{material_id}",
            json={"title": "Napoleon reading history item"},
        )
        self.assertEqual(renamed.status_code, 200)
        self.assertEqual(renamed.json()["title"], "Napoleon reading history item")

        workspace = self.client.get("/api/v1/english-reading")
        self.assertEqual(workspace.status_code, 200)
        self.assertEqual(
            workspace.json()["recentMaterials"][0]["title"], "Napoleon reading history item"
        )

        deleted = self.client.delete(f"/api/v1/english-reading/materials/{material_id}")
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(deleted.json()["deletedMaterialId"], material_id)

        missing = self.client.get(f"/api/v1/english-reading/materials/{material_id}")
        self.assertEqual(missing.status_code, 404)
