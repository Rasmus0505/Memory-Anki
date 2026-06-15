"""Public ORM entry point (backwards-compatible facade).

Historically every ORM table lived in this single 1000+ line file. The tables
are now split by domain under ``infrastructure/db/_tables/`` while sharing one
``Base``/``engine``. This module re-exports every symbol so the 86 existing
``from memory_anki.infrastructure.db.models import X`` call sites keep working
unchanged. New code may import directly from the domain modules.

Importing this module also triggers registration of every table against
``Base.metadata`` (via the ``_tables`` package import), which is required for
``init_db`` / ``Base.metadata.create_all`` to build the full schema.
"""

from memory_anki.infrastructure.db import _tables  # noqa: F401  (registers all tables)
from memory_anki.infrastructure.db._tables._base import Base, engine, get_session, init_db
from memory_anki.infrastructure.db._tables.english import (
    EnglishCourse,
    EnglishCourseProgress,
    EnglishGenerationTask,
    EnglishSentence,
)
from memory_anki.infrastructure.db._tables.english_reading import (
    EnglishReadingDictionaryCache,
    EnglishReadingLexiconCache,
    EnglishReadingMaterial,
    EnglishReadingProfile,
    EnglishReadingSession,
    EnglishReadingVersion,
)
from memory_anki.infrastructure.db._tables.knowledge import (
    Chapter,
    NodeConnection,
    Subject,
    SubjectDocument,
)
from memory_anki.infrastructure.db._tables.misc import (
    AiModelCatalog,
    Config,
    ExternalAiCallLog,
    MindMapImportJob,
    TimeRecord,
)
from memory_anki.infrastructure.db._tables.palaces import (
    Attachment,
    Palace,
    PalaceGroup,
    PalaceMiniPalace,
    PalaceMiniPalaceReviewLog,
    PalaceMiniPalaceReviewSchedule,
    PalaceQuizQuestion,
    PalaceSegment,
    PalaceSegmentReviewLog,
    PalaceSegmentReviewSchedule,
    PalaceVersion,
    Peg,
    ReviewLog,
    ReviewSchedule,
    SessionProgress,
    chapter_palace_table,
)

__all__ = [
    "AiModelCatalog",
    "Attachment",
    "Base",
    "Chapter",
    "Config",
    "EnglishCourse",
    "EnglishCourseProgress",
    "EnglishGenerationTask",
    "EnglishReadingDictionaryCache",
    "EnglishReadingLexiconCache",
    "EnglishReadingMaterial",
    "EnglishReadingProfile",
    "EnglishReadingSession",
    "EnglishReadingVersion",
    "EnglishSentence",
    "ExternalAiCallLog",
    "MindMapImportJob",
    "NodeConnection",
    "Palace",
    "PalaceGroup",
    "PalaceMiniPalace",
    "PalaceMiniPalaceReviewLog",
    "PalaceMiniPalaceReviewSchedule",
    "PalaceQuizQuestion",
    "PalaceSegment",
    "PalaceSegmentReviewLog",
    "PalaceSegmentReviewSchedule",
    "PalaceVersion",
    "Peg",
    "ReviewLog",
    "ReviewSchedule",
    "SessionProgress",
    "Subject",
    "SubjectDocument",
    "TimeRecord",
    "chapter_palace_table",
    "engine",
    "get_session",
    "init_db",
]
