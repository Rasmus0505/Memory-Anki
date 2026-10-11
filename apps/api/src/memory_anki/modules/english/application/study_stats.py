"""English course count stats shown on the dashboard and the course library."""

from __future__ import annotations

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.english import EnglishCourse, EnglishCourseProgress


def get_english_study_stats(session: Session) -> dict[str, int]:
    total_courses = session.query(EnglishCourse).count()
    completed_courses = (
        session.query(EnglishCourseProgress)
        .filter(EnglishCourseProgress.is_completed.is_(True))
        .count()
    )
    return {
        "total_courses": total_courses,
        "unfinished_courses": max(0, total_courses - completed_courses),
        "completed_courses": completed_courses,
    }
