from __future__ import annotations

import json
from collections import defaultdict
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.mindmap import (
    MindMapNodeLabel,
    MindMapRecallEvent,
)
from memory_anki.infrastructure.db._tables.palaces import Palace

VALID_RATINGS = {1, 3, 5}
VALID_ROUNDS = {"first", "weak_retry"}
VALID_LABELS = {"weak", "mastered"}


def _event_json(row: MindMapRecallEvent) -> dict[str, Any]:
    return {
        "id": row.id,
        "study_session_id": row.study_session_id,
        "palace_id": row.palace_id,
        "node_uid": row.node_uid,
        "source_scene": row.source_scene,
        "recall_round": row.recall_round,
        "rating": row.rating,
        "occurred_at": row.occurred_at.isoformat(),
        "supersedes_event_id": row.supersedes_event_id,
    }


def create_recall_event(session: Session, payload: dict[str, Any]) -> dict[str, Any]:
    event_id = str(payload.get("id") or "").strip()
    existing = session.get(MindMapRecallEvent, event_id)
    if existing is not None:
        return _event_json(existing)
    rating = int(payload.get("rating") or 0)
    recall_round = str(payload.get("recall_round") or "first")
    if rating not in VALID_RATINGS or recall_round not in VALID_ROUNDS:
        raise ValueError("invalid recall rating or round")
    supersedes = str(payload.get("supersedes_event_id") or "").strip() or None
    if supersedes and session.get(MindMapRecallEvent, supersedes) is None:
        raise ValueError("superseded recall event not found")
    row = MindMapRecallEvent(
        id=event_id,
        study_session_id=str(payload.get("study_session_id") or "").strip(),
        palace_id=int(payload["palace_id"]),
        node_uid=str(payload.get("node_uid") or "").strip(),
        source_scene=str(payload.get("source_scene") or "formal_review").strip(),
        recall_round=recall_round,
        rating=rating,
        occurred_at=payload.get("occurred_at") or utc_now_naive(),
        supersedes_event_id=supersedes,
    )
    if not row.id or not row.study_session_id or not row.node_uid:
        raise ValueError("event id, study session id and node uid are required")
    session.add(row)
    session.commit()
    return _event_json(row)


def list_session_events(session: Session, study_session_id: str) -> list[dict[str, Any]]:
    rows = session.query(MindMapRecallEvent).filter_by(study_session_id=study_session_id).order_by(MindMapRecallEvent.occurred_at, MindMapRecallEvent.created_at).all()
    return [_event_json(row) for row in rows]


def _effective_events(rows: list[MindMapRecallEvent]) -> list[MindMapRecallEvent]:
    superseded = {row.supersedes_event_id for row in rows if row.supersedes_event_id}
    return [row for row in rows if row.id not in superseded]


def _palace_node_uids(session: Session, palace_id: int) -> set[str]:
    palace = session.get(Palace, palace_id)
    if palace is None:
        return set()
    try:
        doc = json.loads(palace.editor_doc or "{}")
    except Exception:
        return set()
    found: set[str] = set()

    def walk(node: Any) -> None:
        if not isinstance(node, dict):
            return
        raw_data = node.get("data")
        data: dict[str, Any] = raw_data if isinstance(raw_data, dict) else {}
        uid = str(data.get("uid") or data.get("memoryAnkiId") or "").strip()
        if uid:
            found.add(uid)
        raw_children = node.get("children")
        children = raw_children if isinstance(raw_children, list) else []
        for child in children:
            walk(child)

    walk(doc.get("root"))
    return found


def _status_for(first_events: list[MindMapRecallEvent], retry_by_session: dict[str, MindMapRecallEvent]) -> tuple[str, str, int]:
    recent = first_events[-5:]
    if not recent:
        return "unknown", "暂无正式复习评分", 0
    recent_three = recent[-3:]
    latest = recent[-1]
    latest_retry = retry_by_session.get(latest.study_session_id)
    forgot_count = sum(1 for event in recent_three if event.rating == 1)
    if latest.rating == 1 and (latest_retry is None or latest_retry.rating != 5):
        return "weak", "最近首次回忆为忘记，且弱点回合仍未记住", 300 + forgot_count
    if forgot_count >= 2:
        return "weak", "最近三次首次回忆至少两次忘记", 280 + forgot_count
    if len(recent) >= 2 and all(event.rating == 5 for event in recent[-2:]) and all(event.rating == 5 for event in recent_three):
        return "stable", "最近两次首次回忆均记住，且最近三次无模糊或忘记", 20
    correction = latest.rating in {1, 3} and latest_retry is not None and latest_retry.rating == 5
    if correction:
        return "reinforce", "首次提取不稳，但弱点回合纠错成功", 120
    return "reinforce", "近期回忆结果仍需巩固", 160 + forgot_count * 20


def list_node_mastery(session: Session, palace_id: int, *, weak_only: bool = False) -> list[dict[str, Any]]:
    rows = session.query(MindMapRecallEvent).filter_by(palace_id=palace_id, source_scene="formal_review").order_by(MindMapRecallEvent.occurred_at, MindMapRecallEvent.created_at).all()
    effective = _effective_events(rows)
    labels = {row.node_uid: row.label for row in session.query(MindMapNodeLabel).filter_by(palace_id=palace_id).all()}
    valid_uids = _palace_node_uids(session, palace_id)
    grouped: dict[str, list[MindMapRecallEvent]] = defaultdict(list)
    for row in effective:
        grouped[row.node_uid].append(row)
    node_uids = valid_uids | set(labels) | set(grouped)
    items: list[dict[str, Any]] = []
    for node_uid in node_uids:
        node_rows = grouped.get(node_uid, [])
        first = [row for row in node_rows if row.recall_round == "first"]
        retry_by_session = {row.study_session_id: row for row in node_rows if row.recall_round == "weak_retry"}
        status, reason, priority = _status_for(first, retry_by_session)
        manual_label = labels.get(node_uid)
        orphaned = node_uid not in valid_uids
        effective_status = "weak" if manual_label == "weak" else status
        hidden_by_mastered = manual_label == "mastered" and status != "weak"
        item = {
            "palace_id": palace_id,
            "node_uid": node_uid,
            "status": effective_status,
            "computed_status": status,
            "manual_label": manual_label,
            "reason": reason,
            "priority": priority + (1000 if manual_label == "weak" else 0),
            "orphaned": orphaned,
            "hidden_by_mastered": hidden_by_mastered,
            "recent_events": [_event_json(row) for row in node_rows[-10:]],
        }
        if orphaned:
            continue
        if weak_only and not (effective_status in {"weak", "reinforce"} and not hidden_by_mastered):
            continue
        items.append(item)
    return sorted(items, key=lambda item: (-item["priority"], item["node_uid"]))


def set_node_label(session: Session, palace_id: int, node_uid: str, label: str | None) -> dict[str, Any]:
    if label is not None and label not in VALID_LABELS:
        raise ValueError("invalid node label")
    row = session.query(MindMapNodeLabel).filter_by(palace_id=palace_id, node_uid=node_uid).first()
    if label is None:
        if row is not None:
            session.delete(row)
    elif row is None:
        row = MindMapNodeLabel(palace_id=palace_id, node_uid=node_uid, label=label)
        session.add(row)
    else:
        row.label = label
        row.updated_at = utc_now_naive()
    session.commit()
    return {"palace_id": palace_id, "node_uid": node_uid, "label": label}
