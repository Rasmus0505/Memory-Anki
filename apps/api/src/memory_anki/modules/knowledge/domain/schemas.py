from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class SubjectCreate(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str = ""
    color: str = "#6366f1"
    sort_order: int = 0


class SubjectUpdate(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str | None = None
    color: str | None = None
    sort_order: int | None = None


class ChapterCreate(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str = ""
    parent_id: int | None = None
    notes: str = ""
    sort_order: int = 0


class ChapterUpdate(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str | None = None
    notes: str | None = None
    sort_order: int | None = None
    parent_id: int | None = None
