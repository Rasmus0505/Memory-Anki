from __future__ import annotations

from memory_anki.core.prompt_text import truncate_prompt_text as truncate_prompt_text
from memory_anki.modules.settings.application.ai_prompt_templates import (
    IMPORT_BATCH_MINDMAP_PROMPT,
    IMPORT_IMAGE_MINDMAP_PROMPT,
    IMPORT_IMAGE_TEXT_PROMPT,
)

PROMPT = IMPORT_IMAGE_MINDMAP_PROMPT

BATCH_PROMPT = IMPORT_BATCH_MINDMAP_PROMPT

TEXT_PROMPT = IMPORT_IMAGE_TEXT_PROMPT
