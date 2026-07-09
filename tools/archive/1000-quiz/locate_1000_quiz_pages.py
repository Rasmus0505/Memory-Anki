from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import re
import sqlite3
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
API_SRC = REPO_ROOT / "apps" / "api" / "src"
if str(API_SRC) not in sys.path:
    sys.path.insert(0, str(API_SRC))

DEFAULT_SOURCE_ROOT = Path(r"D:\考研（丹丹）\1000题")
DEFAULT_DB = REPO_ROOT / ".audit" / "1000-quiz" / "snapshot" / "data" / "memory_palace.db"
DEFAULT_PLAN = REPO_ROOT / ".audit" / "1000-quiz" / "rerun_plan.json"
DEFAULT_OUT = REPO_ROOT / ".audit" / "1000-quiz" / "page_location_candidates.json"
DEFAULT_INDEX = REPO_ROOT / ".audit" / "1000-quiz" / "page_index.json"
DEFAULT_LOCATED_PLAN = REPO_ROOT / ".audit" / "1000-quiz" / "rerun_plan_with_located_pages.json"

LOW_COST_VISION_MODEL = "qwen3-vl-flash"
LOW_COST_TEXT_MODEL = "qwen3.6-flash"

DOC_TO_IMAGE_SET = {
    2: ("waijiao_answers", "answer", "外教解析.pdf", "spread", -1),
    3: ("waijiao_questions", "question", "丹丹外教习题册.pdf", "spread", -1),
    4: ("zhongjiao_questions", "question", "丹丹中教习题册.pdf", "spread", -1),
    5: ("zhongjiao_answers", "answer", "中教解析.pdf", "spread", -1),
}


def _read_json(path: Path) -> dict[str, Any]:
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _compact_text(value: Any) -> str:
    text = str(value or "")
    text = re.sub(r"【\s*\d{4}\s*年?\s*311\s*真题\s*\d+\s*】", "", text)
    text = re.sub(r"^\s*\d+\s*[.、．]\s*", "", text)
    text = re.sub(r"\s*/\s*\d+\s*$", "", text)
    text = re.sub(r"\s+", "", text)
    return text


def _normalize_text(value: Any) -> str:
    return _compact_text(value)[:80]


def _image_content_part(path: Path) -> dict[str, Any]:
    mime_type = mimetypes.guess_type(str(path))[0] or "image/jpeg"
    data = base64.b64encode(path.read_bytes()).decode("utf-8")
    return {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{data}"}}


def _extract_json_object(text: str) -> dict[str, Any]:
    raw = str(text or "").strip()
    if raw.startswith("```"):
        lines = raw.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        raw = "\n".join(lines).strip()
    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end != -1 and end > start:
        raw = raw[start : end + 1]
    parsed = json.loads(raw)
    return parsed if isinstance(parsed, dict) else {}


def _page_number(path: Path) -> int:
    match = re.search(r"page[_-](\d+)", path.stem)
    return int(match.group(1)) if match else 0


def _get_runtime_config(model: str):
    from memory_anki.core.config import DASHSCOPE_API_KEY, DASHSCOPE_BASE_URL
    from memory_anki.infrastructure.llm import OpenAICompatibleChatConfig

    api_key = str(os.environ.get("DASHSCOPE_API_KEY") or DASHSCOPE_API_KEY or "").strip()
    if not api_key:
        raise RuntimeError("未配置 DASHSCOPE_API_KEY，无法调用低成本视觉模型定位页码。")
    return OpenAICompatibleChatConfig(
        api_key=api_key,
        base_url=str(os.environ.get("DASHSCOPE_BASE_URL") or DASHSCOPE_BASE_URL).strip(),
        model=model,
        temperature=0.0,
        timeout_seconds=90.0,
    )


def _summarize_page(image_path: Path, *, role_hint: str) -> dict[str, Any]:
    from memory_anki.infrastructure.llm import call_chat_completion_text

    prompt = (
        "你是题库页码定位助手。只阅读这一页图片，输出 JSON，不要解释。\n"
        "任务不是完整转题，只做页面摘要以便定位章节范围。\n"
        "字段：page_title, section_titles, question_numbers, first_stem, last_stem, "
        "answer_numbers, has_reference_answer, visible_keywords。\n"
        "question_numbers/answer_numbers 只填本页看得到的题号；first_stem/last_stem 保留题干开头 40 字。\n"
        f"本页角色：{role_hint}。"
    )
    messages = [
        {"role": "system", "content": "只输出一个 JSON 对象。"},
        {"role": "user", "content": [{"type": "text", "text": prompt}, _image_content_part(image_path)]},
    ]
    response = call_chat_completion_text(
        config=_get_runtime_config(LOW_COST_VISION_MODEL),
        messages=messages,
        response_format={"type": "json_object"},
        extra_payload={"enable_thinking": False},
    )
    parsed = _extract_json_object(response)
    return {
        "page": _page_number(image_path),
        "image_path": str(image_path),
        "role_hint": role_hint,
        "page_title": str(parsed.get("page_title") or ""),
        "section_titles": parsed.get("section_titles") if isinstance(parsed.get("section_titles"), list) else [],
        "question_numbers": parsed.get("question_numbers") if isinstance(parsed.get("question_numbers"), list) else [],
        "answer_numbers": parsed.get("answer_numbers") if isinstance(parsed.get("answer_numbers"), list) else [],
        "first_stem": str(parsed.get("first_stem") or ""),
        "last_stem": str(parsed.get("last_stem") or ""),
        "has_reference_answer": bool(parsed.get("has_reference_answer")),
        "visible_keywords": parsed.get("visible_keywords") if isinstance(parsed.get("visible_keywords"), list) else [],
    }


def build_page_index(source_root: Path, index_path: Path, *, limit_pages: int = 0, force: bool = False) -> dict[str, Any]:
    existing = _read_json(index_path)
    pages_by_set = existing.get("pages_by_set") if not force else None
    if not isinstance(pages_by_set, dict):
        pages_by_set = {}

    for _, (image_set, role_hint, document_name, _mapping_kind, _pdf_page_offset) in DOC_TO_IMAGE_SET.items():
        image_dir = source_root / "images" / image_set
        paths = sorted(image_dir.glob("page_*.*"), key=_page_number)
        if limit_pages:
            paths = paths[:limit_pages]
        indexed = {
            int(item.get("page") or 0): item
            for item in pages_by_set.get(image_set, [])
            if isinstance(item, dict)
        }
        for path in paths:
            page = _page_number(path)
            if page in indexed:
                continue
            print(f"index {image_set} page {page}", flush=True)
            indexed[page] = {
                **_summarize_page(path, role_hint=role_hint),
                "image_set": image_set,
                "document_name": document_name,
            }
            pages_by_set[image_set] = [indexed[key] for key in sorted(indexed)]
            _write_json(index_path, {"pages_by_set": pages_by_set})

    return {"pages_by_set": pages_by_set}


def _load_old_stems(db_path: Path, palace_id: int, selected_chapter_id: int | None) -> list[str]:
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute(
            """
            select stem from palace_quiz_questions
            where palace_id = ? or (? is not null and source_chapter_id = ?)
            order by id
            limit 12
            """,
            (palace_id, selected_chapter_id, selected_chapter_id),
        ).fetchall()
        return [_normalize_text(row["stem"]) for row in rows if _normalize_text(row["stem"])]
    finally:
        con.close()


def _score_page(page: dict[str, Any], task: dict[str, Any], old_stems: list[str]) -> int:
    haystack = _compact_text(
        " ".join(
            [
                page.get("page_title"),
                " ".join(map(str, page.get("section_titles") or [])),
                page.get("first_stem"),
                page.get("last_stem"),
                " ".join(map(str, page.get("visible_keywords") or [])),
            ]
        )
    )
    score = 0
    title = _compact_text(task.get("palace_title"))
    raw_title = str(task.get("palace_title") or "")
    compact_title = _compact_text(raw_title)
    for token in re.split(r"[一二三四五六七八九十节第/（）()、\s]+", raw_title):
        token = _compact_text(token)
        if len(token) >= 3 and token in haystack:
            score += 8
    for token in re.findall(r"[\u4e00-\u9fffA-Za-z0-9]{2,}", compact_title):
        if len(token) >= 2 and token in haystack:
            score += 6
    if title and title in haystack:
        score += 20
    for stem in old_stems:
        if len(stem) >= 8 and (stem[:16] in haystack or haystack[:16] in stem):
            score += 30
        elif len(stem) >= 12 and stem[:8] in haystack:
            score += 12
    return score


def locate_tasks(
    db_path: Path,
    plan_path: Path,
    index: dict[str, Any],
    out_path: Path,
    *,
    page_window: str,
) -> dict[str, Any]:
    plan = _read_json(plan_path)
    tasks = [task for task in plan.get("tasks") or [] if task.get("status") == "needs_page_location"]
    pages_by_set = index.get("pages_by_set") or {}
    results = []
    for task in tasks:
        palace_id = int(task.get("palace_id") or 0)
        selected_chapter_id = task.get("selected_chapter_id")
        selected_chapter_id = int(selected_chapter_id) if selected_chapter_id else None
        subject = "zhongjiao" if palace_id <= 15 else "waijiao"
        old_stems = _load_old_stems(db_path, palace_id, selected_chapter_id)
        candidate_sources = []
        for image_set, role_hint, document_id in [
            (f"{subject}_questions", "question", 4 if subject == "zhongjiao" else 3),
            (f"{subject}_answers", "answer", 5 if subject == "zhongjiao" else 2),
        ]:
            scored = []
            for page in pages_by_set.get(image_set, []):
                if not isinstance(page, dict):
                    continue
                score = _score_page(page, task, old_stems)
                if score > 0:
                    scored.append({"score": score, **page})
            scored.sort(key=lambda item: (-int(item["score"]), int(item.get("page") or 0)))
            top = scored[:6]
            mapping_kind = str(DOC_TO_IMAGE_SET[document_id][3])
            pdf_offset = int(DOC_TO_IMAGE_SET[document_id][4])
            source_page_window = "next" if role_hint == "answer" else page_window
            image_pages = _expand_pages(
                [int(item["page"]) for item in top[:2]],
                page_window=source_page_window,
            )
            pdf_pages = _image_pages_to_pdf_pages(
                image_pages,
                mapping_kind=mapping_kind,
                pdf_offset=pdf_offset,
            )
            candidate_sources.append(
                {
                    "subject_document_id": document_id,
                    "document_name": DOC_TO_IMAGE_SET[document_id][2],
                    "role_hint": role_hint,
                    "top_pages": top,
                    "image_to_pdf_mapping": mapping_kind,
                    "image_page_offset_to_pdf": pdf_offset,
                    "suggested_image_page_selection": image_pages,
                    "suggested_page_selection": pdf_pages,
                }
            )
        _fill_missing_pages_from_counterpart(candidate_sources)
        results.append(
            {
                "palace_id": palace_id,
                "palace_title": task.get("palace_title"),
                "selected_chapter_id": selected_chapter_id,
                "old_stem_samples": old_stems[:6],
                "candidate_sources": candidate_sources,
            }
        )
    payload = {"tasks": results}
    _write_json(out_path, payload)
    return payload


def _fill_missing_pages_from_counterpart(candidate_sources: list[dict[str, Any]]) -> None:
    with_pages = [
        source
        for source in candidate_sources
        if source.get("suggested_image_page_selection")
        and source.get("suggested_page_selection")
    ]
    if len(with_pages) != 1:
        return
    counterpart = with_pages[0]
    image_pages = [
        int(page)
        for page in (counterpart.get("suggested_image_page_selection") or [])
        if int(page) > 0
    ]
    if not image_pages:
        return
    for source in candidate_sources:
        if source.get("suggested_page_selection"):
            continue
        document_id = int(source.get("subject_document_id") or 0)
        if document_id <= 0:
            continue
        mapping_kind = str(DOC_TO_IMAGE_SET[document_id][3])
        pdf_offset = int(DOC_TO_IMAGE_SET[document_id][4])
        source["suggested_image_page_selection"] = sorted(set(image_pages))
        source["suggested_page_selection"] = _image_pages_to_pdf_pages(
            sorted(set(image_pages)),
            mapping_kind=mapping_kind,
            pdf_offset=pdf_offset,
        )
        source["fallback_basis"] = (
            "No direct image-index match; reused the counterpart source image page numbers "
            "for the same subject and marked for preview QA."
        )


def _expand_pages(pages: list[int], *, page_window: str) -> list[int]:
    expanded: set[int] = set()
    for page in pages:
        deltas = (0,) if page_window == "none" else (0, 1)
        for delta in deltas:
            if page + delta > 0:
                expanded.add(page + delta)
    return sorted(expanded)


def _image_pages_to_pdf_pages(
    image_pages: list[int],
    *,
    mapping_kind: str,
    pdf_offset: int,
) -> list[int]:
    mapped: set[int] = set()
    for page in image_pages:
        if mapping_kind == "spread":
            left = page * 2 + pdf_offset
            for pdf_page in (left, left + 1):
                if pdf_page > 0:
                    mapped.add(pdf_page)
            continue
        pdf_page = page + pdf_offset
        if pdf_page > 0:
            mapped.add(pdf_page)
    return sorted(mapped)


def build_located_plan(
    *,
    plan_path: Path,
    location_candidates_path: Path,
    out_path: Path,
) -> dict[str, Any]:
    plan = _read_json(plan_path)
    location_candidates = _read_json(location_candidates_path)
    located_by_id = {
        int(task["palace_id"]): task
        for task in location_candidates.get("tasks") or []
        if isinstance(task, dict) and task.get("palace_id") is not None
    }
    tasks = []
    for raw_task in plan.get("tasks") or []:
        task = dict(raw_task)
        palace_id = int(task.get("palace_id") or 0)
        located = located_by_id.get(palace_id)
        if task.get("status") == "needs_page_location" and located:
            sources = []
            ok = True
            for source in located.get("candidate_sources") or []:
                pages = source.get("suggested_page_selection") or []
                if not pages:
                    ok = False
                    break
                sources.append(
                    {
                        "subject_document_id": source["subject_document_id"],
                        "document_name": source["document_name"],
                        "role_hint": source["role_hint"],
                        "page_selection": pages,
                        "page_location_basis": {
                            "image_to_pdf_mapping": source.get("image_to_pdf_mapping"),
                            "image_page_offset_to_pdf": source.get("image_page_offset_to_pdf"),
                            "fallback_basis": source.get("fallback_basis"),
                            "suggested_image_page_selection": source.get(
                                "suggested_image_page_selection"
                            ),
                            "top_image_pages": [
                                {
                                    "page": item.get("page"),
                                    "score": item.get("score"),
                                    "page_title": item.get("page_title"),
                                }
                                for item in (source.get("top_pages") or [])[:3]
                                if isinstance(item, dict)
                            ],
                        },
                    }
                )
            if ok and len(sources) >= 2:
                task["status"] = "ready"
                task["pdf_sources"] = sources
                task.setdefault("notes", []).append(
                    "PDF pages suggested by tools/locate_1000_quiz_pages.py; preview QA required before save."
                )
            else:
                task.setdefault("notes", []).append(
                    "Page locator did not find both question and answer pages."
                )
        tasks.append(task)

    located_plan = {
        **plan,
        "generated_from": str(location_candidates_path),
        "tasks": tasks,
        "summary": {
            "task_count": len(tasks),
            "ready_count": sum(1 for task in tasks if task.get("status") == "ready"),
            "needs_page_location_count": sum(
                1 for task in tasks if task.get("status") == "needs_page_location"
            ),
            "high_priority_count": sum(1 for task in tasks if task.get("priority") == "high"),
        },
    }
    _write_json(out_path, located_plan)
    return located_plan


def main() -> int:
    parser = argparse.ArgumentParser(description="Locate likely source pages for 1000-question reruns.")
    parser.add_argument("--source-root", default=str(DEFAULT_SOURCE_ROOT))
    parser.add_argument("--db", default=str(DEFAULT_DB))
    parser.add_argument("--plan", default=str(DEFAULT_PLAN))
    parser.add_argument("--index", default=str(DEFAULT_INDEX))
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    parser.add_argument("--located-plan-out", default=str(DEFAULT_LOCATED_PLAN))
    parser.add_argument("--limit-pages", type=int, default=0)
    parser.add_argument("--page-window", choices=["none", "next"], default="next")
    parser.add_argument("--force-index", action="store_true")
    parser.add_argument("--locate-only", action="store_true")
    args = parser.parse_args()

    index_path = Path(args.index)
    if args.locate_only:
        index = _read_json(index_path)
    else:
        index = build_page_index(
            Path(args.source_root),
            index_path,
            limit_pages=max(0, args.limit_pages),
            force=bool(args.force_index),
        )
    locate_tasks(
        Path(args.db),
        Path(args.plan),
        index,
        Path(args.out),
        page_window=str(args.page_window),
    )
    located_plan = build_located_plan(
        plan_path=Path(args.plan),
        location_candidates_path=Path(args.out),
        out_path=Path(args.located_plan_out),
    )
    print(args.out)
    print(args.located_plan_out)
    print(json.dumps(located_plan.get("summary") or {}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
