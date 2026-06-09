from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from memory_anki.modules.english.domain.text import tokenize_learning_sentence


@dataclass(frozen=True, slots=True)
class PreparedSentencesResult:
    sentences: list[dict[str, Any]]
    skipped_empty_count: int
    skipped_invalid_count: int
    warnings: list[dict[str, Any]]


def prepare_sentences_from_asr(asr_payload: dict[str, Any]) -> PreparedSentencesResult:
    prepared: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    skipped_empty = 0
    skipped_invalid = 0
    transcripts = asr_payload.get("transcripts")
    if not isinstance(transcripts, list):
        return PreparedSentencesResult(
            sentences=[],
            skipped_empty_count=0,
            skipped_invalid_count=0,
            warnings=[
                {
                    "message": "ASR 结果中没有 transcripts 数组。",
                    "data": {"payload": asr_payload},
                }
            ],
        )
    for transcript_index, transcript in enumerate(transcripts):
        if not isinstance(transcript, dict):
            continue
        sentences = transcript.get("sentences")
        if not isinstance(sentences, list):
            continue
        for sentence_payload in sentences:
            if not isinstance(sentence_payload, dict):
                continue
            text = str(sentence_payload.get("text") or "").strip()
            if not text:
                skipped_empty += 1
                continue
            begin_ms = safe_ms(sentence_payload.get("begin_time"))
            end_ms = safe_ms(sentence_payload.get("end_time"))
            if begin_ms <= 0 and sentence_payload.get("start") is not None:
                begin_ms = safe_ms(sentence_payload.get("start"), seconds=True)
            if end_ms <= 0 and sentence_payload.get("end") is not None:
                end_ms = safe_ms(sentence_payload.get("end"), seconds=True)
            if end_ms <= begin_ms:
                skipped_invalid += 1
                warnings.append(
                    {
                        "message": "丢弃时间轴异常的 ASR 句子。",
                        "data": {
                            "transcript_index": transcript_index,
                            "sentence": sentence_payload,
                        },
                    }
                )
                continue
            tokens = tokenize_learning_sentence(text)
            if not tokens:
                skipped_empty += 1
                continue
            prepared.append(
                {
                    "index": len(prepared),
                    "text_en": text,
                    "start_ms": begin_ms,
                    "end_ms": end_ms,
                    "tokens": tokens,
                }
            )
    return PreparedSentencesResult(
        sentences=prepared,
        skipped_empty_count=skipped_empty,
        skipped_invalid_count=skipped_invalid,
        warnings=warnings,
    )


def safe_ms(value: Any, *, seconds: bool = False) -> int:
    try:
        numeric = float(value)
    except Exception:
        return 0
    if seconds:
        numeric *= 1000
    return max(0, int(round(numeric)))
