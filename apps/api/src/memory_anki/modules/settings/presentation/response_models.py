from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class RuntimeHealthResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    ok: bool
    startup_mode: str
    runtime_snapshot: str | None = None
    release_id: str | None = None
    started_at: str | None = None


class RuntimeInfoResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    channel: str | None = None
    commit: str | None = None
    short_commit: str | None = None
    last_started_at: str | None = None
    app_home: str | None = None
    app_home_source: str | None = None
    runtime_snapshot: str | None = None
    release_id: str | None = None
    frontend_entry_asset: str | None = None
    frontend_bundle_hash: str | None = None
    storage_mode: str | None = None
    managed_storage_items: list[dict[str, Any]] = Field(default_factory=list)
    backup_covered_items: list[str] = Field(default_factory=list)
    active_runtime_instances: list[dict[str, Any]] = Field(default_factory=list)


class SettingsResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    default_review_mode: str | None = None
    ebbinghaus_intervals: str | None = None
    daily_max_reviews: str | None = None
