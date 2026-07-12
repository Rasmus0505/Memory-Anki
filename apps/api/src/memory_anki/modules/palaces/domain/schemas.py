from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class PegIn(BaseModel):
    id: int | None = None
    parent_id: int | None = None
    name: str = ""
    content: str = ""
    sort_order: int = 0
    children: list[PegIn] = Field(default_factory=list)


class PalaceCreate(BaseModel):
    title: str = ""
    description: str = ""
    pegs: list[PegIn] = Field(default_factory=list)


class PalaceUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    created_at: datetime | None = None
    pegs: list[PegIn] | None = None


class PegOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    content: str
    sort_order: int
    parent_id: int | None = None
    children: list[PegOut] = Field(default_factory=list)


class AttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    filename: str
    original_name: str
    file_size: int


class PalaceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description: str
    created_at: datetime
    updated_at: datetime
    pegs: list[PegOut] = Field(default_factory=list)
    attachments: list[AttachmentOut] = Field(default_factory=list)


class ReviewScheduleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    palace_id: int
    scheduled_date: date
    interval_days: int
    algorithm_used: str
    completed: bool
    review_number: int
    palace: PalaceOut | None = None
