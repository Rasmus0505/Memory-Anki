"""小结算时同步清理本轮单元与题目错题标记。"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.memory.api import list_unit_node_members
from memory_anki.modules.practice.domain.overlay_quiz import clear_overlay_wrong_states
from memory_anki.modules.practice.domain.round_plan import normalize_plan
from memory_anki.modules.quiz.public.queries import list_node_bindings_for_palaces


def _settled_unit_ids(
    plan: dict[str, Any],
    *,
    card_ids: list[str],
    explicit_unit_ids: list[str],
) -> set[str]:
    normalized = normalize_plan(plan)
    original = {str(card.get("card_id")): card for card in normalized.get("original_cards") or []}
    occurrences = {str(item.get("occurrence_id")): item for item in normalized.get("occurrences") or []}
    units = {str(item).strip() for item in explicit_unit_ids if str(item).strip()}
    for card_id in card_ids:
        key = str(card_id or "").strip()
        card = original.get(key)
        if card is None and key in occurrences:
            card = original.get(str(occurrences[key].get("source_card_id") or ""))
        unit_id = str((card or {}).get("unit_id") or "").strip()
        if unit_id:
            units.add(unit_id)
    return units


def settle_round_wrong_markers(
    session: Session,
    plan: dict[str, Any],
    *,
    card_ids: list[str],
    explicit_unit_ids: list[str],
) -> dict[str, Any]:
    """Clear this round's wrong markers for the units a 小结算 just settled.

    The progress rail's unit marker and the node badges read the same lifetime:
    a settled unit is done, so both stop reporting it. Questions of units that
    were not settled keep their marker, including after a correct retry.
    """
    unit_ids = _settled_unit_ids(plan, card_ids=card_ids, explicit_unit_ids=explicit_unit_ids)
    if not unit_ids:
        return plan
    next_plan = {
        **plan,
        "wrong_unit_ids": [item for item in plan["wrong_unit_ids"] if item not in unit_ids],
    }
    members = list_unit_node_members(session, sorted(unit_ids))
    node_uids = {uid for values in members.values() for uid in values}
    if not node_uids:
        return next_plan
    palace_ids = {
        int(card.get("palace_id"))
        for card in plan.get("original_cards") or []
        if str(card.get("unit_id") or "").strip() in unit_ids and card.get("palace_id")
    }
    bindings = list_node_bindings_for_palaces(session, palace_ids=sorted(palace_ids))
    question_ids = {
        int(binding["question_id"])
        for binding in bindings
        if str(binding.get("node_uid") or "") in node_uids
        and str(binding.get("question_id") or "").isdigit()
    }
    if not question_ids:
        return next_plan
    next_plan["wrong_question_ids"] = [
        item for item in plan["wrong_question_ids"]
        if not (str(item).isdigit() and int(item) in question_ids)
    ]
    next_plan["overlay_quiz"] = clear_overlay_wrong_states(plan.get("overlay_quiz"), question_ids)
    return next_plan
