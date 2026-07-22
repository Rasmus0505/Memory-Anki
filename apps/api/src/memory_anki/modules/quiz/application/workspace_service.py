from __future__ import annotations

import hashlib
import json
import mimetypes
import shutil
import uuid
from pathlib import Path
from typing import Any

import fitz
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from memory_anki.core.runtime_paths import get_app_home
from memory_anki.infrastructure.db._tables.quiz_generation import (
    QuizGenerationJob,
    QuizGenerationSource,
    QuizPdfAsset,
)
from memory_anki.modules.quiz.application.generation.images import (
    generate_quiz_preview_from_images,
)
from memory_anki.modules.quiz.application.generation.text import (
    generate_quiz_preview_from_text_files,
)
from memory_anki.modules.quiz.application.question_contracts import (
    PalaceQuizNotFoundError,
    PalaceQuizValidationError,
)
from memory_anki.platform.application import AiRuntimeOptions

from .ai_dependencies import PalaceQuizAiDependencies

ROOT = Path("quiz_generation")
PDF_ROOT = ROOT / "pdf_library"
JOB_ROOT = ROOT / "jobs"
ROLES = {"question", "answer"}
SOURCE_TYPES = {"image", "text", "pdf", "review_mindmap"}


def parse_page_numbers(expression: str, page_count: int) -> list[int]:
    if page_count <= 0:
        raise PalaceQuizValidationError("PDF 页数无效。")
    values: set[int] = set()
    for raw_part in str(expression or "").replace("，", ",").split(","):
        part = raw_part.strip()
        if not part:
            continue
        if "-" in part:
            bits = [item.strip() for item in part.split("-")]
            if len(bits) != 2 or not all(item.isdigit() for item in bits):
                raise PalaceQuizValidationError(f"页码范围格式不正确：{part}")
            start, end = map(int, bits)
            if start > end:
                raise PalaceQuizValidationError(f"页码范围不能倒序：{part}")
            values.update(range(start, end + 1))
        elif part.isdigit():
            values.add(int(part))
        else:
            raise PalaceQuizValidationError(f"页码格式不正确：{part}")
    if not values:
        raise PalaceQuizValidationError("请指定至少一个 PDF 页码。")
    invalid = [value for value in values if value < 1 or value > page_count]
    if invalid:
        raise PalaceQuizValidationError(f"PDF 页码超出范围：{', '.join(map(str, sorted(invalid)))}")
    return sorted(values)


def _absolute(relative_path: str | Path) -> Path:
    path = (get_app_home() / Path(relative_path)).resolve()
    root = get_app_home().resolve()
    if root != path and root not in path.parents:
        raise PalaceQuizValidationError("素材路径不在应用数据目录内。")
    return path


def _asset_dict(asset: QuizPdfAsset) -> dict[str, Any]:
    return {
        "id": asset.id,
        "name": asset.name,
        "original_name": asset.original_name,
        "file_size": asset.file_size,
        "page_count": asset.page_count,
        "archived": asset.archived,
        "created_at": asset.created_at,
        "updated_at": asset.updated_at,
    }


def list_pdf_assets(session: Session, *, include_archived: bool = False) -> list[dict[str, Any]]:
    query = select(QuizPdfAsset).order_by(QuizPdfAsset.updated_at.desc(), QuizPdfAsset.id.desc())
    if not include_archived:
        query = query.where(QuizPdfAsset.archived.is_(False))
    return [_asset_dict(item) for item in session.scalars(query).all()]


def upload_pdf_asset(
    session: Session, *, content: bytes, original_name: str, name: str = ""
) -> dict[str, Any]:
    if not content or not str(original_name).lower().endswith(".pdf"):
        raise PalaceQuizValidationError("请上传 PDF 文件。")
    try:
        page_count = len(fitz.open(stream=content, filetype="pdf"))
    except Exception as exc:
        raise PalaceQuizValidationError("PDF 打开失败。") from exc
    digest = hashlib.sha256(content).hexdigest()
    relative_path = PDF_ROOT / f"{digest}.pdf"
    absolute_path = _absolute(relative_path)
    absolute_path.parent.mkdir(parents=True, exist_ok=True)
    if not absolute_path.exists():
        absolute_path.write_bytes(content)
    asset = QuizPdfAsset(
        name=str(name or Path(original_name).stem).strip() or "未命名 PDF",
        original_name=Path(original_name).name,
        relative_path=relative_path.as_posix(),
        content_hash=digest,
        file_size=len(content),
        page_count=page_count,
    )
    session.add(asset)
    session.commit()
    session.refresh(asset)
    return _asset_dict(asset)


def update_pdf_asset(
    session: Session, asset_id: int, *, name: str | None = None, archived: bool | None = None
) -> dict[str, Any]:
    asset = session.get(QuizPdfAsset, asset_id)
    if asset is None:
        raise PalaceQuizNotFoundError("PDF 资料不存在。")
    if name is not None:
        asset.name = str(name).strip() or asset.name
    if archived is not None:
        asset.archived = bool(archived)
    session.commit()
    session.refresh(asset)
    return _asset_dict(asset)


def delete_pdf_asset(session: Session, asset_id: int) -> None:
    asset = session.get(QuizPdfAsset, asset_id)
    if asset is None:
        raise PalaceQuizNotFoundError("PDF 资料不存在。")
    references = (
        session.scalar(
            select(func.count())
            .select_from(QuizGenerationSource)
            .where(QuizGenerationSource.pdf_asset_id == asset_id)
        )
        or 0
    )
    if references:
        raise PalaceQuizValidationError("该 PDF 已被生成任务引用，只能归档。")
    path = _absolute(asset.relative_path)
    same_file_count = (
        session.scalar(
            select(func.count())
            .select_from(QuizPdfAsset)
            .where(QuizPdfAsset.relative_path == asset.relative_path, QuizPdfAsset.id != asset.id)
        )
        or 0
    )
    session.delete(asset)
    session.commit()
    if same_file_count == 0:
        path.unlink(missing_ok=True)


def _source_dict(source: QuizGenerationSource) -> dict[str, Any]:
    return {
        "id": source.id,
        "role": source.role,
        "source_type": source.source_type,
        "sort_order": source.sort_order,
        "display_name": source.display_name,
        "original_name": source.original_name,
        "mime_type": source.mime_type,
        "file_size": source.file_size,
        "text_content": source.text_content,
        "pdf_asset_id": source.pdf_asset_id,
        "page_numbers": json.loads(source.page_numbers_json or "[]"),
        "config": json.loads(source.config_json or "{}"),
    }


def _job_dict(job: QuizGenerationJob) -> dict[str, Any]:
    return {
        "id": job.id,
        "palace_id": job.palace_id,
        "selected_chapter_id": job.selected_chapter_id,
        "status": job.status,
        "title": job.title,
        "extra_prompt": job.extra_prompt,
        "options": json.loads(job.options_json or "{}"),
        "matching_items": json.loads(job.matching_json or "[]"),
        "preview": json.loads(job.preview_json) if job.preview_json else None,
        "error_message": job.error_message,
        "sources": [_source_dict(item) for item in job.sources],
        "created_at": job.created_at,
        "updated_at": job.updated_at,
    }


def create_job(session: Session, *, palace_id: int, data: dict[str, Any]) -> dict[str, Any]:
    job = QuizGenerationJob(
        id=str(uuid.uuid4()),
        palace_id=palace_id,
        selected_chapter_id=data.get("selected_chapter_id"),
        title=str(data.get("title") or "未命名题库生成"),
        extra_prompt=str(data.get("extra_prompt") or ""),
        options_json=json.dumps(data.get("options") or {}, ensure_ascii=False),
    )
    session.add(job)
    session.commit()
    session.refresh(job)
    return _job_dict(job)


def get_job(session: Session, job_id: str) -> QuizGenerationJob:
    job = session.get(QuizGenerationJob, job_id)
    if job is None:
        raise PalaceQuizNotFoundError("题库生成任务不存在。")
    return job


def serialize_job(session: Session, job_id: str) -> dict[str, Any]:
    return _job_dict(get_job(session, job_id))


def update_job(session: Session, job_id: str, data: dict[str, Any]) -> dict[str, Any]:
    job = get_job(session, job_id)
    if "selected_chapter_id" in data:
        job.selected_chapter_id = data.get("selected_chapter_id")
    if "title" in data:
        job.title = str(data.get("title") or job.title)
    if "extra_prompt" in data:
        job.extra_prompt = str(data.get("extra_prompt") or "")
    if "options" in data:
        job.options_json = json.dumps(data.get("options") or {}, ensure_ascii=False)
    if "status" in data:
        job.status = str(data.get("status") or job.status)
    if "preview" in data:
        preview = data.get("preview")
        job.preview_json = json.dumps(preview, ensure_ascii=False) if preview is not None else ""
    if "error_message" in data:
        job.error_message = str(data.get("error_message") or "")
    session.commit()
    return _job_dict(job)


def list_jobs(session: Session, palace_id: int) -> list[dict[str, Any]]:
    jobs = session.scalars(
        select(QuizGenerationJob)
        .where(QuizGenerationJob.palace_id == palace_id)
        .order_by(QuizGenerationJob.updated_at.desc())
    ).all()
    return [_job_dict(job) for job in jobs]


def _next_sort(job: QuizGenerationJob) -> int:
    return max((item.sort_order for item in job.sources), default=-1) + 1


def add_text_source(session: Session, job_id: str, data: dict[str, Any]) -> dict[str, Any]:
    job = get_job(session, job_id)
    role = str(data.get("role") or "")
    source_type = str(data.get("source_type") or "text")
    if role not in ROLES or source_type not in {"text", "review_mindmap"}:
        raise PalaceQuizValidationError("来源角色或类型不正确。")
    content = str(data.get("text_content") or "").strip()
    config = data.get("config") or {}
    if not content and not config:
        raise PalaceQuizValidationError("来源内容不能为空。")
    source = QuizGenerationSource(
        job_id=job.id,
        role=role,
        source_type=source_type,
        sort_order=_next_sort(job),
        display_name=str(
            data.get("display_name")
            or ("复习脑图" if source_type == "review_mindmap" else "粘贴文本")
        ),
        text_content=content,
        config_json=json.dumps(config, ensure_ascii=False),
    )
    session.add(source)
    job.status = "draft"
    session.commit()
    session.refresh(source)
    return _source_dict(source)


def add_pdf_source(session: Session, job_id: str, data: dict[str, Any]) -> dict[str, Any]:
    job = get_job(session, job_id)
    role = str(data.get("role") or "")
    asset = session.get(QuizPdfAsset, int(data.get("pdf_asset_id") or 0))
    if role not in ROLES or asset is None:
        raise PalaceQuizValidationError("PDF 来源配置不正确。")
    pages = parse_page_numbers(str(data.get("page_expression") or ""), asset.page_count)
    source = QuizGenerationSource(
        job_id=job.id,
        role=role,
        source_type="pdf",
        sort_order=_next_sort(job),
        display_name=str(data.get("display_name") or asset.name),
        pdf_asset_id=asset.id,
        page_numbers_json=json.dumps(pages),
        config_json=json.dumps(
            {"asset_name": asset.name, "original_name": asset.original_name}, ensure_ascii=False
        ),
    )
    session.add(source)
    job.status = "draft"
    session.commit()
    session.refresh(source)
    return _source_dict(source)


def add_file_source(
    session: Session, job_id: str, *, role: str, content: bytes, original_name: str, mime_type: str
) -> dict[str, Any]:
    job = get_job(session, job_id)
    if role not in ROLES or not content:
        raise PalaceQuizValidationError("上传来源不正确。")
    suffix = Path(original_name).suffix.lower()
    source_type = (
        "image"
        if str(mime_type).startswith("image/")
        or suffix in {".png", ".jpg", ".jpeg", ".webp", ".gif"}
        else "text"
    )
    if source_type == "text" and suffix not in {".txt", ".md", ".markdown", ".json"}:
        raise PalaceQuizValidationError("仅支持图片、TXT、Markdown 或 JSON 文件。")
    source_id = uuid.uuid4().hex
    relative = (
        JOB_ROOT
        / job.id
        / "sources"
        / f"{source_id}{suffix or mimetypes.guess_extension(mime_type) or ''}"
    )
    absolute = _absolute(relative)
    absolute.parent.mkdir(parents=True, exist_ok=True)
    absolute.write_bytes(content)
    text_content = ""
    if source_type == "text":
        try:
            text_content = content.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise PalaceQuizValidationError("文本文件需要使用 UTF-8 编码。") from exc
    source = QuizGenerationSource(
        job_id=job.id,
        role=role,
        source_type=source_type,
        sort_order=_next_sort(job),
        display_name=Path(original_name).name,
        relative_path=relative.as_posix(),
        original_name=Path(original_name).name,
        mime_type=mime_type,
        file_size=len(content),
        text_content=text_content,
    )
    session.add(source)
    job.status = "draft"
    session.commit()
    session.refresh(source)
    return _source_dict(source)


def delete_source(session: Session, job_id: str, source_id: int) -> None:
    job = get_job(session, job_id)
    source = next((item for item in job.sources if item.id == source_id), None)
    if source is None:
        raise PalaceQuizNotFoundError("来源不存在。")
    path = _absolute(source.relative_path) if source.relative_path else None
    session.delete(source)
    session.flush()
    for index, item in enumerate(sorted(job.sources, key=lambda value: value.sort_order)):
        item.sort_order = index
    job.status = "draft"
    session.commit()
    if path:
        path.unlink(missing_ok=True)


def reorder_sources(session: Session, job_id: str, source_ids: list[int]) -> dict[str, Any]:
    job = get_job(session, job_id)
    current = {item.id: item for item in job.sources}
    if set(source_ids) != set(current):
        raise PalaceQuizValidationError("来源排序列表不完整。")
    for index, source_id in enumerate(source_ids):
        current[source_id].sort_order = 10000 + index
    session.flush()
    for index, source_id in enumerate(source_ids):
        current[source_id].sort_order = index
    session.commit()
    return _job_dict(job)


def _pdf_text(source: QuizGenerationSource) -> str:
    asset = source.pdf_asset
    if asset is None:
        return ""
    pages = json.loads(source.page_numbers_json or "[]")
    with fitz.open(_absolute(asset.relative_path)) as document:
        return "\n\n".join(
            f"[PDF {asset.name} 第 {number} 页]\n{document[number - 1].get_text('text')}"
            for number in pages
        )


def _source_text(source: QuizGenerationSource) -> str:
    if source.source_type == "pdf":
        return _pdf_text(source)
    if source.source_type == "review_mindmap":
        return source.text_content or json.dumps(
            json.loads(source.config_json or "{}"), ensure_ascii=False
        )
    return source.text_content


def _match_items(previews: list[dict[str, Any]], has_answer_source: bool) -> list[dict[str, Any]]:
    questions = [question for preview in previews for question in preview.get("questions", [])]
    return [
        {
            "id": str(uuid.uuid4()),
            "status": "matched" if has_answer_source else "ai_generated_answer",
            "confidence": "high" if has_answer_source else "medium",
            "ignored": False,
            "question": question,
            "question_text": str(question.get("stem") or ""),
            "answer_text": json.dumps(question.get("answer_payload") or {}, ensure_ascii=False),
            "answer_generated_by_ai": not has_answer_source,
            "classified_chapter_id": question.get("classified_chapter_id"),
            "mini_palace_id": question.get("mini_palace_id"),
        }
        for question in questions
    ]


def extract_and_match(
    session: Session,
    job_id: str,
    *,
    ai_dependencies: PalaceQuizAiDependencies,
    ai_options: AiRuntimeOptions | dict[str, Any] | None = None,
) -> dict[str, Any]:
    job = get_job(session, job_id)
    question_sources = [item for item in job.sources if item.role == "question"]
    if not question_sources:
        raise PalaceQuizValidationError("请至少添加一个题目来源。")
    job.status = "extracting"
    job.error_message = ""
    session.commit()
    try:
        options = json.loads(job.options_json or "{}")
        classify = bool(options.get("classify_by_mini_palace"))
        runtime_ai_options = ai_dependencies.runtime.normalize_options(ai_options)
        images: list[tuple[bytes, str | None]] = [
            (
                _absolute(item.relative_path).read_bytes(),
                f"{'题目' if item.role == 'question' else '答案'}_{item.original_name}",
            )
            for item in job.sources
            if item.source_type == "image"
        ]
        text_sections: list[str] = []
        text_files: list[tuple[bytes, str | None, str | None]] = []
        for source in job.sources:
            text = _source_text(source).strip()
            if text:
                label = "题目来源" if source.role == "question" else "答案来源"
                section = f"[{label}: {source.display_name}]\n{text}"
                text_sections.append(section)
                text_files.append(
                    (section.encode("utf-8"), f"{source.sort_order:03d}_{label}.txt", "text/plain")
                )
        unified_instruction = "\n\n".join(
            [
                job.extra_prompt,
                "以下材料已明确标注题目来源与答案来源。请跨来源完成题目与答案配对，不要把纯答案材料编造成新题目。",
                *text_sections,
            ]
        ).strip()
        if images:
            preview = generate_quiz_preview_from_images(
                session,
                ai_dependencies=ai_dependencies,
                palace_id=job.palace_id,
                image_items=images,
                extra_prompt=unified_instruction,
                classify_by_mini_palace=classify,
                selected_chapter_id=job.selected_chapter_id,
                ai_options=runtime_ai_options,
            )
        else:
            preview = generate_quiz_preview_from_text_files(
                session,
                ai_dependencies=ai_dependencies,
                palace_id=job.palace_id,
                file_items=text_files,
                extra_prompt=job.extra_prompt,
                classify_by_mini_palace=classify,
                selected_chapter_id=job.selected_chapter_id,
                ai_options=runtime_ai_options,
            )
        matching = _match_items([preview], any(item.role == "answer" for item in job.sources))
        if not matching:
            raise PalaceQuizValidationError("没有识别到可生成的题目。")
        job.matching_json = json.dumps(matching, ensure_ascii=False)
        job.status = "matching_review"
        session.commit()
        return _job_dict(job)
    except Exception as exc:
        job.status = "failed"
        job.error_message = str(exc)
        session.commit()
        raise


def _apply_answer_text(question: dict[str, Any], answer_text: str) -> None:
    text = str(answer_text or "").strip()
    if not text:
        return
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        parsed = None
    if isinstance(parsed, dict):
        question["answer_payload"] = parsed
        return
    payload = dict(question.get("answer_payload") or {})
    question_type = str(question.get("question_type") or "")
    if question_type == "multiple_choice":
        payload["correct_option_id"] = text
    elif question_type == "true_false":
        payload["correct_answer"] = text.lower() in {"true", "1", "对", "正确", "是"}
    else:
        payload["reference_answer"] = text
    question["answer_payload"] = payload


def update_matching(session: Session, job_id: str, items: list[dict[str, Any]]) -> dict[str, Any]:
    job = get_job(session, job_id)
    normalized = []
    for item in items:
        question = item.get("question") or {}
        question["stem"] = str(item.get("question_text") or question.get("stem") or "").strip()
        if not question["stem"]:
            raise PalaceQuizValidationError("题干不能为空。")
        _apply_answer_text(question, str(item.get("answer_text") or ""))
        normalized.append({**item, "question": question})
    job.matching_json = json.dumps(normalized, ensure_ascii=False)
    job.status = "matching_review"
    session.commit()
    return _job_dict(job)


def rematch_selected(session: Session, job_id: str, item_ids: list[str]) -> dict[str, Any]:
    job = get_job(session, job_id)
    selected = set(item_ids)
    items = json.loads(job.matching_json or "[]")
    for item in items:
        if str(item.get("id")) not in selected:
            continue
        if item.get("ignored"):
            continue
        answer_text = str(item.get("answer_text") or "").strip()
        item["status"] = "matched" if answer_text else "ai_generated_answer"
        item["answer_generated_by_ai"] = not bool(answer_text)
        item["confidence"] = "high" if answer_text else "medium"
    job.matching_json = json.dumps(items, ensure_ascii=False)
    job.status = "matching_review"
    session.commit()
    return _job_dict(job)


def generate_preview(session: Session, job_id: str) -> dict[str, Any]:
    job = get_job(session, job_id)
    items = json.loads(job.matching_json or "[]")
    questions = [item["question"] for item in items if not item.get("ignored")]
    if not questions:
        raise PalaceQuizValidationError("没有可生成的匹配题目。")
    job.status = "generating"
    session.commit()
    options = json.loads(job.options_json or "{}")
    warnings = (
        ["标记为 AI 生成答案的题目请在保存前重点核对。"]
        if any(item.get("answer_generated_by_ai") for item in items)
        else []
    )
    if options.get("enable_secondary_review"):
        warnings.append("已启用二次审核：保存前请再次检查答案与解析的一致性。")
    preview = {
        "palace_id": job.palace_id,
        "questions": questions,
        "source_meta": {
            "source_kind": "workspace",
            "job_id": job.id,
            "generation_mode": "workspace",
        },
        "ai_call_log_id": None,
        "warnings": warnings,
        "generation_stats": {
            "returned_count": len(questions),
            "savable_count": len(questions),
            "skipped_count": 0,
        },
        "grouped_questions": None,
    }
    job.preview_json = json.dumps(preview, ensure_ascii=False)
    job.status = "preview"
    session.commit()
    return _job_dict(job)


def mark_saved(session: Session, job_id: str) -> dict[str, Any]:
    job = get_job(session, job_id)
    job.status = "saved"
    session.commit()
    return _job_dict(job)


def delete_job(session: Session, job_id: str) -> None:
    job = get_job(session, job_id)
    path = _absolute(JOB_ROOT / job.id)
    session.delete(job)
    session.commit()
    if path.exists():
        shutil.rmtree(path)
