from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class PalaceSummaryResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int | None = None
    title: str | None = None
    description: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    archived: bool | None = None
    needs_practice: bool | None = None
    primary_chapter_id: int | None = None


class PalaceDetailResponse(PalaceSummaryResponse):
    error: str | None = None


class PaginatedPalaceListResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    items: list[PalaceSummaryResponse]
    total: int
    limit: int
    offset: int


PalaceListResponse = list[PalaceSummaryResponse] | PaginatedPalaceListResponse


class DeleteOkResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    ok: bool
