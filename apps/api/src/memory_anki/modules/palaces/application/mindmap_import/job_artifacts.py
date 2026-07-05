from __future__ import annotations

import json
from pathlib import Path
from typing import Any

def get_job_artifact_dir(import_jobs_dir: Path, job_id: str) -> Path:
    return import_jobs_dir / job_id


def load_batch_image_items(
    artifact_dir: Path,
    source_meta: dict[str, Any],
    *,
    import_error_cls: type[Exception],
) -> list[tuple[bytes, str | None]]:
    images = source_meta.get("images") or []
    items: list[tuple[bytes, str | None]] = []
    for index, image_meta in enumerate(images):
        path = next(iter(sorted(artifact_dir.glob(f"input-{index}.*"))), None)
        if path is None:
            raise import_error_cls("导入图片工件缺失，请重新创建任务。")
        items.append((path.read_bytes(), str(image_meta.get("filename") or path.name)))
    return items


def find_first_input_file(artifact_dir: Path) -> Path | None:
    for path in sorted(artifact_dir.glob("input.*")):
        return path
    return None


def sync_job_progress_artifact(artifact_dir: Path, preview_text: str) -> None:
    write_text(artifact_dir / "preview_text.txt", preview_text)


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json_dump(payload), encoding="utf-8")


def write_text(path: Path, text: str) -> None:
    path.write_text(str(text), encoding="utf-8")


def write_bytes(path: Path, data: bytes) -> None:
    path.write_bytes(data)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def json_dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def json_load(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return default
    return parsed if parsed is not None else default
