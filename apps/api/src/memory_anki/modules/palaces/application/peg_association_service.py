from __future__ import annotations

import json
import re
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.knowledge import Chapter
from memory_anki.infrastructure.db._tables.palaces import Palace, Peg
from memory_anki.infrastructure.llm import (
    OpenAICompatibleChatConfig,
    OpenAICompatibleError,
    OpenAICompatibleProtocolError,
    call_chat_completion_text,
)
from memory_anki.platform.application import (
    AiRuntimeOptions,
    AiRuntimeProvider,
    ResolvedAiRuntime,
    serialize_resolved_ai_runtime,
)

PEG_ASSOCIATION_SCENE_KEY = "peg_association_suggestions"
DEFAULT_MAX_SUGGESTIONS = 5
MAX_SUGGESTIONS_LIMIT = 12
MAX_CONTEXT_ITEMS = 24

SYSTEM_PROMPT = """你是记忆宫殿联想建议助手。只输出 JSON 对象，不要 markdown。

任务：基于输入的宫殿记忆桩和知识点，生成可执行的联想建议，帮助用户把知识点挂到具体记忆桩上。

输出格式：
{
  "suggestions": [
    {
      "peg_id": 1,
      "knowledge_text": "知识点原文或短句",
      "association": "具体画面化联想",
      "rationale": "为什么这个桩适合承载该知识点",
      "keywords": ["关键词"]
    }
  ]
}

要求：
1. peg_id 必须来自输入 pegs。
2. association 要具体、有画面感、可复述，不要泛泛说“联想到”。
3. 不要编造输入之外的专业事实。
4. suggestions 数量不要超过输入 max_suggestions。
"""


def suggest_peg_associations(
    session: Session,
    palace_id: int,
    *,
    knowledge_text: str = "",
    chapter_ids: list[int] | None = None,
    max_suggestions: int = DEFAULT_MAX_SUGGESTIONS,
    use_ai: bool = True,
    ai_options: AiRuntimeOptions | None = None,
    ai_runtime: AiRuntimeProvider,
) -> dict[str, Any] | None:
    palace = _get_palace(session, palace_id)
    if palace is None:
        return None

    max_suggestions = _coerce_max_suggestions(max_suggestions)
    pegs = _load_pegs(session, palace_id)
    knowledge_items = _load_knowledge_items(
        session,
        palace=palace,
        knowledge_text=knowledge_text,
        chapter_ids=chapter_ids or [],
    )
    fallback = _build_fallback_payload(
        palace=palace,
        pegs=pegs,
        knowledge_items=knowledge_items,
        max_suggestions=max_suggestions,
        reason="ai_disabled" if not use_ai else "missing_ai_key",
    )
    if not use_ai:
        return fallback

    runtime = ai_runtime.resolve(
        PEG_ASSOCIATION_SCENE_KEY,
        options=ai_options,
    )
    fallback["resolved_ai"] = serialize_resolved_ai_runtime(runtime)
    if not runtime.api_key or not runtime.base_url or not runtime.model:
        return fallback

    try:
        return _call_ai_suggestions(
            runtime=runtime,
            palace=palace,
            pegs=pegs,
            knowledge_items=knowledge_items,
            max_suggestions=max_suggestions,
        )
    except (OpenAICompatibleError, ValueError, TypeError, KeyError) as exc:
        fallback["fallback_reason"] = "ai_error"
        fallback["ai_error"] = str(exc)
        return fallback


def _get_palace(session: Session, palace_id: int) -> Palace | None:
    return (
        session.query(Palace)
        .filter(Palace.id == palace_id, Palace.deleted_at.is_(None))
        .first()
    )


def _coerce_max_suggestions(value: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = DEFAULT_MAX_SUGGESTIONS
    return max(1, min(MAX_SUGGESTIONS_LIMIT, parsed))


def _load_pegs(session: Session, palace_id: int) -> list[dict[str, Any]]:
    rows = (
        session.query(Peg)
        .filter(Peg.palace_id == palace_id)
        .order_by(Peg.sort_order.asc(), Peg.id.asc())
        .all()
    )
    by_id = {peg.id: peg for peg in rows}
    path_cache: dict[int, list[str]] = {}

    def path_for(peg: Peg) -> list[str]:
        if peg.id in path_cache:
            return path_cache[peg.id]
        path = [peg.name or f"记忆桩 {peg.id}"]
        parent_id = peg.parent_id
        seen = {peg.id}
        while parent_id and parent_id in by_id and parent_id not in seen:
            parent = by_id[parent_id]
            seen.add(parent.id)
            path.insert(0, parent.name or f"记忆桩 {parent.id}")
            parent_id = parent.parent_id
        path_cache[peg.id] = path
        return path

    return [
        {
            "id": peg.id,
            "name": peg.name or f"记忆桩 {peg.id}",
            "content": peg.content or "",
            "parent_id": peg.parent_id,
            "path": path_for(peg),
        }
        for peg in rows
    ]


def _load_knowledge_items(
    session: Session,
    *,
    palace: Palace,
    knowledge_text: str,
    chapter_ids: list[int],
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for index, text in enumerate(_split_knowledge_text(knowledge_text), start=1):
        items.append({"source": "request", "id": f"request-{index}", "text": text})

    explicit_ids = [int(value) for value in chapter_ids if str(value).strip()]
    linked_ids = [chapter.id for chapter in palace.chapters or []]
    target_ids = list(dict.fromkeys([*explicit_ids, *linked_ids]))
    if target_ids:
        chapters = (
            session.query(Chapter)
            .filter(Chapter.id.in_(target_ids))
            .order_by(Chapter.sort_order.asc(), Chapter.id.asc())
            .all()
        )
        for chapter in chapters:
            text_parts = [chapter.name or ""]
            if chapter.notes:
                text_parts.append(chapter.notes)
            text = "：".join(part.strip() for part in text_parts if part.strip())
            if text:
                items.append(
                    {
                        "source": "chapter",
                        "id": chapter.id,
                        "text": text,
                    }
                )

    if not items:
        fallback_text = "：".join(
            part.strip()
            for part in (palace.title or "", palace.description or "")
            if part and part.strip()
        )
        items.extend(
            {
                "source": "palace",
                "id": "palace-context",
                "text": text,
            }
            for text in _split_knowledge_text(fallback_text or palace.title)
        )

    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in items:
        text = _compact_text(item.get("text"), limit=220)
        if not text or text in seen:
            continue
        seen.add(text)
        deduped.append({**item, "text": text})
        if len(deduped) >= MAX_CONTEXT_ITEMS:
            break
    return deduped


def _split_knowledge_text(value: str) -> list[str]:
    text = _compact_text(value, limit=4000)
    if not text:
        return []
    raw_parts = re.split(r"[\n\r;；。]+", text)
    parts = [_compact_text(part, limit=220) for part in raw_parts]
    if len(parts) <= 1 and len(text) > 140:
        parts = [_compact_text(text[index : index + 140], limit=220) for index in range(0, len(text), 140)]
    return [part for part in parts if part]


def _compact_text(value: Any, *, limit: int) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(text) <= limit:
        return text
    return f"{text[: max(0, limit - 1)].rstrip()}…"


def _build_fallback_payload(
    *,
    palace: Palace,
    pegs: list[dict[str, Any]],
    knowledge_items: list[dict[str, Any]],
    max_suggestions: int,
    reason: str,
) -> dict[str, Any]:
    suggestions = _fallback_suggestions(
        pegs=pegs,
        knowledge_items=knowledge_items,
        max_suggestions=max_suggestions,
    )
    return {
        "palace_id": palace.id,
        "palace_title": palace.title,
        "source": "fallback",
        "fallback_reason": reason,
        "model": None,
        "ai_call_log_id": None,
        "resolved_ai": None,
        "knowledge_items": knowledge_items,
        "suggestions": suggestions,
    }


def _fallback_suggestions(
    *,
    pegs: list[dict[str, Any]],
    knowledge_items: list[dict[str, Any]],
    max_suggestions: int,
) -> list[dict[str, Any]]:
    if not pegs or not knowledge_items:
        return []
    ranked_pairs = sorted(
        (
            (_pair_score(peg, item), peg["id"], str(item["id"]), peg, item)
            for peg in pegs
            for item in knowledge_items
        ),
        key=lambda row: (-row[0], row[1], row[2]),
    )
    suggestions: list[dict[str, Any]] = []
    used: set[tuple[int, str]] = set()
    for _, _, _, peg, item in ranked_pairs:
        pair_key = (int(peg["id"]), str(item["id"]))
        if pair_key in used:
            continue
        used.add(pair_key)
        suggestions.append(_fallback_suggestion(peg, item, len(suggestions) + 1))
        if len(suggestions) >= max_suggestions:
            break
    return suggestions


def _pair_score(peg: dict[str, Any], item: dict[str, Any]) -> int:
    peg_text = f"{peg.get('name', '')} {peg.get('content', '')}"
    item_text = str(item.get("text") or "")
    peg_tokens = _tokens(peg_text)
    item_tokens = _tokens(item_text)
    return len(peg_tokens & item_tokens)


def _tokens(text: str) -> set[str]:
    ascii_tokens = set(re.findall(r"[A-Za-z0-9]{2,}", text.lower()))
    cjk_tokens = set(re.findall(r"[\u4e00-\u9fff]{2,4}", text))
    return ascii_tokens | cjk_tokens


def _fallback_suggestion(
    peg: dict[str, Any],
    item: dict[str, Any],
    index: int,
) -> dict[str, Any]:
    peg_name = str(peg.get("name") or f"记忆桩 {peg.get('id')}")
    peg_content = _compact_text(peg.get("content"), limit=80)
    knowledge = _compact_text(item.get("text"), limit=120)
    cue = f"想象「{knowledge}」被贴在「{peg_name}」上"
    if peg_content:
        cue += f"，并和这里原有的「{peg_content}」形成同一幅画面"
    return {
        "id": f"fallback-{index}",
        "peg_id": peg.get("id"),
        "peg_name": peg_name,
        "peg_path": peg.get("path") or [peg_name],
        "knowledge_text": knowledge,
        "association": f"{cue}；复习时先看见这个位置，再说出知识点。",
        "rationale": f"「{peg_name}」提供固定位置，知识点提供要回忆的内容，二者绑定后能按宫殿路径触发回忆。",
        "keywords": sorted(_tokens(f"{peg_name} {knowledge}"))[:5],
        "source": "fallback",
    }


def _call_ai_suggestions(
    *,
    runtime: ResolvedAiRuntime,
    palace: Palace,
    pegs: list[dict[str, Any]],
    knowledge_items: list[dict[str, Any]],
    max_suggestions: int,
) -> dict[str, Any]:
    model_input = {
        "palace": {
            "id": palace.id,
            "title": palace.title,
            "description": palace.description or "",
        },
        "pegs": pegs,
        "knowledge_items": knowledge_items,
        "max_suggestions": max_suggestions,
    }
    content_text = call_chat_completion_text(
        config=OpenAICompatibleChatConfig(
            api_key=runtime.api_key,
            base_url=runtime.base_url,
            model=runtime.model,
            temperature=0.2 if runtime.supports_temperature else None,
            timeout_seconds=90,
        ),
        messages=[
            {"role": "system", "content": runtime.prompt_override or SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(model_input, ensure_ascii=False)},
        ],
        response_format={"type": "json_object"},
        extra_payload=runtime.extra_payload,
    )
    parsed = _extract_json_object(content_text)
    suggestions = _normalize_ai_suggestions(
        parsed.get("suggestions"),
        pegs=pegs,
        knowledge_items=knowledge_items,
        max_suggestions=max_suggestions,
    )
    if not suggestions:
        raise OpenAICompatibleProtocolError("模型没有返回可用的记忆桩联想建议。")
    return {
        "palace_id": palace.id,
        "palace_title": palace.title,
        "source": "ai",
        "fallback_reason": None,
        "model": runtime.model,
        "ai_call_log_id": None,
        "resolved_ai": serialize_resolved_ai_runtime(runtime),
        "knowledge_items": knowledge_items,
        "suggestions": suggestions,
    }


def _extract_json_object(text: str) -> dict[str, Any]:
    candidate = str(text or "").strip()
    if candidate.startswith("```"):
        lines = [line for line in candidate.splitlines() if not line.strip().startswith("```")]
        candidate = "\n".join(lines).strip()
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError:
        start = candidate.find("{")
        end = candidate.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise OpenAICompatibleProtocolError("模型返回的 JSON 结构无效。") from None
        parsed = json.loads(candidate[start : end + 1])
    if not isinstance(parsed, dict):
        raise OpenAICompatibleProtocolError("模型返回的顶层 JSON 不是对象。")
    return parsed


def _normalize_ai_suggestions(
    value: Any,
    *,
    pegs: list[dict[str, Any]],
    knowledge_items: list[dict[str, Any]],
    max_suggestions: int,
) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    pegs_by_id = {int(peg["id"]): peg for peg in pegs}
    fallback_knowledge = knowledge_items[0]["text"] if knowledge_items else ""
    suggestions: list[dict[str, Any]] = []
    for index, raw in enumerate(value, start=1):
        if not isinstance(raw, dict):
            continue
        raw_peg_id = raw.get("peg_id")
        try:
            peg_id = int(raw_peg_id) if raw_peg_id is not None else 0
        except (TypeError, ValueError):
            continue
        peg = pegs_by_id.get(peg_id)
        if peg is None:
            continue
        association = _compact_text(raw.get("association"), limit=260)
        if not association:
            continue
        keywords = raw.get("keywords")
        if not isinstance(keywords, list):
            keywords = []
        suggestions.append(
            {
                "id": f"ai-{index}",
                "peg_id": peg_id,
                "peg_name": peg.get("name") or f"记忆桩 {peg_id}",
                "peg_path": peg.get("path") or [peg.get("name") or f"记忆桩 {peg_id}"],
                "knowledge_text": _compact_text(raw.get("knowledge_text") or fallback_knowledge, limit=160),
                "association": association,
                "rationale": _compact_text(raw.get("rationale"), limit=220),
                "keywords": [_compact_text(item, limit=40) for item in keywords[:6] if str(item or "").strip()],
                "source": "ai",
            }
        )
        if len(suggestions) >= max_suggestions:
            break
    return suggestions
