from __future__ import annotations

import hashlib
import mimetypes
from typing import Any

from .job_artifacts import json_dump
from .job_state import MODE_MINDMAP, MODE_TEXT


def build_fingerprint(
    *,
    entity_key: str,
    source_kind: str,
    mode: str,
    source_meta: dict[str, Any],
) -> str:
    payload = {
        "entity_key": entity_key,
        "source_kind": source_kind,
        "mode": mode,
        "source_meta": source_meta,
    }
    return hashlib.sha256(json_dump(payload).encode("utf-8")).hexdigest()


def hash_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def guess_extension_from_filename(filename: str | None) -> str:
    guess = (
        mimetypes.guess_extension(mimetypes.guess_type(filename or "")[0] or "")
        or ".png"
    )
    return guess if guess.startswith(".") else ".png"


def ensure_image_bytes(
    image_bytes: bytes,
    *,
    max_image_bytes: int,
    import_error_cls: type[Exception],
) -> None:
    if not image_bytes:
        raise import_error_cls("未读取到图片内容，请重新上传后再试。")
    if len(image_bytes) > max_image_bytes:
        raise import_error_cls("图片超过 8MB，请压缩后重试。")


def validate_entity_key(entity_key: str, *, import_error_cls: type[Exception]) -> None:
    if not str(entity_key or "").strip():
        raise import_error_cls("缺少 entity_key，无法创建可恢复导入任务。")


def validate_mode(mode: str, *, import_error_cls: type[Exception]) -> None:
    if mode not in {MODE_MINDMAP, MODE_TEXT}:
        raise import_error_cls("导入模式无效。")

