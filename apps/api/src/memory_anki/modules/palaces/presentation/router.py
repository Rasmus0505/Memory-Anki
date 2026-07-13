from fastapi import APIRouter

from memory_anki.core.config import ATTACHMENTS_DIR
from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.backups.api import maybe_create_rolling_backup
from memory_anki.modules.palaces.application.editor_state_service import (
    save_palace_editor_state,
)
from memory_anki.modules.palaces.presentation.attachment_router import (
    router as attachment_router,
)
from memory_anki.modules.palaces.presentation.catalog_router import (
    router as catalog_router,
)
from memory_anki.modules.palaces.presentation.core_router import router as core_router
from memory_anki.modules.palaces.presentation.editor_router import (
    router as editor_router,
)
from memory_anki.modules.palaces.presentation.practice_progress_router import (
    router as practice_progress_router,
)
from memory_anki.modules.palaces.presentation.segment_router import (
    router as segment_router,
)
from memory_anki.modules.palaces.presentation.version_router import (
    router as version_router,
)

__all__ = [
    "ATTACHMENTS_DIR",
    "maybe_create_rolling_backup",
    "router",
    "save_palace_editor_state",
    "session_dep",
]

router = APIRouter(tags=["palaces"])

router.include_router(catalog_router)
router.include_router(core_router)
router.include_router(editor_router)
router.include_router(segment_router)
router.include_router(practice_progress_router)
router.include_router(version_router)
router.include_router(attachment_router)
