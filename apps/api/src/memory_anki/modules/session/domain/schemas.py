from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class StudySessionCreate(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str | None = None
    session_key: str | None = None
    client_revision: int | None = Field(default=None, ge=0)
    operation_id: str | None = None
    status: str | None = None
    scene: str | None = None
    target_type: str | None = None
    target_id: int | None = None
    palace_id: int | None = None
    palace_segment_id: int | None = None
    mini_palace_id: int | None = None
    english_course_id: int | None = None
    english_reading_material_id: int | None = None
    title: str | None = None
    started_at: str | None = None
    ended_at: str | None = None
    effective_seconds: int | None = None
    duration_edited: bool | None = None
    idle_seconds: int | None = None
    pause_count: int | None = None
    completion_method: str | None = None
    progress: dict[str, Any] | None = None
    events: list[Any] | None = None
    summary: dict[str, Any] | None = None


class StudySessionPatch(StudySessionCreate):
    pass


class StudySessionEventsAppend(BaseModel):
    model_config = ConfigDict(extra="allow")

    events: list[Any] | None = None


class StudySessionComplete(BaseModel):
    model_config = ConfigDict(extra="allow")

    ended_at: str | None = None
    session_key: str | None = None
    client_revision: int | None = Field(default=None, ge=0)
    operation_id: str | None = None
    effective_seconds: int | None = None
    duration_edited: bool | None = None
    idle_seconds: int | None = None
    pause_count: int | None = None
    completion_method: str | None = None
    progress: dict[str, Any] | None = None
    summary: dict[str, Any] | None = None


class StudySessionAbandon(BaseModel):
    model_config = ConfigDict(extra="allow")

    ended_at: str | None = None
    session_key: str | None = None
    client_revision: int | None = Field(default=None, ge=0)
    operation_id: str | None = None
    completion_method: str | None = None


class StudySessionBulkDelete(BaseModel):
    model_config = ConfigDict(extra="allow")

    ids: list[Any] = Field(default_factory=list)


class LiveStudyCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str = "publish"
    client_id: str = Field(min_length=1, max_length=80)
    operation_id: str = Field(min_length=1, max_length=120)
    take_control: bool = False
    route: str | None = Field(default=None, max_length=500)
    surface: str | None = Field(default=None, max_length=40)
    view: Any = None
    timer: dict[str, Any] | None = None
