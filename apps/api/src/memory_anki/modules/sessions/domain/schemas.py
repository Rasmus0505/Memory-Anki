from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class StudySessionCreate(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str | None = None
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
    effective_seconds: int | None = None
    idle_seconds: int | None = None
    pause_count: int | None = None
    completion_method: str | None = None
    progress: dict[str, Any] | None = None
    summary: dict[str, Any] | None = None


class StudySessionAbandon(BaseModel):
    model_config = ConfigDict(extra="allow")

    ended_at: str | None = None
    completion_method: str | None = None


class StudySessionBulkDelete(BaseModel):
    model_config = ConfigDict(extra="allow")

    ids: list[Any] = Field(default_factory=list)


class PracticeProgressUpsert(BaseModel):
    model_config = ConfigDict(extra="allow")

    reveal_map: dict[str, Any] | None = None
    red_node_ids: list[Any] | None = None
    completed: bool | None = None
