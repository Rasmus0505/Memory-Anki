from memory_anki.infrastructure.db._tables.english_reading import EnglishReadingArticle
from memory_anki.modules.english_reading.application import article_service
from memory_anki.modules.english_reading.presentation import router as english_reading_router
from support import RouterTestCase


class EnglishReadingGapLoopTests(RouterTestCase):
    ROUTER_MODULES = (english_reading_router,)

    def setUp(self):
        self.original_run_english_json = article_service.run_english_json
        super().setUp()

    def tearDown(self):
        article_service.run_english_json = self.original_run_english_json
        super().tearDown()

    def test_article_target_anchor_and_generation_are_persisted_idempotently(self):
        created = self.client.post(
            "/api/v1/english-reading/articles",
            data={"text": "Learning through context improves memory."},
        )
        self.assertEqual(created.status_code, 200)
        article_id = created.json()["id"]

        invalid = self.client.post(
            f"/api/v1/english-reading/articles/{article_id}/targets",
            json={"type": "word", "startOffset": 0, "endOffset": 8, "quote": "Teaching"},
        )
        self.assertEqual(invalid.status_code, 400)

        target_response = self.client.post(
            f"/api/v1/english-reading/articles/{article_id}/targets",
            json={"type": "word", "startOffset": 0, "endOffset": 8, "quote": "Learning"},
        )
        self.assertEqual(target_response.status_code, 200)
        target_id = target_response.json()["id"]

        article_service.run_english_json = lambda **_kwargs: (
            {
                "title": "Learning in Context",
                "content": "Learning through context improves memory. " * 30,
                "coverage": {"targets": [{"id": target_id, "uses": 30}]},
            },
            {"model": "test-model"},
        )
        payload = {
            "operationId": "article-operation-0001",
            "targetIds": [target_id],
            "config": {
                "cefr": "B1",
                "wordCount": 150,
                "genre": "expository",
                "topic": "memory",
                "wordRepetitions": 3,
                "sentenceVariants": 3,
                "syntaxDensity": "normal",
            },
        }
        generated = self.client.post(
            f"/api/v1/english-reading/articles/{article_id}/generate",
            json=payload,
        )
        self.assertEqual(generated.status_code, 200)
        generated_id = generated.json()["article"]["id"]
        self.assertEqual(generated.json()["article"]["depth"], 1)

        replay = self.client.post(
            f"/api/v1/english-reading/articles/{article_id}/generate",
            json=payload,
        )
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.json()["article"]["id"], generated_id)

        source = self.client.get(f"/api/v1/english-reading/articles/{article_id}").json()
        self.assertEqual(source["targets"][0]["linkedArticles"][0]["id"], generated_id)

    def test_generation_stops_after_depth_two(self):
        with self.SessionLocal() as session:
            root = EnglishReadingArticle(title="Root", content="Root text.", original_text="Root text.", depth=0)
            session.add(root)
            session.flush()
            child = EnglishReadingArticle(title="Child", content="Child text.", original_text="Child text.", depth=1, parent_article_id=root.id, kind="generated")
            session.add(child)
            session.flush()
            leaf = EnglishReadingArticle(title="Leaf", content="Leaf text.", original_text="Leaf text.", depth=2, parent_article_id=child.id, kind="generated")
            session.add(leaf)
            session.commit()
            leaf_id = leaf.id

        response = self.client.post(
            f"/api/v1/english-reading/articles/{leaf_id}/generate",
            json={"operationId": "article-operation-0002", "targetIds": [1], "config": {}},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("第二层", response.json()["detail"])

    def test_normalize_english_payload_accepts_alias_and_nested_shapes(self):
        normalized = article_service.normalize_english_payload(
            {
                "data": {
                    "meaning_here": "to gain knowledge",
                    "other_common_uses": {"partOfSpeech": "verb", "meaning": "study", "example": "I learn daily."},
                }
            },
            ("meaningHere", "otherCommonUses"),
        )
        self.assertEqual(normalized["meaningHere"], "to gain knowledge")
        self.assertEqual(normalized["otherCommonUses"][0]["meaning"], "study")
        self.assertFalse(article_service.has_cjk_text(normalized))
        self.assertTrue(article_service.has_cjk_text({"meaningHere": "学习"}))

    def test_explain_target_persists_normalized_english_result(self):
        created = self.client.post(
            "/api/v1/english-reading/articles",
            data={"text": "Learning through context improves memory."},
        )
        article_id = created.json()["id"]
        target = self.client.post(
            f"/api/v1/english-reading/articles/{article_id}/targets",
            json={"type": "word", "startOffset": 0, "endOffset": 8, "quote": "Learning"},
        )
        target_id = target.json()["id"]
        article_service.run_english_json = lambda **_kwargs: (
            {
                "meaningHere": "gaining knowledge",
                "otherCommonUses": [
                    {"partOfSpeech": "verb", "meaning": "study", "example": "Children learn fast."}
                ],
            },
            {"model": "test-model"},
        )
        explained = self.client.post(
            f"/api/v1/english-reading/targets/{target_id}/explanations",
            json={"operationId": "explain-operation-0001", "cefr": "B1"},
        )
        self.assertEqual(explained.status_code, 200)
        self.assertEqual(explained.json()["result"]["meaningHere"], "gaining knowledge")
