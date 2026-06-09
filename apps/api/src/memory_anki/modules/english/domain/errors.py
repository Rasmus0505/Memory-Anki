from __future__ import annotations


class EnglishCourseError(RuntimeError):
    pass


class EnglishTranslationBatchMismatchError(EnglishCourseError):
    pass
