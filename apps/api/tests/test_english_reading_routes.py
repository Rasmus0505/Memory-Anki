import io
import json
import tempfile
import unittest
from pathlib import Path

import fitz
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from memory_anki.infrastructure.db.models import Base, EnglishReadingLexiconCache
from memory_anki.modules.english_reading.application import service as reading_service
from memory_anki.modules.english_reading.presentation import router as english_reading_router


def build_pdf_bytes() -> bytes:
  document = fitz.open()
  try:
    for page_number in range(1, 3):
      page = document.new_page()
      page.insert_text((72, 72), 'Weekly Reader')
      page.insert_text((72, 108), f'Page {page_number}')
      page.insert_text((72, 160), 'Important acquisition was recalcitrant.')
      page.insert_text((72, 188), 'According to rules, she cheated.')
      page.insert_text((72, 216), f'Body line {page_number}')
      page.insert_text((72, 244), 'Footer note')
    return document.tobytes()
  finally:
    document.close()


def build_bilingual_pdf_bytes() -> bytes:
  document = fitz.open()
  try:
    page = document.new_page()
    page.insert_text((72, 72), 'P1')
    page.insert_text((72, 108), '这是一段中文导读。')
    page.insert_text((72, 144), 'Napoleon retreated through brutal winter conditions.')
    page.insert_text((72, 180), 'Food was scarce and disease spread quickly.')
    page.insert_text((72, 216), '拿破仑的军队遭受重创。')
    return document.tobytes()
  finally:
    document.close()


class EnglishReadingRouteTests(unittest.TestCase):
  def setUp(self):
    self.engine = create_engine(
      'sqlite://',
      connect_args={'check_same_thread': False},
      poolclass=StaticPool,
    )
    Base.metadata.create_all(self.engine)
    self.SessionLocal = sessionmaker(bind=self.engine)
    self.original_router_get_session = english_reading_router.get_session
    self.original_runtime = reading_service.get_english_reading_runtime()
    self.original_call_chat_completion_text = reading_service.call_chat_completion_text
    self.original_api_key = reading_service.DASHSCOPE_API_KEY
    self.original_text_model = reading_service.DASHSCOPE_TEXT_MODEL
    self.original_cefr_path = reading_service.ENGLISH_READING_CEFR_PATH
    self.original_lexicon_state = reading_service._lexicon_state
    self.classification_calls = 0
    self.sentence_adaptation_calls = 0
    self.temp_dir = tempfile.TemporaryDirectory()
    self.source_cefr_path = Path(self.temp_dir.name) / 'source-cefr.json'
    self.managed_cefr_path = Path(self.temp_dir.name) / 'managed' / 'cefr.json'
    self.source_cefr_path.write_text(
      json.dumps(
        [
          {'word': 'according to', 'cefr': ['A1']},
          {'word': 'important', 'cefr': ['A1']},
          {'word': 'was', 'cefr': ['A1']},
          {'word': 'rule', 'cefr': ['A1']},
          {'word': 'she', 'cefr': ['A1']},
          {'word': 'change', 'cefr': ['A2']},
          {'word': 'cheat', 'cefr': ['A2']},
          {'word': 'crucial', 'cefr': ['B1']},
          {'word': 'stubborn', 'cefr': ['A2']},
          {'word': 'recalcitrant', 'cefr': ['C1']},
        ],
        ensure_ascii=False,
      ),
      encoding='utf-8',
    )
    reading_service.ENGLISH_READING_CEFR_PATH = self.managed_cefr_path
    reading_service.configure_english_reading_runtime(
      reading_service.EnglishReadingRuntime(cefr_source_path=self.source_cefr_path)
    )
    reading_service._lexicon_state = None
    reading_service.DASHSCOPE_API_KEY = 'test-key'
    reading_service.DASHSCOPE_TEXT_MODEL = 'qwen3.6-flash'

    def get_test_session():
      return self.SessionLocal()

    english_reading_router.get_session = get_test_session

    with self.SessionLocal() as session:
      reading_service.prepare_english_reading_runtime(session)

    app = FastAPI()
    app.include_router(english_reading_router.router, prefix='/api/v1')
    self.client = TestClient(app)

  def tearDown(self):
    english_reading_router.get_session = self.original_router_get_session
    reading_service.configure_english_reading_runtime(self.original_runtime)
    reading_service.call_chat_completion_text = self.original_call_chat_completion_text
    reading_service.DASHSCOPE_API_KEY = self.original_api_key
    reading_service.DASHSCOPE_TEXT_MODEL = self.original_text_model
    reading_service.ENGLISH_READING_CEFR_PATH = self.original_cefr_path
    reading_service._lexicon_state = self.original_lexicon_state
    Base.metadata.drop_all(self.engine)
    self.engine.dispose()
    self.temp_dir.cleanup()

  def mock_llm(self, *, config, messages, response_format=None):
    del config, response_format
    prompt = str(messages[-1]['content'])
    if '待处理词' in prompt:
      self.classification_calls += 1
      return json.dumps(
        {
          'items': [
            {
              'surface': 'acquisition',
              'lemma': 'acquire',
              'basePhrase': 'acquire',
              'cefr': 'B2',
              'confidence': 0.93,
              'explainZh': 'Noun form related to acquire.',
            }
          ]
        },
        ensure_ascii=False,
      )
    if 'Important acquisition was recalcitrant.' in prompt:
      self.sentence_adaptation_calls += 1
      return json.dumps(
        {
          'parts': [
            {
              'text': 'Crucial',
              'kind': 'yellow',
              'originalText': 'Important',
              'displayText': 'Crucial',
              'sourceCefr': 'A1',
              'targetCefr': 'B1',
              'explainZh': 'A more natural upgrade.',
            },
            {'text': ' '},
            {
              'text': 'acquisition',
              'kind': 'green',
              'originalText': 'acquisition',
              'displayText': 'acquisition',
              'sourceCefr': 'B2',
              'targetCefr': 'B2',
              'explainZh': 'Naturally sits in the i+1 zone.',
            },
            {'text': ' was '},
            {
              'text': 'stubborn',
              'kind': 'red',
              'originalText': 'recalcitrant',
              'displayText': 'stubborn',
              'sourceCefr': 'C1',
              'targetCefr': 'A2',
              'explainZh': 'Simplified first to keep reading smooth.',
            },
            {'text': '.'},
          ],
          'sentenceAnnotation': {
            'kind': 'syntax_simplified',
            'originalText': 'Important acquisition was recalcitrant.',
            'displayText': 'Crucial acquisition was stubborn.',
            'skeletonHints': ['subject', 'verb'],
          },
        },
        ensure_ascii=False,
      )
    if 'According to rules, she cheated.' in prompt:
      self.sentence_adaptation_calls += 1
      return json.dumps(
        {
          'parts': [{'text': 'According to rules, she cheated.'}],
          'sentenceAnnotation': {
            'kind': 'unchanged',
            'originalText': 'According to rules, she cheated.',
            'displayText': 'According to rules, she cheated.',
            'skeletonHints': [],
          },
        },
        ensure_ascii=False,
      )
    raise AssertionError(f'Unexpected prompt: {prompt}')

  def test_profile_get_and_update(self):
    profile = self.client.get('/api/v1/english-reading/profile')
    self.assertEqual(profile.status_code, 200)
    self.assertEqual(profile.json()['declaredCefr'], 'B1')
    self.assertEqual(profile.json()['workingLexicalI'], 2.4)
    self.assertEqual(profile.json()['workingSyntacticI'], 2.25)

    updated = self.client.put('/api/v1/english-reading/profile', json={'declaredCefr': 'A2'})
    self.assertEqual(updated.status_code, 200)
    self.assertEqual(updated.json()['declaredCefr'], 'A2')
    self.assertEqual(updated.json()['workingLexicalI'], 1.4)
    self.assertEqual(updated.json()['workingSyntacticI'], 1.25)
    self.assertEqual(updated.json()['xp'], 0)

  def test_create_material_from_paste_and_pdf(self):
    paste_response = self.client.post(
      '/api/v1/english-reading/materials',
      data={'text': 'Important acquisition was recalcitrant.'},
    )
    self.assertEqual(paste_response.status_code, 200)
    self.assertEqual(paste_response.json()['sourceType'], 'paste')
    self.assertEqual(paste_response.json()['wordCount'], 4)

    pdf_response = self.client.post(
      '/api/v1/english-reading/materials',
      files={'reading_file': ('reader.pdf', io.BytesIO(build_pdf_bytes()), 'application/pdf')},
    )
    self.assertEqual(pdf_response.status_code, 200)
    self.assertEqual(pdf_response.json()['sourceType'], 'pdf')
    material_id = pdf_response.json()['id']
    with self.SessionLocal() as session:
      material = session.get(reading_service.EnglishReadingMaterial, material_id)
      self.assertIsNotNone(material)
      self.assertIn('Important acquisition was recalcitrant.', material.cleaned_text)
      self.assertIn('According to rules, she cheated.', material.cleaned_text)
      self.assertNotIn('Weekly Reader', material.cleaned_text)
      self.assertNotIn('Page 1', material.cleaned_text)
      self.assertNotIn('Footer note', material.cleaned_text)

  def test_generate_version_uses_local_resolution_ai_fallback_and_cache(self):
    reading_service.call_chat_completion_text = self.mock_llm

    material = self.client.post(
      '/api/v1/english-reading/materials',
      data={'text': 'Important acquisition was recalcitrant. According to rules, she cheated.'},
    )
    self.assertEqual(material.status_code, 200)
    material_id = material.json()['id']

    version = self.client.post(
      f'/api/v1/english-reading/materials/{material_id}/generate',
      json={'mode': 'initial'},
    )
    self.assertEqual(version.status_code, 200)
    payload = version.json()
    self.assertEqual(payload['summary']['greenCount'], 1)
    self.assertGreaterEqual(payload['summary']['yellowCount'], 1)
    self.assertEqual(payload['summary']['redCount'], 1)
    self.assertEqual(payload['summary']['sentenceSimplifiedCount'], 1)
    self.assertEqual(len(payload['spanAnnotations']), 3)
    self.assertEqual([item['kind'] for item in payload['spanAnnotations']], ['yellow', 'green', 'red'])
    self.assertEqual(payload['spanAnnotations'][0]['displayText'], 'Crucial')
    self.assertEqual(payload['spanAnnotations'][1]['displayText'], 'acquisition')
    self.assertEqual(payload['spanAnnotations'][2]['displayText'], 'stubborn')
    self.assertEqual(payload['sentenceAnnotations'][0]['kind'], 'syntax_simplified')
    self.assertEqual(payload['sentenceAnnotations'][0]['skeletonHints'], ['subject', 'verb'])
    self.assertEqual(payload['spanAnnotations'][0]['explainZh'], 'A more natural upgrade.')
    self.assertEqual(payload['spanAnnotations'][1]['explainZh'], 'Naturally sits in the i+1 zone.')
    self.assertEqual(payload['spanAnnotations'][2]['explainZh'], 'Simplified first to keep reading smooth.')

    with self.SessionLocal() as session:
      cached_rows = session.query(EnglishReadingLexiconCache).all()
      self.assertEqual([row.normalized_surface for row in cached_rows], ['acquisition'])
      self.assertEqual(cached_rows[0].cefr, 'B2')

    second_material = self.client.post(
      '/api/v1/english-reading/materials',
      data={'text': 'Acquisition changed.'},
    )
    self.assertEqual(second_material.status_code, 200)
    second_id = second_material.json()['id']
    second_version = self.client.post(
      f'/api/v1/english-reading/materials/{second_id}/generate',
      json={'mode': 'initial'},
    )
    self.assertEqual(second_version.status_code, 200)
    second_payload = second_version.json()
    self.assertEqual(second_payload['summary']['greenCount'], 1)
    self.assertEqual(self.classification_calls, 1)
    self.assertGreaterEqual(self.sentence_adaptation_calls, 1)

  def test_regenerate_supports_same_easier_harder_and_legacy_ease(self):
    reading_service.call_chat_completion_text = self.mock_llm
    material = self.client.post(
      '/api/v1/english-reading/materials',
      data={'text': 'Important acquisition was recalcitrant.'},
    )
    self.assertEqual(material.status_code, 200)
    material_id = material.json()['id']

    same_response = self.client.post(
      f'/api/v1/english-reading/materials/{material_id}/generate',
      json={'mode': 'regenerate', 'difficultyDirection': 'same'},
    )
    self.assertEqual(same_response.status_code, 200)
    same_payload = same_response.json()
    self.assertEqual(same_payload['workingLexicalI'], 2.4)
    self.assertEqual(same_payload['workingSyntacticI'], 2.25)

    easier_response = self.client.post(
      f'/api/v1/english-reading/materials/{material_id}/generate',
      json={'mode': 'regenerate', 'difficultyDirection': 'easier', 'difficultyDelta': 1.5},
    )
    self.assertEqual(easier_response.status_code, 200)
    easier_payload = easier_response.json()
    self.assertEqual(easier_payload['workingLexicalI'], 1.05)
    self.assertEqual(easier_payload['workingSyntacticI'], 1.2)

    harder_response = self.client.post(
      f'/api/v1/english-reading/materials/{material_id}/generate',
      json={'mode': 'regenerate', 'difficultyDirection': 'harder', 'difficultyDelta': 2.0},
    )
    self.assertEqual(harder_response.status_code, 200)
    harder_payload = harder_response.json()
    self.assertEqual(harder_payload['workingLexicalI'], 4.2)
    self.assertEqual(harder_payload['workingSyntacticI'], 3.65)

    legacy_ease_response = self.client.post(
      f'/api/v1/english-reading/materials/{material_id}/generate',
      json={'mode': 'ease'},
    )
    self.assertEqual(legacy_ease_response.status_code, 200)
    legacy_ease_payload = legacy_ease_response.json()
    self.assertEqual(legacy_ease_payload['workingLexicalI'], 1.95)
    self.assertEqual(legacy_ease_payload['workingSyntacticI'], 1.9)

  def test_regenerate_rejects_invalid_direction_and_delta(self):
    material = self.client.post(
      '/api/v1/english-reading/materials',
      data={'text': 'Important acquisition was recalcitrant.'},
    )
    self.assertEqual(material.status_code, 200)
    material_id = material.json()['id']

    invalid_direction = self.client.post(
      f'/api/v1/english-reading/materials/{material_id}/generate',
      json={'mode': 'regenerate', 'difficultyDirection': 'lower'},
    )
    self.assertEqual(invalid_direction.status_code, 400)
    self.assertIn('难度方向', invalid_direction.json()['detail'])

    invalid_delta = self.client.post(
      f'/api/v1/english-reading/materials/{material_id}/generate',
      json={'mode': 'regenerate', 'difficultyDirection': 'easier', 'difficultyDelta': 0.3},
    )
    self.assertEqual(invalid_delta.status_code, 400)
    self.assertIn('难度变化幅度', invalid_delta.json()['detail'])

  def test_local_fallback_keeps_only_natural_green_words_colored(self):
    reading_service.DASHSCOPE_API_KEY = ''

    material = self.client.post(
      '/api/v1/english-reading/materials',
      data={'text': 'Important acquisition was recalcitrant.'},
    )
    self.assertEqual(material.status_code, 200)

    version = self.client.post(
      f"/api/v1/english-reading/materials/{material.json()['id']}/generate",
      json={'mode': 'initial'},
    )
    self.assertEqual(version.status_code, 200)
    payload = version.json()
    self.assertEqual(payload['summary']['greenCount'], 1)
    self.assertEqual(payload['summary']['yellowCount'], 0)
    self.assertEqual(payload['summary']['redCount'], 0)
    self.assertEqual(payload['summary']['sentenceSimplifiedCount'], 0)
    self.assertEqual(len(payload['spanAnnotations']), 1)
    self.assertEqual(payload['spanAnnotations'][0]['kind'], 'green')
    self.assertEqual(payload['spanAnnotations'][0]['originalText'], 'acquisition')
    self.assertEqual(payload['spanAnnotations'][0]['displayText'], 'acquisition')

  def test_sentence_simplification_without_word_rewrites_stays_uncolored(self):
    def sentence_only_mock(*, config, messages, response_format=None):
      del config, response_format
      prompt = str(messages[-1]['content'])
      if 'According to rules, she cheated.' not in prompt:
        raise AssertionError(f'Unexpected prompt: {prompt}')
      return json.dumps(
        {
          'parts': [{'text': 'She cheated by the rules.'}],
          'sentenceAnnotation': {
            'kind': 'syntax_simplified',
            'originalText': 'According to rules, she cheated.',
            'displayText': 'She cheated by the rules.',
            'skeletonHints': ['subject', 'verb'],
          },
        },
        ensure_ascii=False,
      )

    reading_service.call_chat_completion_text = sentence_only_mock

    material = self.client.post(
      '/api/v1/english-reading/materials',
      data={'text': 'According to rules, she cheated.'},
    )
    self.assertEqual(material.status_code, 200)

    version = self.client.post(
      f"/api/v1/english-reading/materials/{material.json()['id']}/generate",
      json={'mode': 'initial'},
    )
    self.assertEqual(version.status_code, 200)
    payload = version.json()
    self.assertEqual(payload['summary']['sentenceSimplifiedCount'], 1)
    self.assertEqual(payload['summary']['yellowCount'], 0)
    self.assertEqual(payload['summary']['redCount'], 0)
    self.assertEqual(payload['spanAnnotations'], [])
    self.assertEqual(payload['sentenceAnnotations'][0]['kind'], 'syntax_simplified')

  def test_generate_version_from_bilingual_pdf_returns_english_only_result(self):
    reading_service.call_chat_completion_text = self.mock_llm
    material = self.client.post(
      '/api/v1/english-reading/materials',
      files={'reading_file': ('bilingual.pdf', io.BytesIO(build_bilingual_pdf_bytes()), 'application/pdf')},
    )
    self.assertEqual(material.status_code, 200)
    self.assertIn('Napoleon retreated through brutal winter conditions.', material.json()['title'])
    material_id = material.json()['id']

    version = self.client.post(
      f'/api/v1/english-reading/materials/{material_id}/generate',
      json={'mode': 'initial'},
    )
    self.assertEqual(version.status_code, 200)
    payload = version.json()
    rendered_text = '\n'.join(
      sentence['displayText']
      for block in payload['renderBlocks']
      for sentence in block['sentences']
    )
    self.assertIn('Napoleon retreated through brutal winter conditions.', rendered_text)
    self.assertIn('Food was scarce and disease spread quickly.', rendered_text)
    self.assertNotIn('这是一段中文导读', rendered_text)
    self.assertNotIn('拿破仑的军队遭受重创', rendered_text)

  def test_complete_flow_updates_profile_and_session_stats(self):
    reading_service.call_chat_completion_text = self.mock_llm

    material = self.client.post(
      '/api/v1/english-reading/materials',
      data={'text': 'Important acquisition was recalcitrant.'},
    )
    material_id = material.json()['id']
    version = self.client.post(
      f'/api/v1/english-reading/materials/{material_id}/generate',
      json={'mode': 'initial'},
    )
    version_id = version.json()['id']

    completion = self.client.post(
      f'/api/v1/english-reading/materials/{material_id}/complete',
      json={
        'versionId': version_id,
        'feedback': 'just_right',
        'durationSeconds': 120,
        'hoverCount': 2,
        'expandCount': 1,
      },
    )
    self.assertEqual(completion.status_code, 200)
    payload = completion.json()
    self.assertEqual(payload['session']['feedback'], 'just_right')
    self.assertEqual(payload['session']['durationSeconds'], 120)
    self.assertEqual(payload['session']['wordsPerMinute'], 2)
    self.assertEqual(payload['session']['xpAwarded'], 5)
    self.assertEqual(payload['profile']['levelProgress'], 5)
    self.assertGreater(payload['profile']['workingLexicalI'], 2.4)
    self.assertGreater(payload['profile']['workingSyntacticI'], 2.25)

  def test_material_can_be_renamed_and_deleted(self):
    material = self.client.post(
      '/api/v1/english-reading/materials',
      data={'text': 'Important acquisition was recalcitrant.'},
    )
    self.assertEqual(material.status_code, 200)
    material_id = material.json()['id']

    renamed = self.client.patch(
      f'/api/v1/english-reading/materials/{material_id}',
      json={'title': 'Napoleon reading history item'},
    )
    self.assertEqual(renamed.status_code, 200)
    self.assertEqual(renamed.json()['title'], 'Napoleon reading history item')

    workspace = self.client.get('/api/v1/english-reading')
    self.assertEqual(workspace.status_code, 200)
    self.assertEqual(workspace.json()['recentMaterials'][0]['title'], 'Napoleon reading history item')

    deleted = self.client.delete(f'/api/v1/english-reading/materials/{material_id}')
    self.assertEqual(deleted.status_code, 200)
    self.assertEqual(deleted.json()['deletedMaterialId'], material_id)

    missing = self.client.get(f'/api/v1/english-reading/materials/{material_id}')
    self.assertEqual(missing.status_code, 404)
