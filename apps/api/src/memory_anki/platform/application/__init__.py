"""Cross-context runtime contracts and adapters."""

from .ai_content import build_image_content_part, extract_first_json_object
from .ai_runtime import (
    AiRuntimeOptions,
    AiRuntimeProvider,
    PersistedAiRuntime,
    ResolvedAiRuntime,
    persist_ai_runtime,
    serialize_resolved_ai_runtime,
)
from .mutations import (
    MUTATION_ID_HEADER,
    MutationIdentity,
    MutationResponseStore,
    mutation_identity_from_headers,
)
from .prompt_catalog import PromptCatalog
from .unit_of_work import UnitOfWork

__all__ = [
    "AiRuntimeOptions",
    "build_image_content_part",
    "extract_first_json_object",
    "AiRuntimeProvider",
    "MUTATION_ID_HEADER",
    "MutationIdentity",
    "MutationResponseStore",
    "PersistedAiRuntime",
    "PromptCatalog",
    "ResolvedAiRuntime",
    "UnitOfWork",
    "mutation_identity_from_headers",
    "persist_ai_runtime",
    "serialize_resolved_ai_runtime",
]
