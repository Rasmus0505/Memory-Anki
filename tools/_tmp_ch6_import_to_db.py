# -*- coding: utf-8 -*-
"""Import chapter-6 seven palaces (mindmap + quizzes) into Memory Anki DB."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

ROOT = Path(r"D:\BaiduSyncdisk\Memory Anki")
sys.path.insert(0, str(ROOT / "apps" / "api" / "src"))
os.environ.setdefault("MEMORY_ANKI_HOME", r"E:\memory anki data")

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables import engine
from memory_anki.infrastructure.db._tables.knowledge import Chapter, Subject
from memory_anki.infrastructure.db._tables.palaces import Palace, PalaceQuizQuestion
from memory_anki.modules.content.application.editor_state_service import (
    get_palace_editor_state,
    save_palace_editor_state,
)
from memory_anki.modules.content.application.palace_chapter_binding import (
    set_palace_chapter_links,
)
from memory_anki.modules.produce.application.mindmap_import.normalization import (
    build_editor_doc,
    normalize_source_tree,
)
from memory_anki.modules.quiz.application.questions.commands import batch_create_questions

SOURCE = ROOT / "tools" / "_tmp_ch6_vision" / "out" / "ch6_seven_palaces_final.json"
SUBJECT_ID = 5  # 外国教育史

# (json title key fragment, chapter_id, preferred title)
PALACE_SPECS = [
    ("夸美纽斯", 70, "第一节 夸美纽斯的教育思想"),
    ("卢梭", 71, "第二节 卢梭的教育思想"),
    ("裴斯泰洛齐", 72, "第三节 裴斯泰洛齐的教育思想"),
    ("赫尔巴特", 73, "第四节 赫尔巴特的教育思想"),
    ("福禄培尔", 74, "第五节 福禄培尔的教育思想"),
    ("马克思", 75, "第六节 马克思和恩格斯的教育思想"),
    ("教育思潮", 76, "第七节 西欧近代教育思潮"),
]


def count_nodes(doc: dict) -> int:
    root = (doc or {}).get("root") or {}
    total = 0

    def walk(nodes: list) -> None:
        nonlocal total
        for n in nodes or []:
            total += 1
            walk(n.get("children") or [])

    walk(root.get("children") or [])
    return total


def find_source_palace(payload: dict, key_fragment: str, preferred_title: str) -> dict:
    for item in payload.get("palaces") or []:
        title = str(item.get("title") or "")
        if key_fragment in title or title == preferred_title:
            return item
    raise SystemExit(f"source palace not found for {preferred_title}")


def ensure_palace(session: Session, *, title: str, chapter_id: int, subject: Subject) -> Palace:
    chapter = session.get(Chapter, chapter_id)
    if chapter is None:
        raise SystemExit(f"chapter {chapter_id} missing")

    palace = (
        session.query(Palace)
        .filter(
            Palace.primary_chapter_id == chapter_id,
            Palace.deleted_at.is_(None),
        )
        .order_by(Palace.id.asc())
        .first()
    )
    if palace is None:
        # also match by title
        palace = (
            session.query(Palace)
            .filter(
                Palace.deleted_at.is_(None),
                Palace.title.like(f"%{title[-8:]}%"),
            )
            .order_by(Palace.id.desc())
            .first()
        )
        # avoid matching unrelated chapters
        if palace is not None and palace.primary_chapter_id not in (None, chapter_id):
            palace = None

    if palace is None:
        palace = Palace(
            title=title,
            description="第六章 西欧近代教育思想与教育思潮",
            difficulty=3,
            review_mode="flashcard",
            title_mode="manual",
            manual_title=title,
        )
        session.add(palace)
        session.flush()
        print(f"  created palace id={palace.id}")
    else:
        print(f"  reuse palace id={palace.id} title={palace.title!r}")

    palace.title = title
    palace.manual_title = title
    palace.title_mode = "manual"
    palace.primary_chapter_id = chapter_id
    palace.subjects = [subject]
    set_palace_chapter_links(session, palace, [chapter_id])
    palace.binding_revision = int(getattr(palace, "binding_revision", 0) or 0) + 1
    session.flush()
    return palace


def apply_mindmap(session: Session, palace: Palace, mindmap: dict) -> int:
    source = normalize_source_tree(
        {
            "title": mindmap.get("title") or palace.title,
            "children": mindmap.get("children") or [],
        },
        disable_rebalance=True,
    )
    editor_doc = build_editor_doc(
        source,
        fallback_title=palace.title,
        preserve_line_breaks=True,
    )
    # ensure root text
    root_data = (editor_doc.get("root") or {}).setdefault("data", {})
    root_data["text"] = palace.title
    root_data["memoryAnkiRootKind"] = "palace"
    root_data["uid"] = root_data.get("uid") or "palace-root"
    root_data["expand"] = True

    state = get_palace_editor_state(palace)
    result = save_palace_editor_state(
        session,
        palace,
        {
            "editor_doc": editor_doc,
            "expected_editor_fingerprint": state.get("editor_fingerprint") or "",
            "editor_source": "import_apply",
            "confirm_dangerous_change": True,
            "allow_stale_overwrite": True,
        },
    )
    return count_nodes(result.get("editor_doc") or {})


def map_question_type(raw: str) -> str:
    t = (raw or "").strip()
    if t == "multiple_choice":
        return "multiple_choice"
    # essay / material_analysis / short_answer → short_answer
    return "short_answer"


def quiz_payloads(items: list[dict], *, chapter_id: int) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for idx, q in enumerate(items or [], start=1):
        stem = str(q.get("stem") or "").strip()
        if not stem:
            continue
        qtype = map_question_type(str(q.get("question_type") or ""))
        analysis = str(q.get("analysis") or "").strip()
        block = str(q.get("block") or "").strip()
        source_meta = {
            "source_kind": "ch6_vision_import",
            "import_batch": "ch6-seven-palace-import-20260724",
            "block": block,
            "section_chapter_id": chapter_id,
        }
        if qtype == "multiple_choice":
            options = q.get("options") or []
            correct = str(q.get("correct_option_id") or q.get("answer") or "").strip()
            if not options or not correct:
                print(f"    skip MC incomplete: {stem[:40]}")
                continue
            out.append(
                {
                    "question_type": "multiple_choice",
                    "stem": stem,
                    "options": options,
                    "correct_option_id": correct,
                    "analysis": analysis,
                    "source_chapter_id": chapter_id,
                    "source_meta": source_meta,
                }
            )
        else:
            ref = str(q.get("reference_answer") or "").strip()
            if not ref:
                ref = analysis
            if not ref:
                ref = "（解析册未给出完整参考答案，请结合教材作答）"
            out.append(
                {
                    "question_type": "short_answer",
                    "stem": stem,
                    "reference_answer": ref,
                    "analysis": analysis,
                    "source_chapter_id": chapter_id,
                    "source_meta": source_meta,
                }
            )
    return out


def replace_quizzes(session: Session, palace: Palace, payloads: list[dict], chapter_id: int) -> int:
    # soft-delete existing questions on this palace from prior import or empty
    existing = (
        session.query(PalaceQuizQuestion)
        .filter(
            PalaceQuizQuestion.palace_id == palace.id,
            PalaceQuizQuestion.deleted_at.is_(None),
        )
        .all()
    )
    from memory_anki.core.time import utc_now_naive

    now = utc_now_naive()
    for row in existing:
        # only clear ones we previously imported, or all if first fill
        meta = {}
        try:
            meta = json.loads(row.source_meta_json or "{}")
        except Exception:
            meta = {}
        if not existing or meta.get("import_batch") == "ch6-seven-palace-import-20260724" or True:
            # For first write into empty ch6 palaces, clear all active questions on palace
            row.deleted_at = now
            row.updated_at = now
            row.lifecycle_status = "archived"
    session.flush()

    if not payloads:
        return 0
    created = batch_create_questions(session, palace.id, payloads, commit=False)
    # ensure source_chapter_id
    for row in (
        session.query(PalaceQuizQuestion)
        .filter(
            PalaceQuizQuestion.palace_id == palace.id,
            PalaceQuizQuestion.deleted_at.is_(None),
        )
        .all()
    ):
        if row.source_chapter_id is None:
            row.source_chapter_id = chapter_id
    return len(created)


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"missing source {SOURCE}")
    payload = json.loads(SOURCE.read_text(encoding="utf-8"))
    report: list[dict] = []

    with Session(engine) as session:
        subject = session.get(Subject, SUBJECT_ID)
        if subject is None:
            raise SystemExit(f"subject {SUBJECT_ID} missing")

        for key_fragment, chapter_id, title in PALACE_SPECS:
            print(f"== {title} (chapter {chapter_id}) ==")
            src = find_source_palace(payload, key_fragment, title)
            mindmap = src.get("mindmap") or {"title": title, "children": src.get("children") or []}
            if "children" not in mindmap and "children" in src:
                mindmap = {"title": src.get("title") or title, "children": src.get("children") or []}
            # if structure is already title/children at top of src.mindmap
            if not mindmap.get("children") and src.get("mindmap"):
                mindmap = src["mindmap"]

            palace = ensure_palace(session, title=title, chapter_id=chapter_id, subject=subject)
            node_count = apply_mindmap(session, palace, mindmap)
            q_payloads = quiz_payloads(src.get("quizzes") or [], chapter_id=chapter_id)
            q_count = replace_quizzes(session, palace, q_payloads, chapter_id)
            session.commit()
            session.refresh(palace)
            item = {
                "palace_id": palace.id,
                "title": palace.title,
                "chapter_id": chapter_id,
                "nodes": node_count,
                "quizzes": q_count,
            }
            report.append(item)
            print(f"  saved nodes={node_count} quizzes={q_count}")

    out = ROOT / "tools" / "_tmp_ch6_vision" / "out" / "import_report.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("DONE", report)


if __name__ == "__main__":
    main()
