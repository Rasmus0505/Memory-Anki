from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel


class PegIn(BaseModel):
    id: Optional[int] = None
    parent_id: Optional[int] = None
    name: str = ""
    content: str = ""
    sort_order: int = 0
    children: list["PegIn"] = []


class PalaceCreate(BaseModel):
    title: str = ""
    description: str = ""
    pegs: list[PegIn] = []


class PalaceUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    created_at: Optional[datetime] = None
    pegs: Optional[list[PegIn]] = None


class ReviewSubmit(BaseModel):
    score: int
    duration_seconds: int = 0


class AlgorithmChange(BaseModel):
    algorithm: str
    scope: str = "future_only"


class ConfigUpdate(BaseModel):
    key: str
    value: str


class ImportData(BaseModel):
    format: str = "json"
    content: str


class PegOut(BaseModel):
    id: int
    name: str
    content: str
    sort_order: int
    parent_id: Optional[int] = None
    children: list["PegOut"] = []

    class Config:
        from_attributes = True


class AttachmentOut(BaseModel):
    id: int
    filename: str
    original_name: str
    file_size: int

    class Config:
        from_attributes = True


class PalaceOut(BaseModel):
    id: int
    title: str
    description: str
    created_at: datetime
    updated_at: datetime
    pegs: list[PegOut] = []
    attachments: list[AttachmentOut] = []

    class Config:
        from_attributes = True


class ChapterCreate(BaseModel):
    name: str = ""
    parent_id: Optional[int] = None
    notes: str = ""
    sort_order: int = 0


class ChapterUpdate(BaseModel):
    name: Optional[str] = None
    notes: Optional[str] = None
    sort_order: Optional[int] = None
    parent_id: Optional[int] = None


class ReviewScheduleOut(BaseModel):
    id: int
    palace_id: int
    scheduled_date: date
    interval_days: int
    algorithm_used: str
    completed: bool
    review_number: int
    palace: Optional[PalaceOut] = None

    class Config:
        from_attributes = True
