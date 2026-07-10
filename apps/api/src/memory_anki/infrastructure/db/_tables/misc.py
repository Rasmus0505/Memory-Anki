"""Cross-cutting ORM tables: study sessions, jobs, logs, config."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from memory_anki.core.time import utc_now_naive

from ._base import Base


class StudySession(Base):
    __tablename__ = "study_sessions"
    __table_args__ = (
        Index("ix_study_sessions_status_updated", "status", "updated_at"),
        Index("ix_study_sessions_scene_started", "scene", "started_at"),
        Index(
            "ix_study_sessions_target_status",
            "target_type",
            "target_id",
            "status",
        ),
        Index("ix_study_sessions_palace_started", "palace_id", "started_at"),
        Index("ix_study_sessions_deleted_started", "deleted_at", "started_at"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="active")
    scene: Mapped[str] = mapped_column(String(40), nullable=False)
    target_type: Mapped[str] = mapped_column(String(40), nullable=False, default="none")
    target_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    palace_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("palaces.id", ondelete="SET NULL"),
        nullable=True,
    )
    palace_segment_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("palace_segments.id", ondelete="SET NULL"),
        nullable=True,
    )
    mini_palace_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("palace_mini_palaces.id", ondelete="SET NULL"),
        nullable=True,
    )
    english_course_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    english_reading_material_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    effective_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    idle_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    pause_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completion_method: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    progress_json: Mapped[str] = mapped_column(Text, default="{}")
    events_json: Mapped[str] = mapped_column(Text, default="[]")
    summary_json: Mapped[str] = mapped_column(Text, default="{}")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    deleted_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        default=utc_now_naive,
        onupdate=utc_now_naive,
    )


class MindMapImportJob(Base):
    __tablename__ = "mindmap_import_jobs"
    __table_args__ = (
        Index(
            "ix_mindmap_import_jobs_entity_fingerprint",
            "entity_key",
            "fingerprint",
        ),
        Index(
            "ix_mindmap_import_jobs_entity_created",
            "entity_key",
            "created_at",
        ),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    entity_key: Mapped[str] = mapped_column(String(200), nullable=False)
    source_kind: Mapped[str] = mapped_column(String(40), nullable=False)
    mode: Mapped[str] = mapped_column(String(20), nullable=False, default="mindmap")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    stage: Mapped[str] = mapped_column(String(20), nullable=False, default="prepared")
    fingerprint: Mapped[str] = mapped_column(String(128), nullable=False)
    source_meta_json: Mapped[str] = mapped_column(Text, default="{}")
    result_json: Mapped[str] = mapped_column(Text, default="{}")
    error_json: Mapped[str] = mapped_column(Text, default="{}")
    usage_json: Mapped[str] = mapped_column(Text, default="{}")
    progress_json: Mapped[str] = mapped_column(Text, default="{}")
    pause_requested: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        default=utc_now_naive,
        onupdate=utc_now_naive,
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ExternalAiCallLog(Base):
    __tablename__ = "external_ai_call_logs"
    __table_args__ = (
        Index("ix_external_ai_call_logs_job_created", "job_id", "created_at"),
        Index("ix_external_ai_call_logs_palace_created", "palace_id", "created_at"),
        Index("ix_external_ai_call_logs_created", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    feature: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    operation: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    job_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    palace_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="started")
    provider: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    base_url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    model: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    request_id: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    scene: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    prompt_version_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    structured_output_mode: Mapped[str] = mapped_column(String(24), nullable=False, default="")
    finish_reason: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cached_input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    estimated_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    first_token_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    error_kind: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    repaired_from_log_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    request_json: Mapped[str] = mapped_column(Text, default="{}")
    response_json: Mapped[str] = mapped_column(Text, default="{}")
    error_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        default=utc_now_naive,
        onupdate=utc_now_naive,
    )


class AiPromptVersion(Base):
    __tablename__ = "ai_prompt_versions"
    __table_args__ = (
        Index("ix_ai_prompt_versions_key_created", "prompt_key", "created_at"),
        Index("ix_ai_prompt_versions_key_status", "prompt_key", "status"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    prompt_key: Mapped[str] = mapped_column(String(120), nullable=False)
    template: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="candidate")
    source: Mapped[str] = mapped_column(String(24), nullable=False, default="custom")
    eval_summary_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class AiEvalRun(Base):
    __tablename__ = "ai_eval_runs"
    __table_args__ = (Index("ix_ai_eval_runs_prompt_created", "prompt_key", "created_at"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    prompt_key: Mapped[str] = mapped_column(String(120), nullable=False)
    candidate_version_id: Mapped[str] = mapped_column(String(64), nullable=False)
    baseline_version_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="completed")
    case_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    schema_success_rate: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    assertion_success_rate: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    baseline_assertion_success_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    critical_passed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    gate_passed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    results_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Config(Base):
    __tablename__ = "config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    value: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)


class AiModelCatalog(Base):
    __tablename__ = "ai_model_catalog"
    __table_args__ = (
        Index("ix_ai_model_catalog_type_active", "model_type", "is_active"),
        Index("ix_ai_model_catalog_provider_active", "provider", "is_active"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(String(240), nullable=False, default="")
    provider: Mapped[str] = mapped_column(String(40), nullable=False, default="dashscope")
    model_type: Mapped[str] = mapped_column(String(24), nullable=False, default="llm")
    has_vision: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    supports_thinking: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    supports_temperature: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    structured_output_mode: Mapped[str] = mapped_column(
        String(24), nullable=False, default="json_object"
    )
    input_price_per_million: Mapped[float | None] = mapped_column(Float, nullable=True)
    output_price_per_million: Mapped[float | None] = mapped_column(Float, nullable=True)
    cached_input_price_per_million: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_builtin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        default=utc_now_naive,
        onupdate=utc_now_naive,
    )
