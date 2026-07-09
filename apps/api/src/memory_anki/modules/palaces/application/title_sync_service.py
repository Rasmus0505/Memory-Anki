"""Facade for palace chapter binding, projections, and review rollups."""

from __future__ import annotations

from .palace_chapter_binding import (
    _chapter_depth as _chapter_depth,
)
from .palace_chapter_binding import (
    _chapter_outline_path as _chapter_outline_path,
)
from .palace_chapter_binding import (
    auto_assign_group as auto_assign_group,
)
from .palace_chapter_binding import (
    ensure_inferred_primary_chapter as ensure_inferred_primary_chapter,
)
from .palace_chapter_binding import (
    get_explicit_chapter_ids_by_palace as get_explicit_chapter_ids_by_palace,
)
from .palace_chapter_binding import (
    get_palace_explicit_chapter_ids as get_palace_explicit_chapter_ids,
)
from .palace_chapter_binding import (
    infer_primary_chapter as infer_primary_chapter,
)
from .palace_chapter_binding import (
    reconcile_palace_chapter_binding as reconcile_palace_chapter_binding,
)
from .palace_chapter_binding import (
    set_palace_chapter_links as set_palace_chapter_links,
)
from .palace_chapter_binding import (
    set_primary_chapter as set_primary_chapter,
)
from .palace_chapter_binding import (
    sync_group_name_from_chapter as sync_group_name_from_chapter,
)
from .palace_chapter_binding import (
    sync_palace_titles_from_chapter as sync_palace_titles_from_chapter,
)
from .palace_review_rollups import (
    _next_pending_palace_schedule as _next_pending_palace_schedule,
)
from .palace_review_rollups import (
    _review_datetime_is_later_today as _review_datetime_is_later_today,
)
from .palace_review_rollups import (
    count_palace_review_units as count_palace_review_units,
)
from .palace_review_rollups import (
    palace_has_due_later_today as palace_has_due_later_today,
)
from .palace_review_rollups import (
    palace_has_due_review as palace_has_due_review,
)
from .palace_view_resolvers import (
    _palace_outline_sort_key as _palace_outline_sort_key,
)
from .palace_view_resolvers import (
    _subject_sort_key as _subject_sort_key,
)
from .palace_view_resolvers import (
    build_chapter_grouped_palace_list as build_chapter_grouped_palace_list,
)
from .palace_view_resolvers import (
    build_grouped_palace_list as build_grouped_palace_list,
)
from .palace_view_resolvers import (
    build_subject_shelf_summary as build_subject_shelf_summary,
)
from .palace_view_resolvers import (
    build_today_new_palace_outline as build_today_new_palace_outline,
)
from .palace_view_resolvers import (
    chapter_summary as chapter_summary,
)
from .palace_view_resolvers import (
    palace_group_json as palace_group_json,
)
from .palace_view_resolvers import (
    resolve_palace_binding_status as resolve_palace_binding_status,
)
from .palace_view_resolvers import (
    resolve_palace_group_source_chapter as resolve_palace_group_source_chapter,
)
from .palace_view_resolvers import (
    resolve_palace_subject as resolve_palace_subject,
)
from .palace_view_resolvers import (
    resolve_palace_title as resolve_palace_title,
)
from .palace_view_resolvers import (
    subject_summary as subject_summary,
)

__all__ = [
    "_chapter_depth",
    "_chapter_outline_path",
    "_next_pending_palace_schedule",
    "_palace_outline_sort_key",
    "_review_datetime_is_later_today",
    "_subject_sort_key",
    "auto_assign_group",
    "build_chapter_grouped_palace_list",
    "build_grouped_palace_list",
    "build_subject_shelf_summary",
    "build_today_new_palace_outline",
    "chapter_summary",
    "count_palace_review_units",
    "ensure_inferred_primary_chapter",
    "get_explicit_chapter_ids_by_palace",
    "get_palace_explicit_chapter_ids",
    "infer_primary_chapter",
    "palace_group_json",
    "palace_has_due_later_today",
    "palace_has_due_review",
    "reconcile_palace_chapter_binding",
    "resolve_palace_binding_status",
    "resolve_palace_group_source_chapter",
    "resolve_palace_subject",
    "resolve_palace_title",
    "set_palace_chapter_links",
    "set_primary_chapter",
    "subject_summary",
    "sync_group_name_from_chapter",
    "sync_palace_titles_from_chapter",
]
