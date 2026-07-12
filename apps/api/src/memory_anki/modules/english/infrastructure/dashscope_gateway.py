from __future__ import annotations

import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from time import monotonic
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import dashscope
import requests  # type: ignore[import-untyped]
from dashscope.audio.qwen_asr import QwenTranscription
from dashscope.files import Files

from memory_anki.core.config import (
    DASHSCOPE_API_KEY,
    DASHSCOPE_BASE_URL,
    ENGLISH_TRANSLATION_MODEL,
)
from memory_anki.infrastructure.llm.external_ai_call_logs import (
    begin_external_ai_call_log,
    complete_external_ai_call_log,
    fail_external_ai_call_log,
)
from memory_anki.infrastructure.llm.openai_compatible import (
    OpenAICompatibleChatConfig,
    OpenAICompatibleError,
    call_chat_completion_text,
)
from memory_anki.modules.english.domain.errors import (
    EnglishCourseError,
    EnglishTranslationBatchMismatchError,
)
from memory_anki.platform.application import AiRuntimeOptions, PromptCatalog, ResolvedAiRuntime

from .generation_log_store import append_generation_log_event

logger = logging.getLogger(__name__)

ASR_POLL_SECONDS = 2
TRANSLATION_BATCH_SIZE = 40
TRANSLATION_LINE_RE = re.compile(r"^\[S(?P<index>\d+)\]\s*(?P<text>.*)$")


@dataclass(frozen=True, slots=True)
class LegacyDashscopeRuntime:
    model: str
    api_key: str
    base_url: str
    provider: str = "dashscope"
    supports_temperature: bool = True
    extra_payload: dict[str, Any] | None = None


def _resolve_legacy_dashscope_runtime(
    *,
    ai_options: AiRuntimeOptions | None = None,
    legacy_default_model: str | None = None,
    resolved_runtime: ResolvedAiRuntime | None = None,
) -> ResolvedAiRuntime | LegacyDashscopeRuntime:
    if resolved_runtime is not None:
        return resolved_runtime
    model = str(
        (ai_options.model if ai_options and ai_options.model else None)
        or legacy_default_model
        or "qwen3-asr-flash"
    ).strip()
    return LegacyDashscopeRuntime(
        model=model,
        api_key=str(DASHSCOPE_API_KEY or "").strip(),
        base_url=str(DASHSCOPE_BASE_URL or "").strip(),
    )


class DashscopeEnglishAsrGateway:
    def transcribe(
        self,
        audio_path: Path,
        *,
        task_id: str,
        ai_options: AiRuntimeOptions | None = None,
        resolved_runtime: ResolvedAiRuntime | None = None,
        progress_callback: Callable[[dict[str, Any]], None] | None = None,
    ) -> dict[str, Any]:
        runtime = _resolve_legacy_dashscope_runtime(
            ai_options=ai_options,
            resolved_runtime=resolved_runtime,
        )
        api_key = str(runtime.api_key or "").strip()
        if not api_key:
            raise EnglishCourseError("未配置 ASR 模型对应的 Provider API Key，无法生成英语课程。")
        dashscope.api_key = api_key
        dashscope.base_http_api_url = resolve_dashscope_sdk_base_url(runtime.base_url)
        try:
            upload_response = Files.upload(file_path=str(audio_path), purpose="inference")
        except Exception as exc:
            logger.warning("english asr upload failed", exc_info=True)
            raise EnglishCourseError(f"上传音频到转写服务失败：{exc}") from exc
        upload_output = to_dict(getattr(upload_response, "output", None))
        file_id = resolve_file_id(upload_output)
        if not file_id:
            raise EnglishCourseError("音频上传成功，但未拿到 file_id。")
        append_generation_log_event(
            task_id=task_id,
            stage="transcribe",
            kind="request",
            message="ASR 音频上传完成。",
            data={
                "file_id": file_id,
                "upload_output": upload_output,
            },
        )
        try:
            file_meta = Files.get(file_id=file_id)
        except Exception as exc:
            logger.warning("english asr file meta fetch failed", exc_info=True)
            raise EnglishCourseError(f"查询转写文件失败：{exc}") from exc
        meta_output = to_dict(getattr(file_meta, "output", None))
        signed_url = resolve_signed_url(meta_output)
        if not signed_url:
            raise EnglishCourseError("转写文件签名地址为空。")
        append_generation_log_event(
            task_id=task_id,
            stage="transcribe",
            kind="request",
            message="已获取 ASR 文件签名地址。",
            data={
                "file_meta": meta_output,
                "signed_url": sanitize_url(signed_url),
            },
        )
        try:
            task_response = QwenTranscription.async_call(
                model=runtime.model,
                file_url=signed_url,
                enable_words=True,
                enable_itn=False,
            )
        except Exception as exc:
            logger.warning("english asr task create failed", exc_info=True)
            raise EnglishCourseError(f"创建字幕转写任务失败：{exc}") from exc
        task_output = to_dict(getattr(task_response, "output", None))
        remote_task_id = str(task_output.get("task_id") or "").strip()
        if not remote_task_id:
            raise EnglishCourseError("转写任务创建成功，但 task_id 为空。")
        append_generation_log_event(
            task_id=task_id,
            stage="transcribe",
            kind="request",
            message="已创建 ASR 任务。",
            data={
                "model": runtime.model,
                "provider": runtime.provider,
                "remote_task_id": remote_task_id,
                "task_output": task_output,
            },
        )

        started = monotonic()
        final_fetch_output: dict[str, Any] = {}
        while True:
            try:
                fetch_response = QwenTranscription.fetch(task=remote_task_id)
            except Exception as exc:
                logger.warning("english asr task poll failed", exc_info=True)
                raise EnglishCourseError(f"轮询字幕转写任务失败：{exc}") from exc
            fetch_output = to_dict(getattr(fetch_response, "output", None))
            final_fetch_output = fetch_output
            task_status = str(fetch_output.get("task_status") or "").strip().upper()
            elapsed_seconds = int(monotonic() - started)
            if progress_callback:
                try:
                    progress_callback(
                        {
                            "task_status": task_status or "RUNNING",
                            "elapsed_seconds": elapsed_seconds,
                        }
                    )
                except Exception:
                    logger.warning("english asr progress callback failed", exc_info=True)
            append_generation_log_event(
                task_id=task_id,
                stage="transcribe",
                kind="progress",
                message=f"ASR 轮询状态：{task_status or 'RUNNING'}。",
                data={
                    "remote_task_id": remote_task_id,
                    "elapsed_seconds": elapsed_seconds,
                    "fetch_output": fetch_output,
                },
            )
            if task_status == "SUCCEEDED":
                break
            if task_status in {"FAILED", "CANCELED", "CANCELLED"}:
                raise EnglishCourseError("字幕转写任务失败，请稍后重试。")
            import threading

            threading.Event().wait(ASR_POLL_SECONDS)

        transcription_url = extract_transcription_url(final_fetch_output)
        if not transcription_url:
            raise EnglishCourseError("字幕转写成功，但结果地址为空。")
        try:
            response = requests.get(transcription_url, timeout=60)
            response.raise_for_status()
            payload = response.json()
        except (requests.RequestException, ValueError) as exc:
            logger.warning("english asr transcription download failed", exc_info=True)
            raise EnglishCourseError(f"下载字幕转写结果失败：{exc}") from exc
        normalized_payload = payload if isinstance(payload, dict) else {}
        append_generation_log_event(
            task_id=task_id,
            stage="transcribe",
            kind="response",
            message="已下载 ASR 结果。",
            data={
                "transcription_url": sanitize_url(transcription_url),
                "transcript_count": len(normalized_payload.get("transcripts") or []),
                "payload": normalized_payload,
            },
        )
        return normalized_payload


class DashscopeEnglishTranslator:
    def translate_sentences(
        self,
        sentences: list[dict[str, Any]],
        *,
        task_id: str,
        prompt_catalog: PromptCatalog,
        resolved_runtime: ResolvedAiRuntime | None = None,
    ) -> list[dict[str, Any]]:
        runtime = _resolve_legacy_dashscope_runtime(
            legacy_default_model=ENGLISH_TRANSLATION_MODEL,
            resolved_runtime=resolved_runtime,
        )
        if not str(runtime.api_key or "").strip():
            raise EnglishCourseError("未配置翻译模型对应的 Provider API Key，无法生成中文译文。")
        config = OpenAICompatibleChatConfig(
            api_key=str(runtime.api_key or "").strip(),
            base_url=str(runtime.base_url or "").strip(),
            model=runtime.model,
            temperature=0.0 if runtime.supports_temperature else None,
            timeout_seconds=120,
        )
        translated_by_index: dict[int, str] = {}
        total = len(sentences)
        for start in range(0, total, TRANSLATION_BATCH_SIZE):
            batch = sentences[start : start + TRANSLATION_BATCH_SIZE]
            translated_by_index.update(
                self.translate_sentence_batch_with_fallback(
                    config=config,
                    runtime_extra_payload=runtime.extra_payload,
                    batch=batch,
                    task_id=task_id,
                    prompt_catalog=prompt_catalog,
                )
            )
            translated_count = len(translated_by_index)
            append_generation_log_event(
                task_id=task_id,
                stage="translate",
                kind="progress",
                message=f"翻译进度 {translated_count}/{total}。",
                data={
                    "translated_count": translated_count,
                    "total": total,
                },
            )
        result: list[dict[str, Any]] = []
        for sentence in sentences:
            index = int(sentence["index"])
            result.append(
                {
                    **sentence,
                    "text_zh": str(translated_by_index.get(index) or "").strip(),
                }
            )
        return result

    def translate_sentence_batch_with_fallback(
        self,
        *,
        config: OpenAICompatibleChatConfig,
        runtime_extra_payload: dict[str, Any] | None,
        batch: list[dict[str, Any]],
        task_id: str,
        prompt_catalog: PromptCatalog,
    ) -> dict[int, str]:
        if not batch:
            return {}
        if len(batch) == 1:
            item = batch[0]
            return {
                int(item["index"]): self.translate_single_sentence(
                    config=config,
                    runtime_extra_payload=runtime_extra_payload,
                    sentence=item,
                    task_id=task_id,
                    prompt_catalog=prompt_catalog,
                )
            }
        try:
            return self.translate_sentence_batch(
                config=config,
                runtime_extra_payload=runtime_extra_payload,
                batch=batch,
                task_id=task_id,
                prompt_catalog=prompt_catalog,
            )
        except EnglishTranslationBatchMismatchError as exc:
            append_generation_log_event(
                task_id=task_id,
                stage="translate",
                kind="warning",
                message="批量翻译结果与输入不匹配，自动拆小重试。",
                data={
                    "indexes": [int(item["index"]) for item in batch],
                    "batch_size": len(batch),
                    "error": str(exc),
                },
            )
            midpoint = max(1, len(batch) // 2)
            left = self.translate_sentence_batch_with_fallback(
                config=config,
                runtime_extra_payload=runtime_extra_payload,
                batch=batch[:midpoint],
                task_id=task_id,
                prompt_catalog=prompt_catalog,
            )
            right = self.translate_sentence_batch_with_fallback(
                config=config,
                runtime_extra_payload=runtime_extra_payload,
                batch=batch[midpoint:],
                task_id=task_id,
                prompt_catalog=prompt_catalog,
            )
            return {**left, **right}

    def translate_sentence_batch(
        self,
        *,
        config: OpenAICompatibleChatConfig,
        runtime_extra_payload: dict[str, Any] | None,
        batch: list[dict[str, Any]],
        task_id: str,
        prompt_catalog: PromptCatalog,
    ) -> dict[int, str]:
        source_text = "\n".join(
            f"[S{int(item['index']):04d}] {str(item['text_en'] or '').strip()}" for item in batch
        )
        translation_options = {
            "source_lang": "English",
            "target_lang": "Chinese",
        }
        request_payload = {
            "sentence_indexes": [int(item["index"]) for item in batch],
            "source_text": source_text,
            "translation_options": translation_options,
        }
        log_id = begin_external_ai_call_log(
            feature="英语课程生成",
            operation="english_sentence_translation_batch",
            provider="dashscope",
            base_url=config.base_url,
            model=config.model,
            job_id=task_id,
            request_payload=request_payload,
        )
        append_generation_log_event(
            task_id=task_id,
            stage="translate",
            kind="request",
            message=f"开始批量翻译 {len(batch)} 句。",
            data={
                "indexes": request_payload["sentence_indexes"],
                "source_text": source_text,
                "translation_options": translation_options,
                "ai_call_log_id": log_id,
            },
        )
        try:
            response_text = call_chat_completion_text(
                config=config,
                messages=[
                    {
                        "role": "user",
                        "content": prompt_catalog.render(
                            "ai_prompt_english_translation_batch",
                            {"source_text": source_text},
                        ),
                    }
                ],
                extra_payload={
                    **(runtime_extra_payload or {}),
                    "translation_options": translation_options,
                },
            )
            parsed = parse_translation_batch_response(response_text, batch=batch)
            complete_external_ai_call_log(
                log_id,
                response_payload={
                    "response_text": response_text,
                    "parsed_items": parsed,
                },
            )
            append_generation_log_event(
                task_id=task_id,
                stage="translate",
                kind="response",
                message="批量翻译完成。",
                data={
                    "indexes": request_payload["sentence_indexes"],
                    "response_text": response_text,
                    "parsed_items": parsed,
                    "ai_call_log_id": log_id,
                },
            )
            return parsed
        except EnglishTranslationBatchMismatchError as exc:
            fail_external_ai_call_log(
                log_id,
                error_payload={
                    "error": str(exc),
                },
            )
            raise
        except (OpenAICompatibleError, EnglishCourseError) as exc:
            fail_external_ai_call_log(
                log_id,
                error_payload={
                    "error": str(exc),
                },
            )
            logger.warning("english batch translation failed", exc_info=True)
            raise EnglishCourseError(f"翻译句子失败：{exc}") from exc

    def translate_single_sentence(
        self,
        *,
        config: OpenAICompatibleChatConfig,
        runtime_extra_payload: dict[str, Any] | None,
        sentence: dict[str, Any],
        task_id: str,
        prompt_catalog: PromptCatalog,
    ) -> str:
        source_text = str(sentence.get("text_en") or "").strip()
        translation_options = {
            "source_lang": "English",
            "target_lang": "Chinese",
        }
        request_payload = {
            "sentence_index": int(sentence["index"]),
            "source_text": source_text,
            "translation_options": translation_options,
        }
        log_id = begin_external_ai_call_log(
            feature="英语课程生成",
            operation="english_sentence_translation_single",
            provider="dashscope",
            base_url=config.base_url,
            model=config.model,
            job_id=task_id,
            request_payload=request_payload,
        )
        append_generation_log_event(
            task_id=task_id,
            stage="translate",
            kind="request",
            message=f"降级为单句翻译：{int(sentence['index'])}。",
            data={
                "index": int(sentence["index"]),
                "source_text": source_text,
                "translation_options": translation_options,
                "ai_call_log_id": log_id,
            },
        )
        try:
            response_text = call_chat_completion_text(
                config=config,
                messages=[
                    {
                        "role": "user",
                        "content": prompt_catalog.render(
                            "ai_prompt_english_translation_single",
                            {"source_text": source_text},
                        ),
                    }
                ],
                extra_payload={
                    **(runtime_extra_payload or {}),
                    "translation_options": translation_options,
                },
            ).strip()
            if not response_text:
                raise EnglishCourseError("单句翻译结果为空。")
            complete_external_ai_call_log(
                log_id,
                response_payload={
                    "response_text": response_text,
                    "translation": response_text,
                },
            )
            append_generation_log_event(
                task_id=task_id,
                stage="translate",
                kind="response",
                message=f"单句翻译完成：{int(sentence['index'])}。",
                data={
                    "index": int(sentence["index"]),
                    "response_text": response_text,
                    "ai_call_log_id": log_id,
                },
            )
            return response_text
        except EnglishCourseError as exc:
            fail_external_ai_call_log(
                log_id,
                error_payload={
                    "error": str(exc),
                },
            )
            raise
        except OpenAICompatibleError as exc:
            fail_external_ai_call_log(
                log_id,
                error_payload={
                    "error": str(exc),
                },
            )
            logger.warning("english single translation failed", exc_info=True)
            raise EnglishCourseError(f"翻译句子失败：{exc}") from exc


def parse_translation_batch_response(
    response_text: str,
    *,
    batch: list[dict[str, Any]],
) -> dict[int, str]:
    expected_indexes = [int(item["index"]) for item in batch]
    parsed: dict[int, str] = {}
    for raw_line in response_text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        match = TRANSLATION_LINE_RE.match(line)
        if not match:
            continue
        index = int(match.group("index"))
        text = match.group("text").strip()
        parsed[index] = text
    if sorted(parsed.keys()) != sorted(expected_indexes):
        raise EnglishTranslationBatchMismatchError(
            f"翻译返回的编号与输入不一致，expected={expected_indexes}, got={sorted(parsed.keys())}"
        )
    if any(not parsed[index] for index in expected_indexes):
        raise EnglishTranslationBatchMismatchError("翻译返回存在空译文。")
    return parsed


def resolve_dashscope_sdk_base_url(base_url: str) -> str:
    normalized = str(base_url or "").strip().rstrip("/")
    if not normalized:
        return "https://dashscope.aliyuncs.com/api/v1"
    if normalized.endswith("/compatible-mode/v1"):
        return normalized[: -len("/compatible-mode/v1")] + "/api/v1"
    if normalized.endswith("/v1"):
        return normalized[: -len("/v1")] + "/api/v1"
    return normalized


def to_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if hasattr(value, "to_dict"):
        try:
            parsed = value.to_dict()
            if isinstance(parsed, dict):
                return parsed
        except (TypeError, ValueError, AttributeError):
            logger.debug("dashscope response to_dict failed", exc_info=True)
    return {}


def resolve_file_id(upload_output: dict[str, Any]) -> str:
    uploaded_files = upload_output.get("uploaded_files")
    if isinstance(uploaded_files, list):
        for item in uploaded_files:
            if isinstance(item, dict):
                file_id = str(item.get("file_id") or "").strip()
                if file_id:
                    return file_id
    return str(upload_output.get("file_id") or "").strip()


def resolve_signed_url(meta_output: dict[str, Any]) -> str:
    direct_url = str(meta_output.get("url") or "").strip()
    if direct_url:
        return direct_url
    files_payload = meta_output.get("files")
    if isinstance(files_payload, list):
        for item in files_payload:
            if isinstance(item, dict):
                candidate = str(item.get("url") or "").strip()
                if candidate:
                    return candidate
    return ""


def extract_transcription_url(fetch_output: dict[str, Any]) -> str:
    result = fetch_output.get("result")
    if isinstance(result, dict):
        url = str(result.get("transcription_url") or "").strip()
        if url:
            return url
    results = fetch_output.get("results")
    if isinstance(results, list):
        for item in results:
            if not isinstance(item, dict):
                continue
            if str(item.get("subtask_status") or "").strip().upper() != "SUCCEEDED":
                continue
            url = str(item.get("transcription_url") or "").strip()
            if url:
                return url
    return ""


def sanitize_url(url: str) -> str:
    if not url:
        return ""
    parsed = urlsplit(url)
    if not parsed.query:
        return url
    sanitized_query = urlencode(
        [
            (
                key,
                "***"
                if any(token in key.lower() for token in ("token", "signature", "key", "auth"))
                else value,
            )
            for key, value in parse_qsl(parsed.query, keep_blank_values=True)
        ]
    )
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, sanitized_query, parsed.fragment))
