"""Entry-mode labels and top-level branch summaries for FSRS CTAs."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from memory_anki.core.time import to_api_datetime

_BRANCH_SUMMARY_LIMIT = 8


def top_level_branch_uid(
    nodes: dict[str, dict[str, Any]], root_uid: str | None, node_uid: str
) -> str | None:
    if root_uid is None or node_uid == root_uid:
        return None
    current = node_uid
    while current and current in nodes:
        parent = nodes[current].get("parent_uid")
        if parent == root_uid:
            return current
        if parent is None:
            return current if current != root_uid else None
        current = parent
    return None


def top_level_branch_uids(
    nodes: dict[str, dict[str, Any]], root_uid: str | None
) -> list[str]:
    """Direct children of the mind-map root (rateable top-level branches)."""
    if root_uid is None:
        return []
    return [
        uid
        for uid, node in nodes.items()
        if node.get("parent_uid") == root_uid
    ]


def entry_mode_payload(
    *,
    root_uid: str | None,
    nodes: dict[str, dict[str, Any]],
    due_items: list[dict[str, Any]],
) -> dict[str, Any]:
    """Classify formal-review entry as none / node / palace.

    Root is never FSRS-scheduled, so a palace whose only rateable content sits
    under a single top-level branch must still be ``palace`` when that branch
    is due — not ``node`` merely because the unscored root was excluded.

    ``node`` is reserved for a true partial-palace wave: due cards under exactly
    one top-level branch while the tree has other top-level sibling branches.
    """
    due_uids = [item["node_uid"] for item in due_items]
    branch_uids: list[str] = []
    seen: set[str] = set()
    for uid in due_uids:
        branch = top_level_branch_uid(nodes, root_uid, uid)
        if branch and branch not in seen:
            seen.add(branch)
            branch_uids.append(branch)
    count = len(due_uids)
    if count == 0:
        return {
            "review_entry_mode": "none",
            "review_entry_label": None,
            "primary_branch_uid": None,
            "primary_branch_title": None,
            "due_branch_count": 0,
            "due_node_uids": [],
        }
    all_branches = top_level_branch_uids(nodes, root_uid)
    # Partial single-branch wave among multi-branch palaces → node review.
    # Sole top-level branch (or every top-level branch due) → palace review.
    if len(branch_uids) == 1 and len(all_branches) > 1:
        branch_uid = branch_uids[0]
        title = str(nodes.get(branch_uid, {}).get("text") or "未命名节点").strip() or "未命名节点"
        return {
            "review_entry_mode": "node",
            # Label without node counts — shelf CTAs use color + short copy.
            "review_entry_label": "节点复习",
            "primary_branch_uid": branch_uid,
            "primary_branch_title": title,
            "due_branch_count": 1,
            "due_node_uids": due_uids,
        }
    return {
        "review_entry_mode": "palace",
        "review_entry_label": "开始复习",
        "primary_branch_uid": None,
        "primary_branch_title": None,
        "due_branch_count": len(branch_uids),
        "due_node_uids": due_uids,
    }


def branch_review_status(
    *, due_count: int, next_review_at: datetime | None, now: datetime
) -> str:
    if due_count > 0:
        return "due_now"
    if next_review_at is None:
        return "none"
    if next_review_at <= now:
        return "due_now"
    if (
        next_review_at.year == now.year
        and next_review_at.month == now.month
        and next_review_at.day == now.day
    ):
        return "later_today"
    return "future"


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def branch_review_summaries(
    *,
    root_uid: str | None,
    nodes: dict[str, dict[str, Any]],
    details: list[dict[str, Any]],
    now: datetime,
) -> list[dict[str, Any]]:
    """Compact top-level branch schedule summary for review CTA tooltips."""
    del root_uid  # branch_uid is already projected on each detail row
    buckets: dict[str, dict[str, Any]] = {}
    for item in details:
        branch_uid = item.get("branch_uid")
        if not branch_uid:
            continue
        bucket = buckets.get(branch_uid)
        if bucket is None:
            title = str(nodes.get(branch_uid, {}).get("text") or "未命名节点").strip() or "未命名节点"
            if len(title) > 24:
                title = f"{title[:23]}…"
            bucket = {
                "branch_uid": branch_uid,
                "title": title,
                "due_node_count": 0,
                "next_review_at": None,
                "node_count": 0,
            }
            buckets[branch_uid] = bucket
        bucket["node_count"] = int(bucket["node_count"]) + 1
        if item.get("due"):
            bucket["due_node_count"] = int(bucket["due_node_count"]) + 1
        due_raw = item.get("due_at")
        if not due_raw:
            continue
        try:
            due_at = _aware(datetime.fromisoformat(str(due_raw)))
        except ValueError:
            continue
        if due_at is None:
            continue
        previous = bucket["next_review_at"]
        if previous is None or due_at < previous:
            bucket["next_review_at"] = due_at

    ordered = sorted(
        buckets.values(),
        key=lambda row: (
            0 if int(row["due_node_count"]) > 0 else 1,
            row["next_review_at"] or datetime.max.replace(tzinfo=UTC),
            str(row["title"]),
        ),
    )
    truncated = ordered[:_BRANCH_SUMMARY_LIMIT]
    remaining = max(0, len(ordered) - len(truncated))
    result: list[dict[str, Any]] = []
    for row in truncated:
        next_at: datetime | None = row["next_review_at"]
        result.append(
            {
                "branch_uid": row["branch_uid"],
                "title": row["title"],
                "due_node_count": int(row["due_node_count"]),
                "next_review_at": to_api_datetime(next_at) if next_at else None,
                "status": branch_review_status(
                    due_count=int(row["due_node_count"]),
                    next_review_at=next_at,
                    now=now,
                ),
            }
        )
    if remaining:
        result.append(
            {
                "branch_uid": "__more__",
                "title": f"另有 {remaining} 个分支…",
                "due_node_count": 0,
                "next_review_at": None,
                "status": "none",
            }
        )
    return result
