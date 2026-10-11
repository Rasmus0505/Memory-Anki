from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class LiveStudyCommand(BaseModel):
    model_config = ConfigDict(extra="ignore")

    type: str = "publish"
    client_id: str = Field(min_length=1, max_length=80)
    operation_id: str = Field(min_length=1, max_length=120)
    take_control: bool = False
    route: str | None = Field(default=None, max_length=500)
    surface: str | None = Field(default=None, max_length=40)
    view: Any = None
