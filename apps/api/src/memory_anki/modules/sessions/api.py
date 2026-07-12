"""Public study-session facade for cross-context composition."""

from .application.session_progress_service import (
    calculate_reveal_progress,
    clear_practice_progress,
    clear_review_progress,
    get_practice_progress,
    get_review_progress,
    upsert_practice_progress,
    upsert_review_progress,
)
from .application.study_session_bridge import (
    create_review_study_session,
    ensure_review_log_study_sessions,
)
from .application.study_session_constants import ACTIVE_STATUSES, ENGLISH_READING_SCENES
from .application.study_session_service import (
    FORMAL_REVIEW_SCENES,
    STUDY_DASHBOARD_SCENES,
    current_month_bounds,
    current_week_bounds,
    date_range_bounds,
    get_all_time_study_session_duration_seconds,
    get_english_study_stats,
    get_study_session_duration_seconds,
    get_today_palace_learning_breakdown,
    month_bounds,
    today_bounds,
)

__all__ = [
    "ACTIVE_STATUSES",
    "ENGLISH_READING_SCENES",
    "FORMAL_REVIEW_SCENES",
    "calculate_reveal_progress",
    "clear_practice_progress",
    "clear_review_progress",
    "create_review_study_session",
    "STUDY_DASHBOARD_SCENES",
    "current_month_bounds",
    "current_week_bounds",
    "date_range_bounds",
    "get_all_time_study_session_duration_seconds",
    "ensure_review_log_study_sessions",
    "get_english_study_stats",
    "get_practice_progress",
    "get_review_progress",
    "get_study_session_duration_seconds",
    "get_today_palace_learning_breakdown",
    "month_bounds",
    "today_bounds",
    "upsert_practice_progress",
    "upsert_review_progress",
]
