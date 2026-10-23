"""Import an English course from a video plus local subtitle files.

No ASR or translation is involved: the uploaded English subtitle is the source
of truth, and an optional Chinese subtitle is aligned onto it by timeline.
"""

from __future__ import annotations

import json
import re
import shutil
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.english import (
    EnglishCourse,
    EnglishCourseProgress,
    EnglishSentence,
)
from memory_anki.modules.english.domain.errors import EnglishCourseError
from memory_anki.modules.english.domain.text import tokenize_learning_sentence
from memory_anki.modules.english.infrastructure.media import probe_media_duration_seconds
from memory_anki.modules.english.infrastructure.paths import course_dir

MAX_SUBTITLE_BYTES = 8 * 1024 * 1024
MAX_CUES = 6000
MAX_MERGED_WORDS = 64
MAX_MERGED_DURATION_MS = 22_000
MERGE_GAP_MS = 1_800

_CJK_RE = re.compile(r"[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]")
_LATIN_RE = re.compile(r"[A-Za-z]")
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_ASS_OVERRIDE_RE = re.compile(r"\{[^}]*\}")
_TIMESTAMP_RE = re.compile(r"(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})")
_TERMINAL_RE = re.compile(r"[.!?…。！？][\"'”’\)\]]*$")
_CONTINUATION_END_RE = re.compile(r"[,;:\-—–]$")
_SPEAKER_RE = re.compile(r"^\s*[-–—]?\s*[A-Z][A-Z0-9.'\-]{0,24}:\s*")
_MARKER_RE = re.compile(
    r"^\s*[\[\(（【][^\]\)）】]*(music|applause|laughter|laughs?|chuckles?|coughs?|screams?|gasps?|groans?|whispers?|murmurs?|cheering|sighs?|sound|noise|inaudible)"
    r"[^\]\)）】]*[\]\)）】]\s*$|^\s*[♪♫]+\s*$",
    re.I,
)
_ABBREVIATIONS = (
    "Mr.",
    "Mrs.",
    "Ms.",
    "Dr.",
    "Prof.",
    "St.",
    "Jr.",
    "Sr.",
    "vs.",
    "etc.",
    "e.g.",
    "i.e.",
    "No.",
    "Lt.",
    "Sgt.",
    "Capt.",
)


@dataclass(slots=True)
class SubtitleCue:
    start_ms: int
    end_ms: int
    text_en: str = ""
    text_zh: str = ""

    @property
    def midpoint_ms(self) -> int:
        return (self.start_ms + self.end_ms) // 2


@dataclass(slots=True)
class ImportedSentence:
    text_en: str
    text_zh: str
    start_ms: int
    end_ms: int
    tokens: list[str] = field(default_factory=list)


@dataclass(slots=True)
class SubtitleTrack:
    cues: list[SubtitleCue]
    filename: str
    format: str


def decode_subtitle_bytes(raw: bytes) -> str:
    if not raw:
        return ""
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        try:
            return raw.decode("utf-16")
        except UnicodeDecodeError:
            pass
    for encoding in ("utf-8", "gb18030", "big5"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def detect_subtitle_format(text: str) -> str:
    head = text.lstrip("﻿ \t\r\n")[:400].upper()
    if "[SCRIPT INFO]" in text[:4000].upper() or re.search(r"^DIALOGUE:", text, re.M | re.I):
        return "ass"
    if head.startswith("WEBVTT"):
        return "vtt"
    return "srt"


def parse_timestamp_ms(value: str) -> int:
    match = _TIMESTAMP_RE.search(value or "")
    if not match:
        return -1
    hours = int(match.group(1) or 0)
    minutes = int(match.group(2) or 0)
    seconds = int(match.group(3) or 0)
    millis = int((match.group(4) or "0").ljust(3, "0")[:3])
    return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis


def contains_cjk(text: str) -> bool:
    return bool(_CJK_RE.search(text or ""))


def contains_latin(text: str) -> bool:
    return bool(_LATIN_RE.search(text or ""))


def clean_subtitle_text(text: str, *, allow_chinese_only: bool = False) -> tuple[str, str]:
    """Return (english, chinese) for one cue body.

    A cue may contain one language or two parallel lines. Mixed lines keep their
    Chinese copy in the translation track and their Latin fragment in English.
    """
    cleaned = _ASS_OVERRIDE_RE.sub("", text or "")
    cleaned = _HTML_TAG_RE.sub("", cleaned)
    cleaned = cleaned.replace("\\N", "\n").replace("\\n", "\n").replace("\\h", " ")
    english_lines: list[str] = []
    chinese_lines: list[str] = []

    for raw_line in cleaned.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = _SPEAKER_RE.sub("", raw_line.strip()).strip()
        line = re.sub(r"^[-–—]\s*", "", line).strip()
        if not line or _MARKER_RE.match(line):
            continue
        has_cjk = contains_cjk(line)
        has_latin = contains_latin(line)
        if has_cjk:
            chinese_lines.append(line)
            if has_latin:
                latin_only = _CJK_RE.sub(" ", line).strip(" -–—|/")
                if contains_latin(latin_only):
                    english_lines.append(latin_only)
        elif has_latin:
            english_lines.append(line)
        elif allow_chinese_only:
            chinese_lines.append(line)

    english = _normalize_english_text(" ".join(english_lines))
    chinese = "\n".join(chinese_lines).strip()
    return english, chinese


def _normalize_english_text(text: str) -> str:
    normalized = re.sub(r"\s+", " ", text or "").strip()
    normalized = re.sub(r"\s+([,.;:!?])", r"\1", normalized)
    normalized = re.sub(r"([(\[])\s+", r"\1", normalized)
    normalized = re.sub(r"\s+([)\]])", r"\1", normalized)
    return normalized


def _parse_cue_blocks(text: str, *, allow_chinese_only: bool) -> list[SubtitleCue]:
    blocks = re.split(r"\n\s*\n", text.replace("\r\n", "\n").replace("\r", "\n"))
    cues: list[SubtitleCue] = []
    for block in blocks:
        lines = [line.rstrip() for line in block.split("\n") if line.strip()]
        if not lines:
            continue
        first = lines[0].strip().upper()
        if first.startswith(("WEBVTT", "NOTE", "STYLE", "REGION")):
            continue
        timing_index = -1
        start_ms = end_ms = -1
        for index, line in enumerate(lines):
            if "-->" not in line:
                continue
            left, _, right = line.partition("-->")
            start_ms = parse_timestamp_ms(left)
            end_ms = parse_timestamp_ms(right)
            timing_index = index
            break
        if timing_index < 0 or start_ms < 0 or end_ms < 0:
            continue
        body = "\n".join(lines[timing_index + 1 :])
        english, chinese = clean_subtitle_text(body, allow_chinese_only=allow_chinese_only)
        if not english and not chinese:
            continue
        if not english and not allow_chinese_only:
            continue
        cues.append(
            SubtitleCue(
                start_ms=max(0, start_ms),
                end_ms=max(start_ms + 300, end_ms),
                text_en=english,
                text_zh=chinese,
            )
        )
    return cues


def _parse_ass(text: str, *, allow_chinese_only: bool) -> list[SubtitleCue]:
    cues: list[SubtitleCue] = []
    for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        stripped = line.strip()
        if not stripped.lower().startswith("dialogue:"):
            continue
        payload = stripped.split(":", 1)[1]
        parts = payload.split(",", 9)
        if len(parts) < 10:
            continue
        start_ms = parse_timestamp_ms(parts[1])
        end_ms = parse_timestamp_ms(parts[2])
        if start_ms < 0 or end_ms < 0:
            continue
        english, chinese = clean_subtitle_text(parts[9], allow_chinese_only=allow_chinese_only)
        if not english and not chinese:
            continue
        if not english and not allow_chinese_only:
            continue
        cues.append(
            SubtitleCue(
                start_ms=max(0, start_ms),
                end_ms=max(start_ms + 300, end_ms),
                text_en=english,
                text_zh=chinese,
            )
        )
    return cues


def parse_subtitle_text(
    text: str,
    *,
    allow_chinese_only: bool = False,
) -> tuple[list[SubtitleCue], str]:
    fmt = detect_subtitle_format(text)
    cues = _parse_ass(text, allow_chinese_only=allow_chinese_only) if fmt == "ass" else _parse_cue_blocks(
        text, allow_chinese_only=allow_chinese_only
    )
    cues = [cue for cue in cues if cue.end_ms > cue.start_ms]
    cues.sort(key=lambda cue: (cue.start_ms, cue.end_ms))
    if len(cues) > MAX_CUES:
        raise EnglishCourseError(f"字幕条目过多（{len(cues)} 条，上限 {MAX_CUES} 条），请拆分后再导入。")
    if not cues:
        raise EnglishCourseError("字幕文件中没有解析到可用句子，请确认时间轴格式为 SRT / VTT / ASS。")
    return cues, fmt


def align_translation_cues(
    english_cues: list[SubtitleCue],
    chinese_cues: list[SubtitleCue],
) -> None:
    """Attach Chinese text to English cues in place."""
    if not english_cues or not chinese_cues:
        return
    same_shape = len(english_cues) == len(chinese_cues)
    for index, english in enumerate(english_cues):
        if same_shape:
            chinese = chinese_cues[index]
            candidate = chinese.text_zh
        else:
            best: SubtitleCue | None = None
            best_overlap = 0
            for chinese in chinese_cues:
                overlap = min(english.end_ms, chinese.end_ms) - max(english.start_ms, chinese.start_ms)
                if overlap > best_overlap:
                    best_overlap = overlap
                    best = chinese
            if best is None or best_overlap <= 0:
                best = min(
                    chinese_cues,
                    key=lambda cue: abs(cue.midpoint_ms - english.midpoint_ms),
                )
                if abs(best.midpoint_ms - english.midpoint_ms) > 4_000:
                    best = None
            candidate = best.text_zh if best is not None else ""
        if candidate:
            english.text_zh = candidate.strip()


def _split_english_fragments(text: str) -> list[str]:
    normalized = _normalize_english_text(text)
    if not normalized:
        return []
    protected = normalized
    for abbreviation in _ABBREVIATIONS:
        protected = re.sub(
            rf"(?<![A-Za-z]){re.escape(abbreviation)}",
            abbreviation.replace(".", "․"),
            protected,
            flags=re.IGNORECASE,
        )
    fragments = re.split(r"(?<=[.!?…])\s+", protected)
    return [
        fragment.replace("․", ".").strip()
        for fragment in fragments
        if fragment.strip()
    ]


def _split_chinese_fragments(text: str) -> list[str]:
    normalized = re.sub(r"\s+", " ", text or "").strip()
    if not normalized:
        return []
    return [part.strip() for part in re.split(r"(?<=[。！？!?…])\s*", normalized) if part.strip()]


def _looks_like_continuation(previous: str, current: str) -> bool:
    stripped = current.strip()
    if not stripped:
        return False
    if _CONTINUATION_END_RE.search(previous.rstrip()):
        return True
    return stripped[0].islower() or stripped[0] in ",;:)]"


def build_imported_sentences(
    english_cues: list[SubtitleCue],
    chinese_cues: list[SubtitleCue] | None = None,
) -> list[ImportedSentence]:
    align_translation_cues(english_cues, chinese_cues or [])
    units: list[ImportedSentence] = []

    for cue in english_cues:
        fragments = _split_english_fragments(cue.text_en)
        if not fragments:
            continue
        chinese_fragments = _split_chinese_fragments(cue.text_zh)
        paired = len(chinese_fragments) == len(fragments)
        for index, fragment in enumerate(fragments):
            units.append(
                ImportedSentence(
                    text_en=fragment,
                    text_zh=(chinese_fragments[index] if paired else (cue.text_zh if index == 0 else "")),
                    start_ms=cue.start_ms,
                    end_ms=cue.end_ms,
                    tokens=tokenize_learning_sentence(fragment),
                )
            )

    merged: list[ImportedSentence] = []
    for unit in units:
        if not unit.tokens:
            continue
        if not merged:
            merged.append(unit)
            continue
        previous = merged[-1]
        gap = max(0, unit.start_ms - previous.end_ms)
        word_count = len(previous.tokens) + len(unit.tokens)
        duration = max(previous.end_ms, unit.end_ms) - previous.start_ms
        terminal = bool(_TERMINAL_RE.search(previous.text_en.rstrip()))
        should_merge = (
            word_count <= MAX_MERGED_WORDS
            and duration <= MAX_MERGED_DURATION_MS
            and (
                not terminal
                or _looks_like_continuation(previous.text_en, unit.text_en)
                or (gap <= MERGE_GAP_MS and len(previous.tokens) <= 2)
            )
        )
        if should_merge:
            previous.text_en = f"{previous.text_en.rstrip()} {unit.text_en.lstrip()}".strip()
            previous.text_zh = " ".join(
                part for part in (previous.text_zh.strip(), unit.text_zh.strip()) if part
            )
            previous.end_ms = max(previous.end_ms, unit.end_ms)
            previous.tokens = tokenize_learning_sentence(previous.text_en)
        else:
            merged.append(unit)

    result: list[ImportedSentence] = []
    for unit in merged:
        text_en = _normalize_english_text(unit.text_en)
        tokens = tokenize_learning_sentence(text_en)
        if not tokens or not contains_latin(text_en):
            continue
        start_ms = max(0, int(unit.start_ms))
        end_ms = max(start_ms + 300, int(unit.end_ms))
        result.append(
            ImportedSentence(
                text_en=text_en,
                text_zh=(unit.text_zh or "").strip(),
                start_ms=start_ms,
                end_ms=end_ms,
                tokens=tokens,
            )
        )
    if not result:
        raise EnglishCourseError("英文字幕中没有可练习的英文句子。")
    return result


def create_course_from_subtitles(
    session: Session,
    *,
    source_path: Path,
    video_filename: str,
    video_mime_type: str,
    file_size: int,
    title: str,
    english_track: SubtitleTrack,
    chinese_track: SubtitleTrack | None,
    english_subtitle_bytes: bytes | None = None,
    chinese_subtitle_bytes: bytes | None = None,
) -> tuple[EnglishCourse, int]:
    sentences = build_imported_sentences(english_track.cues, chinese_track.cues if chinese_track else None)
    safe_title = (title or "").strip() or derive_title(video_filename)
    media_type = (video_mime_type or "").strip()
    if not media_type or media_type == "application/octet-stream":
        media_type = guess_video_type(video_filename)

    course = EnglishCourse(
        title=safe_title[:240],
        original_filename=(video_filename or source_path.name)[:320],
        media_filename="",
        media_relative_path="",
        media_mime_type=media_type[:120],
        file_size=max(0, int(file_size)),
        duration_seconds=0,
        sentence_count=len(sentences),
    )
    session.add(course)
    session.flush()

    target_dir = course_dir(course.id)
    target_dir.mkdir(parents=True, exist_ok=True)
    suffix = safe_suffix(video_filename, ".mp4")
    media_filename = f"source{suffix}"
    target_media_path = target_dir / media_filename
    try:
        shutil.move(str(source_path), str(target_media_path))
    except Exception as exc:
        shutil.rmtree(target_dir, ignore_errors=True)
        raise EnglishCourseError("视频文件保存失败，请重试。") from exc

    course.media_filename = media_filename
    course.media_relative_path = f"{target_dir.name}/{media_filename}"

    duration_seconds = 0
    try:
        duration_seconds = int(probe_media_duration_seconds(target_media_path) or 0)
    except Exception:
        duration_seconds = 0
    subtitle_end_seconds = max(1, int(round(sentences[-1].end_ms / 1000)))
    duration_seconds = max(duration_seconds, subtitle_end_seconds)
    course.duration_seconds = duration_seconds

    _write_subtitle_copy(
        target_dir,
        stem="english",
        filename=english_track.filename,
        raw=english_subtitle_bytes,
        cues=english_track.cues,
        chinese=False,
    )
    if chinese_track is not None:
        _write_subtitle_copy(
            target_dir,
            stem="chinese",
            filename=chinese_track.filename,
            raw=chinese_subtitle_bytes,
            cues=chinese_track.cues,
            chinese=True,
        )

    try:
        for index, sentence in enumerate(sentences):
            course.sentences.append(
                EnglishSentence(
                    sentence_index=index,
                    text_en=sentence.text_en,
                    text_zh=sentence.text_zh,
                    start_ms=sentence.start_ms,
                    end_ms=sentence.end_ms,
                    tokens_json=json.dumps(sentence.tokens, ensure_ascii=False),
                    vocabulary_json="[]",
                )
            )
        session.add(
            EnglishCourseProgress(
                course=course,
                current_sentence_index=0,
                completed_sentence_indexes_json="[]",
                is_completed=False,
            )
        )
        course.updated_at = utc_now_naive()
        session.commit()
    except Exception:
        session.rollback()
        shutil.rmtree(target_dir, ignore_errors=True)
        raise
    session.refresh(course)
    matched_translation_count = sum(1 for sentence in sentences if sentence.text_zh)
    return course, matched_translation_count


def _write_subtitle_copy(
    target_dir: Path,
    *,
    stem: str,
    filename: str,
    raw: bytes | None,
    cues: Iterable[SubtitleCue],
    chinese: bool,
) -> None:
    suffix = safe_suffix(filename, ".srt")
    target = target_dir / f"{stem}{suffix}"
    try:
        if raw:
            target.write_bytes(raw)
            return
        lines: list[str] = []
        for index, cue in enumerate(cues, start=1):
            lines.append(str(index))
            lines.append(f"{_format_srt_timestamp(cue.start_ms)} --> {_format_srt_timestamp(cue.end_ms)}")
            lines.append((cue.text_zh if chinese else cue.text_en) or "")
            lines.append("")
        target.write_text("\n".join(lines), encoding="utf-8")
    except OSError:
        # Provenance copies are best-effort; the course data is already complete.
        return


def _format_srt_timestamp(value: int) -> str:
    total_ms = max(0, int(value))
    hours, remainder = divmod(total_ms, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, millis = divmod(remainder, 1_000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


def safe_suffix(filename: str, fallback: str) -> str:
    suffix = Path(filename or "").suffix.lower()
    if re.fullmatch(r"\.[a-z0-9]{1,8}", suffix or ""):
        return suffix
    return fallback


def derive_title(filename: str) -> str:
    stem = Path(filename or "").stem.strip()
    if not stem:
        return "未命名英语课程"
    title = re.sub(r"[_]+", " ", stem)
    title = re.sub(r"\s+", " ", title).strip()
    return title or "未命名英语课程"


def guess_video_type(filename: str) -> str:
    suffix = safe_suffix(filename, "").lstrip(".")
    common = {
        "mp4": "video/mp4",
        "m4v": "video/mp4",
        "mov": "video/quicktime",
        "mkv": "video/x-matroska",
        "webm": "video/webm",
        "avi": "video/x-msvideo",
        "ts": "video/mp2t",
        "mp3": "audio/mpeg",
        "m4a": "audio/mp4",
        "wav": "audio/wav",
        "flac": "audio/flac",
    }
    return common.get(suffix, "video/mp4")
