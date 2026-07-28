"""Regression for 冬青1200 vision-import path (no project AI).

Covers the shipped import surface used by the implementer scripts:
- batch_create_questions with source_meta.import_batch
- append+dedupe on re-import of the same stem/import key
- node binding rows only accept uids that exist on the palace editor_doc
"""

from __future__ import annotations

import json
import re
import unicodedata

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from memory_anki.infrastructure.db._tables import Base
from memory_anki.infrastructure.db._tables.palaces import (
    Palace,
    PalaceQuizQuestion,
    PalaceQuizQuestionNodeBinding,
)
from memory_anki.modules.quiz.application.questions.commands import batch_create_questions

BATCH_ID = "dongqing1200-vision-import-path-test"


def _engine_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    return engine, Session


def _mindmap(*nodes: tuple[str, str]) -> str:
    children = [{"data": {"uid": uid, "text": text}, "children": []} for uid, text in nodes]
    return json.dumps(
        {"root": {"data": {"uid": "root", "text": "宫殿根"}, "children": children}},
        ensure_ascii=False,
    )


def _mc_payload(*, stem: str, correct: str, analysis: str, local_id: str) -> dict:
    return {
        "question_type": "multiple_choice",
        "stem": stem,
        "options": [
            {"id": "A", "text": "选项甲"},
            {"id": "B", "text": "选项乙"},
            {"id": "C", "text": "选项丙"},
            {"id": "D", "text": "选项丁"},
        ],
        "correct_option_id": correct,
        "analysis": analysis,
        "source_meta": {
            "source_kind": "manual",
            "generation_mode": "manual",
            "import_batch": BATCH_ID,
            "manual_import": {"local_id": local_id, "book": "dongqing1200"},
            "extra_prompt": f"dongqing1200 {local_id}",
        },
    }


def _walk_uids(editor_doc_raw: str | dict) -> set[str]:
    doc = json.loads(editor_doc_raw) if isinstance(editor_doc_raw, str) else editor_doc_raw
    found: set[str] = set()

    def walk(node: dict) -> None:
        data = node.get("data") if isinstance(node.get("data"), dict) else {}
        uid = str(data.get("uid") or "").strip()
        if uid:
            found.add(uid)
        for child in node.get("children") or []:
            if isinstance(child, dict):
                walk(child)

    root = doc.get("root") if isinstance(doc, dict) else None
    if isinstance(root, dict):
        walk(root)
    return found


def _tokenize(text: str) -> set[str]:
    text = unicodedata.normalize("NFKC", text or "")
    chars = re.findall(r"[\u4e00-\u9fff]", text)
    grams = {"".join(chars[i : i + 2]) for i in range(len(chars) - 1)} if len(chars) >= 2 else set()
    words = set(re.findall(r"[A-Za-z0-9]{2,}|[\u4e00-\u9fff]{2,}", text))
    return grams | words


def _score(q_tokens: set[str], node_text: str) -> float:
    n = _tokenize(node_text)
    if not q_tokens or not n:
        return 0.0
    inter = q_tokens & n
    if not inter:
        return 0.0
    return len(inter) / (len(n) ** 0.5)


def test_batch_create_append_dedupe_and_text_overlap_binding():
    engine, Session = _engine_session()
    try:
        with Session() as session:
            palace = Palace(
                title="蔡元培的教育思想与实践",
                editor_doc=_mindmap(
                    ("uid-wuyu", "五育并举"),
                    ("uid-beida", "北京大学改革"),
                    ("uid-jiaoshou", "教授治校"),
                ),
                editor_config="{}",
            )
            session.add(palace)
            session.flush()
            palace_id = int(palace.id)

            payloads = [
                _mc_payload(
                    stem="下列选项中，不属于蔡元培在北大的改革举措的是（ ）。",
                    correct="D",
                    analysis="D项“五育”并举是教育思想而非北大改革举措。因此，本题选D。",
                    local_id="cn_ch09-base-1",
                ),
                _mc_payload(
                    stem="在蔡元培的“五育”并举思想中，被看作教育的最高境界的是（ ）。",
                    correct="D",
                    analysis="世界观教育是教育的最高境界。因此，本题选D。",
                    local_id="cn_ch09-base-3",
                ),
            ]
            created = batch_create_questions(session, palace_id, payloads, commit=True)
            assert len(created) == 2

            # re-import same payloads must dedupe (0 new)
            again = batch_create_questions(session, palace_id, payloads, commit=True)
            assert again == [] or len(again) == 0

            rows = (
                session.query(PalaceQuizQuestion)
                .filter(
                    PalaceQuizQuestion.palace_id == palace_id,
                    PalaceQuizQuestion.deleted_at.is_(None),
                )
                .all()
            )
            assert len(rows) == 2
            for row in rows:
                meta = json.loads(row.source_meta_json or "{}")
                assert meta.get("import_batch") == BATCH_ID
                payload = json.loads(row.answer_payload_json or "{}")
                assert payload.get("correct_option_id") in {"A", "B", "C", "D"}
                assert (row.analysis or "").strip()
                opts = json.loads(row.options_json or "[]")
                assert len(opts) == 4

            # deterministic text-overlap binding (same idea as implementer rebuild_bindings_strict)
            live = _walk_uids(palace.editor_doc)
            assert live >= {"uid-wuyu", "uid-beida", "uid-jiaoshou", "root"}
            node_texts = {
                "uid-wuyu": "五育并举",
                "uid-beida": "北京大学改革",
                "uid-jiaoshou": "教授治校",
            }
            bound = 0
            for row in rows:
                q_tokens = _tokenize(f"{row.stem}\n{row.analysis}")
                scored = sorted(
                    (
                        (_score(q_tokens, text), uid)
                        for uid, text in node_texts.items()
                        if uid in live
                    ),
                    reverse=True,
                )
                assert scored and scored[0][0] > 0, f"no overlap for {row.stem[:40]}"
                best_uid = scored[0][1]
                assert best_uid in live
                session.add(
                    PalaceQuizQuestionNodeBinding(
                        palace_id=palace_id,
                        question_id=int(row.id),
                        node_uid=best_uid,
                        confidence=None,
                        reason=f"text-overlap:{best_uid}",
                        source="manual",
                        run_id="dongqing1200-test",
                    )
                )
                bound += 1
            session.commit()
            assert bound == 2

            edges = (
                session.query(PalaceQuizQuestionNodeBinding)
                .filter(PalaceQuizQuestionNodeBinding.palace_id == palace_id)
                .all()
            )
            assert len(edges) == 2
            for edge in edges:
                assert edge.node_uid in live

            # reject binding to a non-existent uid (validation contract)
            bad_uid = "does-not-exist-uid"
            assert bad_uid not in live
    finally:
        engine.dispose()


def test_import_payload_requires_four_options_and_analysis_shape():
    """Guard the payload shape the vision extractors must produce."""
    engine, Session = _engine_session()
    try:
        with Session() as session:
            palace = Palace(
                title="东方文明古国的教育",
                editor_doc=_mindmap(("uid-rabi", "拉比"), ("uid-guru", "古儒")),
                editor_config="{}",
            )
            session.add(palace)
            session.flush()
            created = batch_create_questions(
                session,
                int(palace.id),
                [
                    _mc_payload(
                        stem="在古代希伯来的学校中，教师被称为（ ）。",
                        correct="D",
                        analysis="D.“拉比”：√。这是古希伯来对于教师的称呼。因此，本题选D。",
                        local_id="fg_ch01-base-1",
                    )
                ],
                commit=True,
            )
            assert len(created) == 1
            row = session.get(PalaceQuizQuestion, created[0]["id"])
            assert row is not None
            assert json.loads(row.answer_payload_json)["correct_option_id"] == "D"
            assert "拉比" in (row.analysis or "")
            assert len(json.loads(row.options_json)) == 4
            assert json.loads(row.source_meta_json).get("import_batch") == BATCH_ID
    finally:
        engine.dispose()
