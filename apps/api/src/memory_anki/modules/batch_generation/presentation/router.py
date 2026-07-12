from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from memory_anki.modules.batch_generation.application.dependencies import workspace_service_dep
from memory_anki.modules.batch_generation.application.workspace_service import BatchWorkspaceService

router = APIRouter(prefix="/batch-generation", tags=["batch-generation"])


class CreateWorkspaceRequest(BaseModel):
    title: str = "整书批量生成"


class UpdateSectionRequest(BaseModel):
    expected_revision: int = Field(ge=1)
    title: str | None = None
    start_page: int | None = Field(default=None, ge=1)
    end_page: int | None = Field(default=None, ge=1)
    output_mode: Literal["palace", "quiz", "both", "skip"] | None = None
    excluded: bool | None = None
    existing_chapter_id: int | None = None
    existing_palace_id: int | None = None


class ConfirmOutlineRequest(BaseModel):
    representative_section_id: str


class PromptPreviewRequest(BaseModel):
    kind: Literal["palace", "quiz"]
    model: str
    system_prompt: str
    user_prompt: str


class SaveDraftRequest(BaseModel):
    kind: Literal["palace", "quiz"]
    operation_id: str
    content: dict[str, Any]


def _translate_error(exc: Exception) -> HTTPException:
    if isinstance(exc, KeyError):
        return HTTPException(status_code=404, detail=str(exc).strip("'"))
    if isinstance(exc, RuntimeError):
        return HTTPException(status_code=409, detail=str(exc))
    return HTTPException(status_code=400, detail=str(exc))


@router.post("/workspaces")
def create_workspace(payload: CreateWorkspaceRequest, service: BatchWorkspaceService = Depends(workspace_service_dep)):
    return service.create_workspace(payload.title)


@router.get("/workspaces/{workspace_id}")
def get_workspace(workspace_id: str, service: BatchWorkspaceService = Depends(workspace_service_dep)):
    try:
        return service.snapshot(workspace_id)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.post("/workspaces/{workspace_id}/assets")
async def upload_assets(
    workspace_id: str,
    role: Literal["textbook", "quiz"] = Form(...),
    files: list[UploadFile] = File(...),
    service: BatchWorkspaceService = Depends(workspace_service_dep),
):
    try:
        snapshot = None
        for upload in files:
            if not upload.filename or not upload.filename.lower().endswith(".pdf"):
                raise ValueError("仅支持 PDF 文件")
            with tempfile.TemporaryDirectory(prefix="memory-anki-batch-") as temp_dir:
                path = Path(temp_dir) / Path(upload.filename).name
                path.write_bytes(await upload.read())
                snapshot = service.add_pdf(workspace_id, path, role)
        return snapshot
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.patch("/sections/{section_id}")
def update_section(section_id: str, payload: UpdateSectionRequest, service: BatchWorkspaceService = Depends(workspace_service_dep)):
    changes = payload.model_dump(exclude={"expected_revision"}, exclude_none=True)
    try:
        return service.update_section(section_id, changes, payload.expected_revision)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.post("/books/{book_id}/confirm-outline")
def confirm_outline(book_id: str, payload: ConfirmOutlineRequest, service: BatchWorkspaceService = Depends(workspace_service_dep)):
    try:
        return service.confirm_outline(book_id, payload.representative_section_id)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.post("/sections/{section_id}/prompt-preview")
def prompt_preview(section_id: str, payload: PromptPreviewRequest, service: BatchWorkspaceService = Depends(workspace_service_dep)):
    try:
        return service.prompt_preview(section_id, payload.kind, payload.model, payload.system_prompt, payload.user_prompt)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.put("/sections/{section_id}/draft")
def save_draft(section_id: str, payload: SaveDraftRequest, service: BatchWorkspaceService = Depends(workspace_service_dep)):
    try:
        return service.save_draft(section_id, payload.kind, payload.content, payload.operation_id)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.post("/workspaces/{workspace_id}/publish-plan")
def build_publish_plan(workspace_id: str, service: BatchWorkspaceService = Depends(workspace_service_dep)):
    try:
        return service.build_publish_plan(workspace_id)
    except Exception as exc:
        raise _translate_error(exc) from exc
