from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class AiContextNode(BaseModel):
    uid: str = Field(min_length=1, max_length=160)
    title: str = ""
    body: str = ""
    note: str = ""
    parent_uid: str | None = None
    depth: int = Field(default=0, ge=0)
    learning_state: dict[str, Any] | None = None


class AiContextEnvelope(BaseModel):
    source_type: str = Field(min_length=1, max_length=40)
    source_entity_id: str = Field(min_length=1, max_length=120)
    source_revision: str = Field(min_length=1, max_length=120)
    scope: Literal["node", "ancestors", "subtree", "review", "full", "manual"]
    title: str = ""
    node_uids: list[str] = Field(default_factory=list)
    nodes: list[AiContextNode] = Field(default_factory=list)
    include_notes: bool = True
    include_ancestors: bool = True
    summary: str = ""
    estimated_tokens: int = Field(default=0, ge=0)
    truncation: list[str] = Field(default_factory=list)


class AiRuntimeOptionsInput(BaseModel):
    model: str | None = None
    thinking_enabled: bool | None = None
    prompt_override: str | None = None


class AiContextSelection(BaseModel):
    kind: Literal["mindmap", "quiz_bank", "source"]
    enabled: bool = True
    source_entity_id: str | None = Field(default=None, max_length=120)
    source_revision: str | None = Field(default=None, max_length=120)
    label: str = Field(default="", max_length=160)
    content: str = Field(default="", max_length=120000)
    truncated: bool = False


class AiRunDraft(BaseModel):
    task_key: Literal["ask", "explain", "quiz", "correct"]
    context: AiContextEnvelope
    user_prompt: str = Field(default="", max_length=12000)
    output_type: str = Field(default="text", max_length=40)
    ai_options: AiRuntimeOptionsInput | None = None
    scenario_key: str = Field(default="review_ai_learning", min_length=1, max_length=80)
    entrypoint_key: str = Field(default="review-ai-learning", min_length=1, max_length=120)
    context_selections: list[AiContextSelection] = Field(default_factory=list)
    owner_id: str = Field(min_length=1, max_length=120)
    operation_id: str = Field(min_length=1, max_length=36)
    thread_id: str | None = Field(default=None, max_length=36)
    parent_run_id: str | None = Field(default=None, max_length=36)
    retry_of_run_id: str | None = Field(default=None, max_length=36)
    review_session_id: int | None = None
    palace_id: int | None = None


class AiRunFeedback(BaseModel):
    feedback: Literal["helpful", "unclear", "dismissed", ""]


class AiRunApplication(BaseModel):
    status: Literal["accepted", "applied", "dismissed"]
    result: dict[str, Any] = Field(default_factory=dict)


class AiRunItemDecision(BaseModel):
    decision: Literal["accepted", "rejected", "pending"]
