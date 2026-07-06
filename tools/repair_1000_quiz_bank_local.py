from __future__ import annotations

import argparse
import json
import re
import shutil
import sqlite3
import sys
import time
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image
from rapidocr_onnxruntime import RapidOCR


REPO_ROOT = Path(__file__).resolve().parents[1]
API_SRC = REPO_ROOT / "apps" / "api" / "src"
if str(API_SRC) not in sys.path:
    sys.path.insert(0, str(API_SRC))

DEFAULT_SOURCE_ROOT = Path(r"D:\考研（丹丹）\1000题")
DEFAULT_DB = Path(r"D:\BaiduSyncdisk\MemoryAnki-Sync\app-home\data\memory_palace.db")
DEFAULT_WORK_ROOT = REPO_ROOT / ".audit" / "1000-quiz-local-repair"

REPAIR_BATCH = "1000-quiz-local-repair-20260706"
OPTION_RE = re.compile(r"^\s*([A-D])\s*[.．、。]\s*(.+)$", re.I)
QUESTION_START_RE = re.compile(r"^\s*(\d{1,3})\s*[.．、]\s*(.*)$")
ANSWER_START_RE = re.compile(r"^\s*(\d{1,3})\s*[.．、]?\s*[【\[]?\s*答案\s*[】\]]?\s*[:：]?\s*([A-D]*)\s*(.*)$", re.I)
ANSWER_INLINE_RE = re.compile(r"[【\[]?\s*答案\s*[】\]]?\s*[:：]?\s*([A-D])", re.I)
YEAR_TAG_RE = re.compile(r"【\s*\d{4}\s*年?\s*311\s*真题\s*\d*\s*】")
QUESTION_TYPE_LABELS = {
    "单项选择题": "multiple_choice",
    "多项选择题": "multiple_choice",
    "选择题": "multiple_choice",
    "简答题": "short_answer",
    "辨析题": "short_answer",
    "论述题": "short_answer",
    "材料分析题": "short_answer",
    "分析论述题": "short_answer",
}


IMAGE_SETS = {
    "zhongjiao_questions": {"subject": "zhongjiao", "role": "question"},
    "zhongjiao_answers": {"subject": "zhongjiao", "role": "answer"},
    "waijiao_questions": {"subject": "waijiao", "role": "question"},
    "waijiao_answers": {"subject": "waijiao", "role": "answer"},
    "jiaoyuan_questions": {"subject": "jiaoyuan", "role": "question"},
    "jiaoyuan_answers": {"subject": "jiaoyuan", "role": "answer"},
    "jiaoxin_questions": {"subject": "jiaoxin", "role": "question"},
    "jiaoxin_answers": {"subject": "jiaoxin", "role": "answer"},
}


PALACE_SUBJECT_RULES = [
    ("zhongjiao", re.compile(r"(蔡元培|新文化|收回教育权|国民政府|共产党|根据地|杨贤江|黄炎培|晏阳初|梁漱溟|陈鹤琴|陶行知|恽代英|李大钊|民国|现代教育家)")),
    ("waijiao", re.compile(r"(东方文明|古希腊|古罗马|西欧中世纪|人文主义|新教教育|天主教|英国近代|法国近代|德国近代|俄国近代|美国近代|日本近代)")),
]


def json_dump(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def json_load(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def normalize_text(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or ""))
    text = text.translate(str.maketrans({"（": "(", "）": ")", "．": ".", "。": ".", "，": ",", "：": ":"}))
    text = re.sub(r"\s+", "", text)
    return text.strip()


def compact_for_match(value: Any) -> str:
    text = normalize_text(value)
    text = re.sub(r"^\d+[.、．]", "", text)
    text = re.sub(r"[\"'“”‘’]", "", text)
    return text.lower()


def page_number(path: Path) -> int:
    match = re.search(r"page[_-](\d+)", path.stem)
    return int(match.group(1)) if match else 0


def is_noise(text: str) -> bool:
    compact = normalize_text(text)
    if not compact:
        return True
    if re.search(r"后续更新\s*q+群?\s*\d*", compact, re.I):
        return True
    if re.fullmatch(r"[S5]?\d{1,4}", compact):
        return True
    return False


def line_center(box: list[list[float]]) -> tuple[float, float]:
    xs = [float(p[0]) for p in box]
    ys = [float(p[1]) for p in box]
    return (sum(xs) / len(xs), sum(ys) / len(ys))


def normalize_ocr_result(result: list[Any]) -> list[dict[str, Any]]:
    lines: list[dict[str, Any]] = []
    for item in result or []:
        if len(item) < 3:
            continue
        box, text, score = item[0], str(item[1]).strip(), float(item[2])
        if is_noise(text):
            continue
        cx, cy = line_center(box)
        xs = [float(p[0]) for p in box]
        ys = [float(p[1]) for p in box]
        lines.append(
            {
                "box": box,
                "text": text,
                "score": score,
                "cx": cx,
                "cy": cy,
                "x0": min(xs),
                "x1": max(xs),
                "y0": min(ys),
                "y1": max(ys),
            }
        )
    return lines


def reading_order(lines: list[dict[str, Any]], image_width: int) -> list[dict[str, Any]]:
    if not lines:
        return []
    # Most source images are two-column spreads after PDF page splitting. Sorting by
    # column first avoids interleaving left/right options into the same question.
    midpoint = image_width / 2
    gutter = image_width * 0.08

    def column(line: dict[str, Any]) -> int:
        if line["cx"] < midpoint - gutter:
            return 0
        if line["cx"] > midpoint + gutter:
            return 1
        return 0 if line["x0"] < midpoint else 1

    return sorted(lines, key=lambda r: (column(r), round(float(r["cy"]) / 14) * 14, float(r["x0"])))


def ocr_image(engine: RapidOCR, image_path: Path, cache_path: Path, force: bool) -> dict[str, Any]:
    if cache_path.exists() and not force:
        return json_load(cache_path, {})
    started = time.time()
    image = Image.open(image_path).convert("RGB")
    result, elapsed = engine(np.array(image))
    lines = reading_order(normalize_ocr_result(result or []), image.width)
    payload = {
        "image_path": str(image_path),
        "image_set": image_path.parent.name,
        "page": page_number(image_path),
        "width": image.width,
        "height": image.height,
        "elapsed": elapsed,
        "wall_seconds": round(time.time() - started, 2),
        "line_count": len(lines),
        "text": "\n".join(line["text"] for line in lines),
        "lines": lines,
    }
    json_dump(cache_path, payload)
    return payload


def ocr_all(source_root: Path, work_root: Path, *, force: bool = False, limit_pages: int = 0) -> dict[str, list[dict[str, Any]]]:
    engine = RapidOCR()
    pages_by_set: dict[str, list[dict[str, Any]]] = {}
    for image_set in IMAGE_SETS:
        image_dir = source_root / "images" / image_set
        paths = sorted(image_dir.glob("page_*.*"), key=page_number)
        if limit_pages:
            paths = paths[:limit_pages]
        pages = []
        for path in paths:
            cache_path = work_root / "ocr" / image_set / f"{path.stem}.json"
            print(f"ocr {image_set} page {page_number(path)}", flush=True)
            pages.append(ocr_image(engine, path, cache_path, force))
        pages_by_set[image_set] = pages
    json_dump(work_root / "ocr_index.json", pages_by_set)
    return pages_by_set


def load_cached_ocr(work_root: Path, image_sets: set[str] | None = None) -> dict[str, list[dict[str, Any]]]:
    pages_by_set: dict[str, list[dict[str, Any]]] = {}
    selected = image_sets or set(IMAGE_SETS)
    for image_set in IMAGE_SETS:
        if image_set not in selected:
            continue
        folder = work_root / "ocr" / image_set
        pages = [json_load(path, {}) for path in sorted(folder.glob("page_*.json"), key=page_number)]
        pages_by_set[image_set] = [page for page in pages if page]
    return pages_by_set


def parse_image_sets(raw_value: str) -> set[str] | None:
    value = str(raw_value or "").strip()
    if not value:
        return None
    aliases = {
        "current": {
            "zhongjiao_questions",
            "zhongjiao_answers",
            "waijiao_questions",
            "waijiao_answers",
        },
        "all": set(IMAGE_SETS),
    }
    if value in aliases:
        return aliases[value]
    selected = {item.strip() for item in value.split(",") if item.strip()}
    unknown = selected - set(IMAGE_SETS)
    if unknown:
        raise ValueError(f"unknown image sets: {sorted(unknown)}")
    return selected


def detect_type_label(line: str) -> str | None:
    compact = normalize_text(line)
    for label, qtype in QUESTION_TYPE_LABELS.items():
        if label in compact:
            return qtype
    return None


def detect_chapter_or_section(line: str) -> str | None:
    compact = normalize_text(line)
    if re.search(r"第[一二三四五六七八九十0-9]+章", compact):
        return line.strip()
    if re.search(r"第[一二三四五六七八九十0-9]+节", compact):
        return line.strip()
    return None


@dataclass
class ParsedQuestion:
    subject: str
    image_set: str
    page: int
    number: int
    question_type: str
    stem: str
    options: list[dict[str, str]]
    raw_lines: list[str]
    section_context: list[str]

    def as_dict(self) -> dict[str, Any]:
        return {
            "subject": self.subject,
            "image_set": self.image_set,
            "page": self.page,
            "number": self.number,
            "question_type": self.question_type,
            "stem": self.stem,
            "options": self.options,
            "raw_lines": self.raw_lines,
            "section_context": self.section_context,
        }


def finalize_question(
    *,
    subject: str,
    image_set: str,
    page: int,
    number: int,
    current_type: str,
    raw_lines: list[str],
    section_context: list[str],
) -> ParsedQuestion | None:
    if not raw_lines:
        return None
    first = raw_lines[0]
    first = QUESTION_START_RE.sub(r"\2", first, count=1).strip()
    stem_parts = [first] if first else []
    options: list[dict[str, str]] = []
    current_option: dict[str, str] | None = None
    for line in raw_lines[1:]:
        match = OPTION_RE.match(line)
        if match:
            current_option = {"id": match.group(1).upper(), "text": match.group(2).strip()}
            options.append(current_option)
            continue
        if current_option is not None and len(options) < 4 and not QUESTION_START_RE.match(line):
            current_option["text"] = (current_option["text"] + " " + line.strip()).strip()
            continue
        stem_parts.append(line.strip())
        current_option = None
    detected_type = current_type
    if len({item["id"] for item in options}) >= 3:
        detected_type = "multiple_choice"
    elif current_type == "multiple_choice" and len(options) < 3:
        detected_type = "short_answer"
    stem = re.sub(r"\s+", " ", " ".join(stem_parts)).strip()
    if not stem:
        return None
    if detected_type == "short_answer":
        options = []
    return ParsedQuestion(
        subject=subject,
        image_set=image_set,
        page=page,
        number=number,
        question_type=detected_type,
        stem=stem,
        options=options,
        raw_lines=raw_lines,
        section_context=section_context[-4:],
    )


def parse_question_pages(pages_by_set: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    parsed: list[dict[str, Any]] = []
    for image_set, meta in IMAGE_SETS.items():
        if meta["role"] != "question":
            continue
        subject = str(meta["subject"])
        current_type = "multiple_choice"
        section_context: list[str] = []
        current_number: int | None = None
        current_lines: list[str] = []
        current_page = 0
        for page in pages_by_set.get(image_set, []):
            current_page = int(page.get("page") or 0)
            for line_obj in page.get("lines") or []:
                line = str(line_obj.get("text") or "").strip()
                if not line or is_noise(line):
                    continue
                label_type = detect_type_label(line)
                if label_type:
                    if current_number is not None:
                        q = finalize_question(
                            subject=subject,
                            image_set=image_set,
                            page=current_page,
                            number=current_number,
                            current_type=current_type,
                            raw_lines=current_lines,
                            section_context=section_context,
                        )
                        if q:
                            parsed.append(q.as_dict())
                    current_number = None
                    current_lines = []
                    current_type = label_type
                    continue
                section = detect_chapter_or_section(line)
                if section and len(line) < 40:
                    section_context.append(section)
                    continue
                match = QUESTION_START_RE.match(line)
                if match:
                    if current_number is not None:
                        q = finalize_question(
                            subject=subject,
                            image_set=image_set,
                            page=current_page,
                            number=current_number,
                            current_type=current_type,
                            raw_lines=current_lines,
                            section_context=section_context,
                        )
                        if q:
                            parsed.append(q.as_dict())
                    current_number = int(match.group(1))
                    current_lines = [line]
                    continue
                if current_number is not None:
                    current_lines.append(line)
        if current_number is not None:
            q = finalize_question(
                subject=subject,
                image_set=image_set,
                page=current_page,
                number=current_number,
                current_type=current_type,
                raw_lines=current_lines,
                section_context=section_context,
            )
            if q:
                parsed.append(q.as_dict())
    return parsed


def parse_answers(pages_by_set: dict[str, list[dict[str, Any]]]) -> dict[str, list[dict[str, Any]]]:
    answers_by_subject: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for image_set, meta in IMAGE_SETS.items():
        if meta["role"] != "answer":
            continue
        subject = str(meta["subject"])
        current_type = "multiple_choice"
        section_context: list[str] = []
        current: dict[str, Any] | None = None
        for page in pages_by_set.get(image_set, []):
            page_no = int(page.get("page") or 0)
            for line_obj in page.get("lines") or []:
                line = str(line_obj.get("text") or "").strip()
                if not line or is_noise(line):
                    continue
                label_type = detect_type_label(line)
                if label_type:
                    current_type = label_type
                    continue
                section = detect_chapter_or_section(line)
                if section and len(line) < 40:
                    section_context.append(section)
                    continue
                match = ANSWER_START_RE.match(line)
                if match:
                    if current is not None:
                        answers_by_subject[subject].append(current)
                    current = {
                        "subject": subject,
                        "image_set": image_set,
                        "page": page_no,
                        "number": int(match.group(1)),
                        "question_type": current_type,
                        "answer": match.group(2).upper().strip(),
                        "analysis_lines": [match.group(3).strip()] if match.group(3).strip() else [],
                        "section_context": section_context[-4:],
                    }
                    if not current["answer"] and current["analysis_lines"]:
                        inline = ANSWER_INLINE_RE.search(current["analysis_lines"][0])
                        if inline:
                            current["answer"] = inline.group(1).upper()
                    continue
                if current is not None:
                    current["analysis_lines"].append(line)
        if current is not None:
            answers_by_subject[subject].append(current)
    for subject, items in answers_by_subject.items():
        for item in items:
            item["analysis"] = re.sub(r"\s+", " ", " ".join(item.pop("analysis_lines", []))).strip()
    return dict(answers_by_subject)


def load_palace_scope(db_path: Path) -> dict[str, Any]:
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    try:
        palaces = [dict(row) for row in con.execute("select id,title,primary_chapter_id,archived from palaces where archived=0 order by id")]
        chapters = {int(row["id"]): dict(row) for row in con.execute("select id,subject_id,parent_id,name,sort_order from chapters")}
        bindings: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for row in con.execute(
            """
            select cp.palace_id, cp.chapter_id, cp.is_explicit, c.name chapter_name
            from chapter_palaces cp join chapters c on c.id=cp.chapter_id
            order by cp.palace_id, cp.is_explicit desc, c.sort_order, c.id
            """
        ):
            bindings[int(row["palace_id"])].append(dict(row))
        return {"palaces": palaces, "chapters": chapters, "bindings": dict(bindings)}
    finally:
        con.close()


def infer_subject_for_palace(title: str, chapter_id: int | None, chapters: dict[int, dict[str, Any]]) -> str:
    if chapter_id is not None and chapter_id in chapters:
        subject_id = chapters[chapter_id].get("subject_id")
        if subject_id == 4:
            return "zhongjiao"
        if subject_id == 5:
            return "waijiao"
    for subject, pattern in PALACE_SUBJECT_RULES:
        if pattern.search(title):
            return subject
    return "unknown"


def score_question_for_palace(question: dict[str, Any], palace: dict[str, Any], chapter_name: str) -> int:
    title = compact_for_match(palace.get("title"))
    chapter = compact_for_match(chapter_name)
    context = compact_for_match(" ".join(question.get("section_context") or []))
    stem = compact_for_match(question.get("stem"))
    score = 0
    for token in re.findall(r"[\u4e00-\u9fffA-Za-z0-9]{2,}", title):
        if len(token) >= 2 and (token in context or token in stem):
            score += 8
    for token in re.findall(r"[\u4e00-\u9fffA-Za-z0-9]{2,}", chapter):
        if len(token) >= 2 and (token in context or token in stem):
            score += 10
    if chapter and chapter in context:
        score += 30
    if title and title in context:
        score += 25
    return score


def pair_answer(question: dict[str, Any], answers: list[dict[str, Any]]) -> dict[str, Any] | None:
    same_number = [item for item in answers if int(item.get("number") or -1) == int(question.get("number") or -2)]
    if not same_number:
        return None
    q_context = compact_for_match(" ".join(question.get("section_context") or []))
    scored = []
    for item in same_number:
        a_context = compact_for_match(" ".join(item.get("section_context") or []))
        score = 0
        if q_context and a_context and (q_context in a_context or a_context in q_context):
            score += 20
        if item.get("answer"):
            score += 5
        score -= abs(int(item.get("page") or 0) - int(question.get("page") or 0))
        scored.append((score, item))
    scored.sort(key=lambda item: item[0], reverse=True)
    return scored[0][1] if scored else None


def dedup_key(question: dict[str, Any]) -> str:
    options = question.get("options") or []
    option_text = "|".join(f"{item.get('id')}:{compact_for_match(item.get('text'))}" for item in options)
    stem = compact_for_match(YEAR_TAG_RE.sub("", str(question.get("stem") or "")))
    return f"{question.get('source_chapter_id')}|{question.get('question_type')}|{stem}|{option_text}"


def build_candidates(scope: dict[str, Any], questions: list[dict[str, Any]], answers_by_subject: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    chapters = scope["chapters"]
    candidates_by_palace: dict[str, list[dict[str, Any]]] = defaultdict(list)
    low_confidence: list[dict[str, Any]] = []
    for palace in scope["palaces"]:
        palace_id = int(palace["id"])
        primary = palace.get("primary_chapter_id")
        chapter_id = int(primary) if primary is not None else None
        bound = scope["bindings"].get(palace_id, [])
        if chapter_id is None:
            explicit_children = [item for item in bound if int(item.get("is_explicit") or 0) == 1 and chapters.get(int(item["chapter_id"]), {}).get("parent_id") is not None]
            if explicit_children:
                chapter_id = int(explicit_children[0]["chapter_id"])
        if chapter_id is None:
            low_confidence.append({"palace_id": palace_id, "reason": "missing_chapter_binding", "title": palace["title"]})
            continue
        chapter_name = str(chapters.get(chapter_id, {}).get("name") or "")
        subject = infer_subject_for_palace(str(palace["title"]), chapter_id, chapters)
        subject_questions = [q for q in questions if q.get("subject") == subject]
        scored = [(score_question_for_palace(q, palace, chapter_name), q) for q in subject_questions]
        selected = [q for score, q in scored if score >= 10]
        if not selected:
            # Fallback to context title matching is intentionally conservative: no
            # fabricated questions if the OCR context does not show the palace scope.
            low_confidence.append({"palace_id": palace_id, "reason": "no_questions_matched_scope", "title": palace["title"], "subject": subject})
            continue
        seen: dict[str, dict[str, Any]] = {}
        for q in selected:
            answer = pair_answer(q, answers_by_subject.get(subject, []))
            record = {
                **q,
                "palace_id": palace_id,
                "source_chapter_id": chapter_id,
                "classified_chapter_id": None,
                "palace_title": palace["title"],
                "chapter_name": chapter_name,
                "paired_answer": answer,
            }
            if q["question_type"] == "multiple_choice":
                if len(q.get("options") or []) < 4:
                    record["reject_reason"] = "multiple_choice_missing_options"
                    low_confidence.append(record)
                    continue
                if not answer or not answer.get("answer"):
                    record["reject_reason"] = "missing_choice_answer"
                    low_confidence.append(record)
                    continue
                record["answer_payload"] = {"correct_option_id": str(answer["answer"])[0].upper()}
                record["analysis"] = answer.get("analysis") or ""
            else:
                if not answer or not (answer.get("analysis") or answer.get("answer")):
                    record["reject_reason"] = "missing_short_answer"
                    low_confidence.append(record)
                    continue
                record["answer_payload"] = {"reference_answer": answer.get("analysis") or answer.get("answer")}
                record["analysis"] = answer.get("analysis") or ""
                record["options"] = []
            key = dedup_key(record)
            existing = seen.get(key)
            if existing is None or (YEAR_TAG_RE.search(str(record.get("stem"))) and not YEAR_TAG_RE.search(str(existing.get("stem")))):
                seen[key] = record
        candidates_by_palace[str(palace_id)] = list(seen.values())
    return {"candidates_by_palace": dict(candidates_by_palace), "low_confidence": low_confidence}


def to_import_payload(record: dict[str, Any]) -> dict[str, Any]:
    answer = record.get("paired_answer") or {}
    source_meta = {
        "source_kind": "1000_quiz_local_repair",
        "repair_batch": REPAIR_BATCH,
        "question_image_set": record.get("image_set"),
        "question_page": record.get("page"),
        "question_number": record.get("number"),
        "answer_image_set": answer.get("image_set"),
        "answer_page": answer.get("page"),
        "answer_number": answer.get("number"),
        "ocr_confidence": None,
        "pairing_confidence": "rule_number_context",
    }
    payload = {
        "question_type": record["question_type"],
        "stem": record["stem"],
        "options": record.get("options") or [],
        "answer_payload": record["answer_payload"],
        "analysis": record.get("analysis") or "",
        "source_meta": source_meta,
        "source_chapter_id": record["source_chapter_id"],
        "classified_chapter_id": record.get("classified_chapter_id"),
    }
    if record["question_type"] == "short_answer":
        payload["reference_answer"] = payload["answer_payload"].get("reference_answer")
    else:
        payload["correct_option_id"] = payload["answer_payload"].get("correct_option_id")
    return payload


def validate_payloads(candidates_by_palace: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    problems = []
    summary = {}
    for palace_id, records in candidates_by_palace.items():
        type_counts = Counter(record["question_type"] for record in records)
        summary[palace_id] = {"total": len(records), "types": dict(type_counts)}
        for record in records:
            if record["question_type"] == "multiple_choice":
                option_ids = {item.get("id") for item in record.get("options") or []}
                answer = (record.get("answer_payload") or {}).get("correct_option_id")
                if answer not in option_ids:
                    problems.append({"palace_id": palace_id, "reason": "answer_not_in_options", "stem": record.get("stem"), "answer": answer})
                if re.search(r"\bA[.．、]\s*.+\bB[.．、]\s*", str(record.get("stem"))):
                    problems.append({"palace_id": palace_id, "reason": "stem_contains_options", "stem": record.get("stem")})
            if record["question_type"] == "short_answer" and record.get("options"):
                problems.append({"palace_id": palace_id, "reason": "short_answer_has_options", "stem": record.get("stem")})
    return {"summary": summary, "problems": problems}


def copy_db_for_audit(db_path: Path, work_root: Path) -> Path:
    target = work_root / "audit-db" / "memory_palace.db"
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(db_path, target)
    return target


def create_live_backup(db_path: Path, work_root: Path) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = work_root / "backups" / f"{timestamp}-before-live-write-memory_palace.db"
    backup.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(db_path, backup)
    return backup


def import_into_db(db_path: Path, candidates_by_palace: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    import os

    os.environ["MEMORY_ANKI_HOME"] = str(db_path.parent.parent)

    from memory_anki.infrastructure.db.models import get_session
    from memory_anki.modules.palace_quiz.application.question_creation_commands import batch_create_chapter_questions

    result = []
    with get_session() as session:
        chapter_payloads: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for records in candidates_by_palace.values():
            for record in records:
                chapter_payloads[int(record["source_chapter_id"])].append(to_import_payload(record))
        for chapter_id, payloads in sorted(chapter_payloads.items()):
            saved = batch_create_chapter_questions(session, chapter_id, payloads, save_mode="overwrite")
            result.append({"chapter_id": chapter_id, "input_count": len(payloads), "saved_count": len(saved)})
    return {"chapters": result}


def run_audit(db_path: Path) -> dict[str, Any]:
    import importlib.util

    audit_path = REPO_ROOT / "tools" / "audit_1000_quiz_bank.py"
    spec = importlib.util.spec_from_file_location("audit_1000_quiz_bank", audit_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load audit script")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.audit_database(db_path)


def main() -> int:
    parser = argparse.ArgumentParser(description="Locally repair 1000-question quiz bank without site Qwen models.")
    parser.add_argument("--source-root", default=str(DEFAULT_SOURCE_ROOT))
    parser.add_argument("--db", default=str(DEFAULT_DB))
    parser.add_argument("--work-root", default=str(DEFAULT_WORK_ROOT))
    parser.add_argument("--force-ocr", action="store_true")
    parser.add_argument("--skip-ocr", action="store_true")
    parser.add_argument("--image-sets", default="current")
    parser.add_argument("--limit-pages", type=int, default=0)
    parser.add_argument("--import-audit-db", action="store_true")
    parser.add_argument("--write-live-db", action="store_true")
    args = parser.parse_args()

    source_root = Path(args.source_root)
    db_path = Path(args.db)
    work_root = Path(args.work_root)
    work_root.mkdir(parents=True, exist_ok=True)

    image_sets = parse_image_sets(args.image_sets)
    if args.skip_ocr:
        pages_by_set = load_cached_ocr(work_root, image_sets)
    else:
        # Temporarily narrow IMAGE_SETS by filtering the result after OCR; OCR itself
        # still uses the global order for stable cache paths.
        original_sets = dict(IMAGE_SETS)
        try:
            if image_sets is not None:
                for key in list(IMAGE_SETS):
                    if key not in image_sets:
                        del IMAGE_SETS[key]
            pages_by_set = ocr_all(source_root, work_root, force=bool(args.force_ocr), limit_pages=max(0, args.limit_pages))
        finally:
            IMAGE_SETS.clear()
            IMAGE_SETS.update(original_sets)
    questions = parse_question_pages(pages_by_set)
    answers_by_subject = parse_answers(pages_by_set)
    scope = load_palace_scope(db_path)
    candidate_result = build_candidates(scope, questions, answers_by_subject)
    validation = validate_payloads(candidate_result["candidates_by_palace"])

    json_dump(work_root / "parsed_questions.json", questions)
    json_dump(work_root / "parsed_answers.json", answers_by_subject)
    json_dump(work_root / "candidate_questions.json", candidate_result)
    json_dump(work_root / "candidate_validation.json", validation)

    audit_db_path = copy_db_for_audit(db_path, work_root)
    import_result = None
    post_audit = None
    if args.import_audit_db or args.write_live_db:
        import_result = import_into_db(audit_db_path, candidate_result["candidates_by_palace"])
        post_audit = run_audit(audit_db_path)
        json_dump(work_root / "audit_db_import_result.json", import_result)
        json_dump(work_root / "audit_db_post_audit.json", post_audit)

    live_backup = None
    live_import = None
    live_audit = None
    if args.write_live_db:
        live_backup = create_live_backup(db_path, work_root)
        live_import = import_into_db(db_path, candidate_result["candidates_by_palace"])
        live_audit = run_audit(db_path)
        json_dump(work_root / "live_import_result.json", live_import)
        json_dump(work_root / "live_post_audit.json", live_audit)

    report = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "repair_batch": REPAIR_BATCH,
        "db": str(db_path),
        "work_root": str(work_root),
        "parsed_question_count": len(questions),
        "parsed_answer_count": sum(len(items) for items in answers_by_subject.values()),
        "candidate_summary": validation["summary"],
        "candidate_problem_count": len(validation["problems"]),
        "low_confidence_count": len(candidate_result["low_confidence"]),
        "audit_db": str(audit_db_path),
        "audit_db_import_result": import_result,
        "audit_db_post_audit_counts": post_audit.get("counts") if isinstance(post_audit, dict) else None,
        "live_backup": str(live_backup) if live_backup else None,
        "live_import_result": live_import,
        "live_post_audit_counts": live_audit.get("counts") if isinstance(live_audit, dict) else None,
    }
    json_dump(work_root / "repair_report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if not validation["problems"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
