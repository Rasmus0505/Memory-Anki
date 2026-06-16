"""PDF source normalization and source-context message builders."""

from __future__ import annotations

from typing import Any


def _normalize_role_hint(raw_value: Any) -> str:
    normalized = str(raw_value or "").strip().lower()
    if normalized in {"question", "questions", "题目", "题目册", "练习", "习题"}:
        return "question"
    if normalized in {"answer", "answers", "答案", "答案册", "解析", "答案解析"}:
        return "answer"
    return ""


def normalize_pdf_sources_input(
    raw_pdf_sources: Any,
    *,
    legacy_subject_document_id: int | None = None,
    legacy_page_selection: list[int] | None = None,
) -> list[dict[str, Any]]:
    normalized_sources: list[dict[str, Any]] = []
    if isinstance(raw_pdf_sources, list):
        for item in raw_pdf_sources:
            if not isinstance(item, dict):
                continue
            try:
                subject_document_id = int(item.get("subject_document_id") or 0)
            except (TypeError, ValueError):
                continue
            page_selection_raw = item.get("page_selection")
            if not isinstance(page_selection_raw, list):
                page_selection_raw = []
            normalized_pages = sorted({int(page) for page in page_selection_raw if int(page) > 0})
            if subject_document_id <= 0 or len(normalized_pages) == 0:
                continue
            normalized_sources.append(
                {
                    "subject_document_id": subject_document_id,
                    "page_selection": normalized_pages,
                    "role_hint": _normalize_role_hint(item.get("role_hint")),
                }
            )
    if normalized_sources:
        return normalized_sources
    normalized_legacy_pages = sorted(
        {int(page) for page in (legacy_page_selection or []) if int(page) > 0}
    )
    if legacy_subject_document_id and normalized_legacy_pages:
        return [
            {
                "subject_document_id": int(legacy_subject_document_id),
                "page_selection": normalized_legacy_pages,
                "role_hint": "",
            }
        ]
    return []


def build_pdf_source_context(pdf_sources: list[dict[str, Any]]) -> str:
    role_labels = {
        "question": "题目来源",
        "answer": "答案与解析来源",
    }
    lines = [
        "下面会按顺序提供多份 PDF 页面，请按用户标注的角色综合整合。",
        "角色为“题目来源”的 PDF 优先抽取题干和选项；角色为“答案与解析来源”的 PDF 同时提供答案和解析。",
        "如果不同 PDF 分别是题目册和答案册，请优先把对应答案与解析对齐到同一题里。",
        "如果无法完全一一对应，也要尽量根据题号、顺序、关键词和知识点做最合理匹配。",
        "保留题目来源里的原始选项文字和 A/B/C/D 顺序，不要重排或改写选项。",
        "所选页如有现成选择题，尽量抽取全部符合用户范围的题，不要自行精选少量题。",
        "不要因为来源分散就重复出题；同一题只保留一份整合后的结果。",
        "资料来源清单：",
    ]
    for index, item in enumerate(pdf_sources, start=1):
        role_hint = role_labels.get(str(item.get("role_hint") or "").strip(), "未指定")
        document_name = str(item.get("document_name") or "").strip() or f"PDF {index}"
        page_numbers = item.get("page_numbers") or []
        page_text = ",".join(str(page) for page in page_numbers) if page_numbers else "未提供页码"
        lines.append(
            f"{index}. {document_name}；页码：{page_text}；用户提示角色：{role_hint}"
        )
    return "\n".join(lines)


__all__ = [
    "build_pdf_source_context",
    "normalize_pdf_sources_input",
]
