"""Material CRUD, PDF extraction, profile/workspace reads.

Extracted from service.py (P1.3b). Cross-module and shared symbols
are resolved at runtime via the ``_svc`` handle so that route tests which
patch ``reading_service.X`` keep working.
"""

from __future__ import annotations

import math
import re
from collections import (
    Counter,
)
from datetime import (
    timedelta,
)
from pathlib import (
    Path,
)
from typing import (
    Any,
)

import fitz
from sqlalchemy.orm import Session, load_only, selectinload

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.english_reading import (
    EnglishReadingMaterial,
    EnglishReadingProfile,
    EnglishReadingSession,
    EnglishReadingVersion,
)
from memory_anki.modules.english_reading.domain.errors import EnglishReadingError
from memory_anki.modules.session.public.queries import (
    ENGLISH_READING_SCENES,
    get_all_time_study_session_duration_seconds,
    get_study_session_duration_seconds,
)

from . import service as _svc


def get_profile(session: Session) -> dict[str, Any]:
    return _svc.serialize_profile(_svc.ensure_profile_row(session))


def get_workspace(session: Session) -> dict[str, Any]:
    return {
        "profile": _svc.get_profile(session),
        "stats": _svc.get_reading_stats(session),
        "recentMaterials": _svc.list_recent_materials(session),
    }


def update_profile(
    session: Session,
    *,
    declared_cefr: str,
) -> dict[str, Any]:
    safe_level = _svc.normalize_cefr_level(declared_cefr)
    profile = _svc.ensure_profile_row(session)
    if profile.declared_cefr != safe_level:
        profile.declared_cefr = safe_level
        profile.working_lexical_i = _svc.serialize_float(_svc.default_lexical_value_for_level(safe_level))
        profile.working_syntactic_i = _svc.serialize_float(_svc.default_syntactic_value_for_level(safe_level))
        profile.xp = 0
        profile.confidence = _svc.serialize_float(0.35)
        profile.easy_streak = 0
        profile.hard_streak = 0
        profile.updated_at = utc_now_naive()
        session.commit()
        session.refresh(profile)
    return _svc.serialize_profile(profile)


def create_material(
    session: Session,
    *,
    pasted_text: str,
    file_bytes: bytes | None,
    original_filename: str,
) -> dict[str, Any]:
    source_type, raw_text = _svc.resolve_material_source(
        pasted_text=pasted_text,
        file_bytes=file_bytes,
        original_filename=original_filename,
    )
    cleaned_text = _svc.clean_material_text(raw_text)
    if not cleaned_text.strip():
        raise EnglishReadingError("未提取到可阅读的正文内容。")
    material = EnglishReadingMaterial(
        title=_svc.derive_material_title(cleaned_text, original_filename=original_filename),
        source_type=source_type,
        original_filename=original_filename or "",
        original_text=raw_text,
        cleaned_text=cleaned_text,
        word_count=_svc.count_words(cleaned_text),
    )
    session.add(material)
    session.commit()
    session.refresh(material)
    return _svc.serialize_material(material)


def get_material(session: Session, material_id: int) -> dict[str, Any]:
    material = _svc.get_material_row(session, material_id)
    return _svc.serialize_material(material)


def update_material(
    session: Session,
    *,
    material_id: int,
    title: str,
) -> dict[str, Any]:
    material = _svc.get_material_row(session, material_id)
    safe_title = str(title or "").strip()
    if not safe_title:
        raise EnglishReadingError("阅读材料标题不能为空。")
    material.title = safe_title[:240]
    material.updated_at = utc_now_naive()
    session.commit()
    session.refresh(material)
    return _svc.serialize_material(material)


def delete_material(session: Session, material_id: int) -> dict[str, Any]:
    material = _svc.get_material_row(session, material_id)
    deleted_material_id = int(material.id)
    session.delete(material)
    session.commit()
    return {"deletedMaterialId": deleted_material_id}


def get_material_version(session: Session, material_id: int) -> dict[str, Any]:
    material = _svc.get_material_row(session, material_id)
    version = _svc.get_latest_version(material)
    if version is None:
        raise EnglishReadingError("当前材料还没有生成阅读版本。")
    return _svc.serialize_version(version)


def list_recent_materials(session: Session, limit: int = 12) -> list[dict[str, Any]]:
    safe_limit = max(1, min(50, int(limit)))
    materials = (
        session.query(EnglishReadingMaterial)
        .options(
            load_only(
                EnglishReadingMaterial.id,
                EnglishReadingMaterial.title,
                EnglishReadingMaterial.source_type,
                EnglishReadingMaterial.original_filename,
                EnglishReadingMaterial.word_count,
                EnglishReadingMaterial.created_at,
                EnglishReadingMaterial.updated_at,
            ),
            selectinload(EnglishReadingMaterial.versions).load_only(
                EnglishReadingVersion.id,
                EnglishReadingVersion.material_id,
                EnglishReadingVersion.created_at,
            ),
        )
        .order_by(EnglishReadingMaterial.updated_at.desc(), EnglishReadingMaterial.id.desc())
        .limit(safe_limit)
        .all()
    )
    return [_svc.serialize_material(material) for material in materials]


def get_reading_stats(session: Session) -> dict[str, int]:
    total_materials = session.query(EnglishReadingMaterial).count()
    generated_materials = session.query(EnglishReadingVersion.material_id).distinct().count()
    completed_sessions = session.query(EnglishReadingSession).count()
    today_start = utc_now_naive().replace(hour=0, minute=0, second=0, microsecond=0)
    tomorrow_start = today_start.replace(day=today_start.day) + timedelta(days=1)
    week_start = today_start - timedelta(days=today_start.weekday())
    return {
        "totalMaterials": total_materials,
        "generatedMaterials": generated_materials,
        "completedSessions": completed_sessions,
        "todayReadingSeconds": _svc.get_reading_duration_seconds(
            session,
            start=today_start,
            end=tomorrow_start,
        ),
        "weeklyReadingSeconds": _svc.get_reading_duration_seconds(
            session,
            start=week_start,
            end=tomorrow_start,
        ),
        "totalReadingSeconds": _svc.get_total_reading_duration_seconds(session),
    }


def get_reading_duration_seconds(
    session: Session,
    *,
    start,
    end,
) -> int:
    return get_study_session_duration_seconds(
        session,
        scenes=ENGLISH_READING_SCENES,
        start=start,
        end=end,
    )


def get_total_reading_duration_seconds(session: Session) -> int:
    return get_all_time_study_session_duration_seconds(
        session,
        scenes=ENGLISH_READING_SCENES,
    )


def resolve_material_source(
    *,
    pasted_text: str,
    file_bytes: bytes | None,
    original_filename: str,
) -> tuple[str, str]:
    text_value = str(pasted_text or "").strip()
    if text_value:
        return ("paste", text_value)
    if not file_bytes:
        raise EnglishReadingError("请粘贴正文或上传 txt / md / pdf 文件。")
    suffix = Path(original_filename or "").suffix.lower()
    if suffix == ".pdf":
        return ("pdf", _svc.extract_text_from_pdf(file_bytes))
    if suffix in {".txt", ".md"} or not suffix:
        try:
            return (suffix.lstrip(".") or "txt", file_bytes.decode("utf-8"))
        except UnicodeDecodeError:
            try:
                return (suffix.lstrip(".") or "txt", file_bytes.decode("utf-8-sig"))
            except UnicodeDecodeError as exc:
                raise EnglishReadingError("文本文件需要是 UTF-8 编码。") from exc
    raise EnglishReadingError("暂只支持 txt / md / pdf 文件。")


def extract_text_from_pdf(file_bytes: bytes) -> str:
    try:
        document = fitz.open(stream=file_bytes, filetype="pdf")
    except Exception as exc:
        raise EnglishReadingError("PDF 打开失败。") from exc
    page_lines: list[list[str]] = []
    for page in document:
        raw_lines = [line.rstrip() for line in page.get_text("text").splitlines()]
        page_lines.append(raw_lines)
    repeated_edge_lines = _svc.detect_repeated_pdf_edge_lines(page_lines)
    cleaned_pages: list[str] = []
    for lines in page_lines:
        filtered = []
        for index, line in enumerate(lines):
            normalized_line = line.strip()
            if not normalized_line:
                filtered.append("")
                continue
            if _svc.PAGE_NUMBER_RE.match(normalized_line):
                continue
            if index < 2 or index >= max(0, len(lines) - 2):
                if normalized_line in repeated_edge_lines:
                    continue
            filtered.append(line)
        cleaned_pages.append(_svc.join_pdf_lines(filtered))
    return "\n\n".join(page for page in cleaned_pages if page.strip())


def detect_repeated_pdf_edge_lines(page_lines: list[list[str]]) -> set[str]:
    edge_counter: Counter[str] = Counter()
    for lines in page_lines:
        stripped = [line.strip() for line in lines if line.strip()]
        if not stripped:
            continue
        for line in stripped[:2] + stripped[-2:]:
            if len(line) < 3:
                continue
            edge_counter[line] += 1
    minimum_hits = max(2, math.ceil(len(page_lines) * 0.4))
    return {line for line, count in edge_counter.items() if count >= minimum_hits}


def join_pdf_lines(lines: list[str]) -> str:
    paragraphs: list[str] = []
    current_parts: list[str] = []
    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            if current_parts:
                paragraphs.append(" ".join(current_parts).strip())
                current_parts = []
            continue
        if not current_parts:
            current_parts.append(line)
            continue
        previous = current_parts[-1]
        if previous.endswith(("-", "/")):
            current_parts[-1] = previous[:-1] + line
        elif previous.endswith((".", "?", "!", ":", ";")):
            current_parts.append(line)
        elif line[:1].islower():
            current_parts[-1] = previous + " " + line
        else:
            current_parts.append(line)
    if current_parts:
        paragraphs.append(" ".join(current_parts).strip())
    return "\n\n".join(paragraphs)


def clean_material_text(text: str) -> str:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"\s+", " ", line).strip() for line in normalized.split("\n")]
    cleaned_lines: list[str] = []
    blank_streak = 0
    for line in lines:
        if not line:
            blank_streak += 1
            if blank_streak <= 2:
                cleaned_lines.append("")
            continue
        blank_streak = 0
        cleaned_lines.append(line)
    return "\n".join(cleaned_lines).strip()


def derive_material_title(text: str, *, original_filename: str) -> str:
    english_text = _svc.extract_visible_english_text(text)
    english_lines = [line.strip() for line in english_text.splitlines() if line.strip()]
    preferred_line = next(
        (line for line in english_lines if len(_svc.WORD_RE.findall(line)) >= 4),
        english_lines[0] if english_lines else "",
    )
    first_non_empty = preferred_line
    if first_non_empty:
        return first_non_empty[:80]
    stem = Path(original_filename or "").stem.strip()
    english_stem_words = _svc.WORD_RE.findall(stem)
    if english_stem_words:
        return " ".join(english_stem_words)[:80]
    return stem or "未命名英语阅读材料"


def extract_visible_english_text(text: str) -> str:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    mixed_chunks = [_svc.normalize_english_candidate(chunk) for chunk in _svc.CJK_RE.split(normalized)]
    chunk_paragraphs = [
        chunk
        for chunk in mixed_chunks
        if _svc.is_visible_english_paragraph(chunk) and len(_svc.WORD_RE.findall(chunk)) >= 4
    ]
    if chunk_paragraphs:
        return "\n\n".join(chunk_paragraphs).strip()
    english_paragraphs: list[str] = []
    current_lines: list[str] = []
    for raw_line in normalized.split("\n"):
        line = _svc.normalize_english_candidate(raw_line)
        if not line:
            if current_lines:
                english_paragraphs.append(" ".join(current_lines).strip())
                current_lines = []
            continue
        if _svc.is_visible_english_paragraph(line):
            current_lines.append(line)
            continue
        if current_lines:
            english_paragraphs.append(" ".join(current_lines).strip())
            current_lines = []
    if current_lines:
        english_paragraphs.append(" ".join(current_lines).strip())
    english_paragraphs = [paragraph for paragraph in english_paragraphs if paragraph]
    if english_paragraphs:
        return "\n\n".join(english_paragraphs).strip()
    return ""


def is_visible_english_paragraph(paragraph: str) -> bool:
    stripped = _svc.normalize_english_candidate(paragraph)
    if not stripped:
        return False
    words = _svc.WORD_RE.findall(stripped)
    if len(words) < 2:
        return False
    cjk_count = len(_svc.CJK_RE.findall(stripped))
    ascii_letter_count = sum(1 for char in stripped if char.isascii() and char.isalpha())
    if ascii_letter_count < 12:
        return False
    if cjk_count == 0:
        return True
    return ascii_letter_count >= cjk_count * 3


def normalize_english_candidate(value: str) -> str:
    normalized = re.sub(r"\s+", " ", str(value or "")).strip()
    normalized = normalized.replace("’", "'").replace("“", '"').replace("”", '"')
    normalized = normalized.strip(" -_/|")
    return normalized


def count_words(text: str) -> int:
    return len(_svc.WORD_RE.findall(text))


def ensure_profile_row(session: Session) -> EnglishReadingProfile:
    profile = session.query(EnglishReadingProfile).order_by(EnglishReadingProfile.id.asc()).first()
    if profile is not None:
        return profile
    profile = EnglishReadingProfile(
        declared_cefr="B1",
        working_lexical_i=_svc.serialize_float(_svc.default_lexical_value_for_level("B1")),
        working_syntactic_i=_svc.serialize_float(_svc.default_syntactic_value_for_level("B1")),
        xp=0,
        confidence=_svc.serialize_float(0.35),
        easy_streak=0,
        hard_streak=0,
    )
    session.add(profile)
    session.commit()
    session.refresh(profile)
    return profile


def get_material_row(session: Session, material_id: int) -> EnglishReadingMaterial:
    material = session.query(EnglishReadingMaterial).filter_by(id=material_id).first()
    if material is None:
        raise EnglishReadingError("英语阅读材料不存在。")
    return material


def serialize_profile(profile: EnglishReadingProfile) -> dict[str, Any]:
    declared_cefr = _svc.normalize_cefr_level(profile.declared_cefr)
    return {
        "declaredCefr": declared_cefr,
        "workingLexicalI": round(
            _svc.parse_float(profile.working_lexical_i, _svc.default_lexical_value_for_level(declared_cefr)),
            3,
        ),
        "workingSyntacticI": round(
            _svc.parse_float(
                profile.working_syntactic_i, _svc.default_syntactic_value_for_level(declared_cefr)
            ),
            3,
        ),
        "xp": int(profile.xp or 0),
        "levelProgress": max(0, min(100, int(profile.xp or 0))),
        "confidence": round(_svc.parse_float(profile.confidence, 0.35), 3),
    }


def serialize_material(material: EnglishReadingMaterial) -> dict[str, Any]:
    latest_version = _svc.get_latest_version(material)
    return {
        "id": material.id,
        "title": material.title,
        "sourceType": material.source_type,
        "originalFilename": material.original_filename,
        "wordCount": int(material.word_count or 0),
        "latestVersionId": latest_version.id if latest_version else None,
        "createdAt": material.created_at.isoformat() if material.created_at else None,
        "updatedAt": material.updated_at.isoformat() if material.updated_at else None,
    }
