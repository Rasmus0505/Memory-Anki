from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import SubjectDocument


def get_job_artifact_dir(import_jobs_dir: Path, job_id: str) -> Path:
    return import_jobs_dir / job_id


def ensure_rendered_pdf_pages(
    session: Session,
    *,
    artifact_dir: Path,
    source_meta: dict[str, Any],
    get_subject_document_by_id_fn,
    render_selected_pdf_pages_fn,
    ensure_rendered_page_size_fn,
    import_error_cls: type[Exception],
) -> list[tuple[int, bytes, str]]:
    rendered_pages_meta_path = artifact_dir / "rendered_pages.json"
    if rendered_pages_meta_path.exists():
        return load_rendered_pdf_pages(artifact_dir, import_error_cls=import_error_cls)

    document_id = int(source_meta.get("subject_document_id") or 0)
    document: SubjectDocument | None = get_subject_document_by_id_fn(session, document_id)
    if not document:
        raise import_error_cls("未找到所选 PDF 资料，请重新创建任务。")
    page_selection = [int(page) for page in source_meta.get("page_selection") or []]
    rendered_pages = render_selected_pdf_pages_fn(
        document,
        page_numbers=page_selection,
        kind="preview",
    )
    ensure_rendered_page_size_fn(rendered_pages)
    for _, image_bytes, filename in rendered_pages:
        write_bytes(artifact_dir / filename, image_bytes)
    write_json(
        rendered_pages_meta_path,
        [
            {"page_number": page_number, "filename": filename}
            for page_number, _, filename in rendered_pages
        ],
    )
    return rendered_pages


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


def load_rendered_pdf_pages(
    artifact_dir: Path,
    *,
    import_error_cls: type[Exception],
) -> list[tuple[int, bytes, str]]:
    rendered_pages_meta = read_json(artifact_dir / "rendered_pages.json")
    items: list[tuple[int, bytes, str]] = []
    for item in rendered_pages_meta:
        filename = str(item.get("filename") or "")
        page_number = int(item.get("page_number") or 0)
        path = artifact_dir / filename
        if not path.exists():
            raise import_error_cls("PDF 渲染缓存缺失，请重新创建任务。")
        items.append((page_number, path.read_bytes(), filename))
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
