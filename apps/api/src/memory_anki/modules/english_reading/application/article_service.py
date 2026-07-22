from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.english_reading import (
    EnglishReadingArticle,
    EnglishReadingArticleTargetLink,
    EnglishReadingExplanation,
    EnglishReadingGenerationRun,
    EnglishReadingTarget,
)
from memory_anki.infrastructure.llm.openai_compatible import (
    OpenAICompatibleChatConfig,
    call_chat_completion_text,
)
from memory_anki.modules.english_reading.application.ai_dependencies import (
    EnglishReadingAiDependencies,
)
from memory_anki.modules.english_reading.domain.errors import EnglishReadingError
from memory_anki.platform.application import (
    AiRuntimeOptions,
    serialize_resolved_ai_runtime,
)

from . import service as legacy_service

CEFR_LEVELS = {"A1", "A2", "B1", "B2", "C1", "C2"}
CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
WORD_RE = re.compile(r"^[A-Za-z]+(?:[-'][A-Za-z]+)*$")
JSON_RE = re.compile(r"\{.*\}", re.DOTALL)


def create_article(
    session: Session,
    *,
    pasted_text: str,
    file_bytes: bytes | None,
    original_filename: str,
) -> dict[str, Any]:
    source_type, raw_text = legacy_service.resolve_material_source(
        pasted_text=pasted_text,
        file_bytes=file_bytes,
        original_filename=original_filename,
    )
    content = legacy_service.clean_material_text(raw_text)
    if not content.strip():
        raise EnglishReadingError("未提取到可阅读的英文正文。")
    article = EnglishReadingArticle(
        title=legacy_service.derive_material_title(content, original_filename=original_filename),
        kind="source",
        source_type=source_type,
        original_filename=original_filename,
        original_text=raw_text,
        content=content,
        word_count=legacy_service.count_words(content),
        depth=0,
    )
    session.add(article)
    session.commit()
    session.refresh(article)
    return serialize_article(session, article)


def list_articles(session: Session) -> dict[str, Any]:
    rows = session.query(EnglishReadingArticle).order_by(EnglishReadingArticle.created_at.asc()).all()
    items = [serialize_article_summary(row) for row in rows]
    roots = [item for item in items if item["parentArticleId"] is None]
    children: dict[int, list[dict[str, Any]]] = {}
    for item in items:
        parent_id = item["parentArticleId"]
        if parent_id is not None:
            children.setdefault(parent_id, []).append(item)

    def attach(item: dict[str, Any]) -> dict[str, Any]:
        return {**item, "children": [attach(child) for child in children.get(item["id"], [])]}

    return {"items": items, "tree": [attach(root) for root in roots]}


def list_recent_article_materials(session: Session, limit: int = 12) -> list[dict[str, Any]]:
    rows = (
        session.query(EnglishReadingArticle)
        .order_by(EnglishReadingArticle.updated_at.desc(), EnglishReadingArticle.id.desc())
        .limit(max(1, min(50, int(limit))))
        .all()
    )
    return [
        {
            "id": row.id,
            "title": row.title,
            "sourceType": row.source_type,
            "originalFilename": row.original_filename,
            "wordCount": row.word_count,
            "latestVersionId": row.id,
            "createdAt": row.created_at.isoformat() if row.created_at else None,
            "updatedAt": row.updated_at.isoformat() if row.updated_at else None,
        }
        for row in rows
    ]


def get_article(session: Session, article_id: int) -> dict[str, Any]:
    return serialize_article(session, get_article_row(session, article_id))


def rename_article(session: Session, *, article_id: int, title: str) -> dict[str, Any]:
    article = get_article_row(session, article_id)
    safe_title = str(title or "").strip()
    if not safe_title:
        raise EnglishReadingError("文章标题不能为空。")
    article.title = safe_title[:240]
    article.updated_at = utc_now_naive()
    session.commit()
    return serialize_article(session, article)


def delete_article(session: Session, article_id: int) -> dict[str, Any]:
    article = get_article_row(session, article_id)
    descendant_ids = collect_descendant_ids(session, article.id)
    deleted_ids = [article.id, *descendant_ids]
    session.delete(article)
    session.commit()
    return {"deletedArticleIds": deleted_ids}


def create_target(
    session: Session,
    *,
    article_id: int,
    target_type: str,
    start_offset: int,
    end_offset: int,
    quote: str,
    priority: int = 1,
) -> dict[str, Any]:
    article = get_article_row(session, article_id)
    safe_type = str(target_type or "").strip().lower()
    if safe_type not in {"word", "sentence"}:
        raise EnglishReadingError("目标类型必须是 word 或 sentence。")
    if start_offset < 0 or end_offset <= start_offset or end_offset > len(article.content):
        raise EnglishReadingError("所选文本位置无效。")
    anchored_quote = article.content[start_offset:end_offset]
    if anchored_quote != quote:
        raise EnglishReadingError("文章内容与所选文本锚点不一致，请重新选择。")
    if safe_type == "word" and WORD_RE.fullmatch(quote.strip()) is None:
        raise EnglishReadingError("单词目标必须是一个完整英文单词。")
    existing = (
        session.query(EnglishReadingTarget)
        .filter_by(
            article_id=article.id,
            target_type=safe_type,
            start_offset=start_offset,
            end_offset=end_offset,
        )
        .one_or_none()
    )
    if existing is not None:
        return serialize_target(session, existing)
    target = EnglishReadingTarget(
        article_id=article.id,
        target_type=safe_type,
        start_offset=start_offset,
        end_offset=end_offset,
        quote=quote,
        quote_checksum=hashlib.sha256(quote.encode("utf-8")).hexdigest(),
        normalized_value=quote.strip().lower() if safe_type == "word" else " ".join(quote.split()),
        priority=max(1, min(5, int(priority))),
    )
    session.add(target)
    session.commit()
    session.refresh(target)
    return serialize_target(session, target)


def update_target_priority(session: Session, *, target_id: int, priority: int) -> dict[str, Any]:
    target = get_target_row(session, target_id)
    target.priority = max(1, min(5, int(priority)))
    session.commit()
    return serialize_target(session, target)


def delete_target(session: Session, target_id: int) -> dict[str, Any]:
    target = get_target_row(session, target_id)
    session.delete(target)
    session.commit()
    return {"deletedTargetId": target_id}


def explain_target(
    session: Session,
    *,
    target_id: int,
    operation_id: str,
    cefr: str,
    ai_dependencies: EnglishReadingAiDependencies,
    ai_options: AiRuntimeOptions | None,
) -> dict[str, Any]:
    safe_operation_id = normalize_operation_id(operation_id)
    existing = session.query(EnglishReadingExplanation).filter_by(operation_id=safe_operation_id).one_or_none()
    if existing is not None:
        if existing.target_id != target_id:
            raise EnglishReadingError("operation_id 已属于其他学习目标。")
        return serialize_explanation(existing)
    target = get_target_row(session, target_id)
    article = get_article_row(session, target.article_id)
    safe_cefr = normalize_cefr(cefr)
    prompt_key = "ai_prompt_english_reading_word_explain" if target.target_type == "word" else "ai_prompt_english_reading_sentence_explain"
    prompt = ai_dependencies.prompts.render(
        prompt_key,
        {
            "cefr": safe_cefr,
            "target": target.quote,
            "context": article.content[max(0, target.start_offset - 240): min(len(article.content), target.end_offset + 240)],
        },
    )
    result, runtime_meta = run_english_json(
        ai_dependencies=ai_dependencies,
        prompt=prompt,
        ai_options=ai_options,
        required_keys=("meaningHere", "otherCommonUses") if target.target_type == "word" else ("englishExplanation", "howItWorks"),
    )
    explanation = EnglishReadingExplanation(
        target_id=target.id,
        operation_id=safe_operation_id,
        explanation_type=target.target_type,
        cefr=safe_cefr,
        status="completed",
        result_json=json.dumps(result, ensure_ascii=False),
        ai_runtime_json=json.dumps(runtime_meta, ensure_ascii=False),
    )
    session.add(explanation)
    session.commit()
    session.refresh(explanation)
    return serialize_explanation(explanation)


def delete_explanation(session: Session, explanation_id: int) -> dict[str, Any]:
    row = session.get(EnglishReadingExplanation, explanation_id)
    if row is None:
        raise EnglishReadingError("英文解释不存在。")
    session.delete(row)
    session.commit()
    return {"deletedExplanationId": explanation_id}


def generate_article(
    session: Session,
    *,
    owner_article_id: int,
    operation_id: str,
    target_ids: list[int],
    config: dict[str, Any],
    ai_dependencies: EnglishReadingAiDependencies,
    ai_options: AiRuntimeOptions | None,
) -> dict[str, Any]:
    owner = get_article_row(session, owner_article_id)
    if owner.depth >= 2:
        raise EnglishReadingError("第二层生成文章不能继续派生文章。")
    unique_target_ids = list(dict.fromkeys(int(value) for value in target_ids))
    if not 1 <= len(unique_target_ids) <= 12:
        raise EnglishReadingError("每次请选择 1 到 12 个学习目标。")
    targets = session.query(EnglishReadingTarget).filter(EnglishReadingTarget.id.in_(unique_target_ids)).all()
    if len(targets) != len(unique_target_ids) or any(target.article_id != owner.id for target in targets):
        raise EnglishReadingError("所有学习目标必须属于当前文章。")
    safe_operation_id = normalize_operation_id(operation_id)
    existing = session.query(EnglishReadingGenerationRun).filter_by(operation_id=safe_operation_id).one_or_none()
    if existing is not None:
        if existing.owner_article_id != owner.id:
            raise EnglishReadingError("operation_id 已属于其他文章。")
        if existing.result_article_id is None:
            raise EnglishReadingError(existing.error_message or "该生成操作尚未完成。")
        return {"run": serialize_run(existing), "article": get_article(session, existing.result_article_id)}
    safe_config = normalize_generation_config(config)
    run = EnglishReadingGenerationRun(
        owner_article_id=owner.id,
        operation_id=safe_operation_id,
        status="running",
        target_ids_json=json.dumps(unique_target_ids),
        config_json=json.dumps(safe_config, ensure_ascii=False),
    )
    session.add(run)
    session.commit()
    prompt = ai_dependencies.prompts.render(
        "ai_prompt_english_reading_target_article",
        {
            "cefr": safe_config["cefr"],
            "word_count": safe_config["wordCount"],
            "genre": safe_config["genre"],
            "topic": safe_config["topic"] or "Choose a natural topic that connects the targets.",
            "word_repetitions": safe_config["wordRepetitions"],
            "sentence_variants": safe_config["sentenceVariants"],
            "syntax_density": safe_config["syntaxDensity"],
            "targets_json": json.dumps(
                [{"id": target.id, "type": target.target_type, "text": target.quote, "priority": target.priority} for target in targets],
                ensure_ascii=False,
            ),
        },
    )
    try:
        result, runtime_meta = run_english_json(
            ai_dependencies=ai_dependencies,
            prompt=prompt,
            ai_options=ai_options,
            required_keys=("title", "content", "coverage"),
        )
        content = legacy_service.clean_material_text(str(result.get("content") or ""))
        validate_generated_article(content, targets=targets, config=safe_config)
        article = EnglishReadingArticle(
            title=str(result.get("title") or f"Practice from {owner.title}").strip()[:240],
            kind="generated",
            source_type="ai",
            original_text=content,
            content=content,
            word_count=legacy_service.count_words(content),
            depth=owner.depth + 1,
            parent_article_id=owner.id,
            generation_config_json=json.dumps(safe_config, ensure_ascii=False),
        )
        session.add(article)
        session.flush()
        for target in targets:
            session.add(EnglishReadingArticleTargetLink(article_id=article.id, target_id=target.id))
        run.result_article_id = article.id
        run.status = "completed"
        run.coverage_json = json.dumps(result.get("coverage") or {}, ensure_ascii=False)
        run.ai_runtime_json = json.dumps(runtime_meta, ensure_ascii=False)
        run.completed_at = utc_now_naive()
        session.commit()
        return {"run": serialize_run(run), "article": serialize_article(session, article)}
    except Exception as exc:
        run.status = "failed"
        run.error_message = str(exc)
        run.completed_at = utc_now_naive()
        session.commit()
        if isinstance(exc, EnglishReadingError):
            raise
        raise EnglishReadingError("定向文章生成失败，请稍后重试。") from exc


def normalize_generation_config(config: dict[str, Any]) -> dict[str, Any]:
    word_count = int(config.get("wordCount") or 300)
    if word_count not in {150, 300, 500}:
        raise EnglishReadingError("文章长度必须是 150、300 或 500 词。")
    genre = str(config.get("genre") or "argumentative").strip().lower()
    if genre not in {"argumentative", "expository", "narrative", "dialogue"}:
        raise EnglishReadingError("文章文体无效。")
    syntax_density = str(config.get("syntaxDensity") or "normal").strip().lower()
    if syntax_density not in {"low", "normal", "high"}:
        raise EnglishReadingError("句法密度无效。")
    return {
        "cefr": normalize_cefr(str(config.get("cefr") or "B1")),
        "wordCount": word_count,
        "genre": genre,
        "topic": str(config.get("topic") or "").strip()[:500],
        "wordRepetitions": max(1, min(5, int(config.get("wordRepetitions") or 3))),
        "sentenceVariants": max(1, min(5, int(config.get("sentenceVariants") or 3))),
        "syntaxDensity": syntax_density,
    }


def validate_generated_article(content: str, *, targets: list[EnglishReadingTarget], config: dict[str, Any]) -> None:
    if not content or CJK_RE.search(content):
        raise EnglishReadingError("模型未返回纯英文文章。")
    actual_word_count = legacy_service.count_words(content)
    target_word_count = int(config["wordCount"])
    if actual_word_count < int(target_word_count * 0.6) or actual_word_count > int(target_word_count * 1.4):
        raise EnglishReadingError("生成文章篇幅超出允许范围。")
    lowered = content.lower()
    missing_words = [target.quote for target in targets if target.target_type == "word" and target.quote.lower() not in lowered]
    if missing_words:
        raise EnglishReadingError(f"生成文章未覆盖目标词：{', '.join(missing_words)}")


REQUIRED_KEY_ALIASES: dict[str, tuple[str, ...]] = {
    "meaningHere": ("meaningHere", "meaning_here", "meaning", "definition", "wordMeaning"),
    "otherCommonUses": ("otherCommonUses", "other_common_uses", "otherUses", "commonUses", "usages"),
    "englishExplanation": (
        "englishExplanation",
        "english_explanation",
        "explanation",
        "sentenceExplanation",
    ),
    "howItWorks": ("howItWorks", "how_it_works", "structure", "parts", "breakdown"),
    "title": ("title",),
    "content": ("content", "article", "text", "body"),
    "coverage": ("coverage",),
}

NESTED_PAYLOAD_KEYS = ("result", "data", "response", "output", "payload")


def run_english_json(
    *,
    ai_dependencies: EnglishReadingAiDependencies,
    prompt: str,
    ai_options: AiRuntimeOptions | None,
    required_keys: tuple[str, ...],
) -> tuple[dict[str, Any], dict[str, Any]]:
    runtime = ai_dependencies.runtime.resolve("english_reading", options=ai_options)
    if not runtime.api_key:
        raise EnglishReadingError("未配置英语阅读模型对应的 Provider API Key。")
    config = OpenAICompatibleChatConfig(
        api_key=runtime.api_key,
        base_url=runtime.base_url,
        model=runtime.model,
        temperature=0.35 if runtime.supports_temperature else None,
        timeout_seconds=120,
    )
    system_message = (
        "You are an English-only tutor for second-language learners. "
        "Reply with one JSON object only. Every string value must be plain English. "
        "Never use Chinese characters, pinyin glosses, or bilingual notes."
    )
    current_prompt = prompt
    last_error = "模型未返回有效 JSON。"
    for _attempt in range(3):
        response = call_chat_completion_text(
            config=config,
            messages=[
                {"role": "system", "content": system_message},
                {"role": "user", "content": current_prompt},
            ],
            response_format={"type": "json_object"},
            extra_payload=runtime.extra_payload,
        )
        try:
            parsed = normalize_english_payload(parse_json_object(response), required_keys)
        except EnglishReadingError as exc:
            last_error = str(exc)
            current_prompt = (
                f"{prompt}\n\nYour previous result was invalid ({last_error}). "
                f"Return valid JSON with exact keys {', '.join(required_keys)}. "
                "Use English-only string values. Do not include Chinese characters."
            )
            continue
        if has_cjk_text(parsed):
            last_error = "响应包含中文，必须改为纯英文。"
            current_prompt = (
                f"{prompt}\n\nYour previous result contained Chinese characters. "
                f"Return the same JSON keys ({', '.join(required_keys)}) again, "
                "but rewrite every string value in plain English only. No Chinese."
            )
            continue
        return parsed, serialize_resolved_ai_runtime(runtime)
    raise EnglishReadingError(f"模型连续多次未返回有效的纯英文内容。{last_error}")


def parse_json_object(value: str) -> dict[str, Any]:
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        match = JSON_RE.search(value)
        if match is None:
            raise EnglishReadingError("模型返回的 JSON 无效。") from exc
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError as nested_exc:
            raise EnglishReadingError("模型返回的 JSON 无效。") from nested_exc
    if not isinstance(parsed, dict):
        raise EnglishReadingError("模型返回结构无效。")
    return parsed


def normalize_english_payload(parsed: dict[str, Any], required_keys: tuple[str, ...]) -> dict[str, Any]:
    candidates: list[dict[str, Any]] = [parsed]
    for nest_key in NESTED_PAYLOAD_KEYS:
        nested = parsed.get(nest_key)
        if isinstance(nested, dict):
            candidates.append(nested)

    lowered_maps = [
        {str(key).strip().lower(): value for key, value in candidate.items()}
        for candidate in candidates
    ]
    normalized: dict[str, Any] = {}
    missing: list[str] = []
    for key in required_keys:
        aliases = REQUIRED_KEY_ALIASES.get(key, (key,))
        value = None
        for lowered in lowered_maps:
            for alias in aliases:
                if alias.lower() in lowered:
                    value = lowered[alias.lower()]
                    break
            if value is not None:
                break
        if value is None:
            missing.append(key)
            continue
        normalized[key] = _normalize_required_value(key, value)

    if missing:
        raise EnglishReadingError(f"缺少字段：{', '.join(missing)}")
    return normalized


def _normalize_required_value(key: str, value: Any) -> Any:
    if key in {"otherCommonUses", "howItWorks"}:
        if value is None:
            return []
        if isinstance(value, dict):
            return [value]
        if isinstance(value, list):
            return value
        if isinstance(value, str) and value.strip():
            return [{"meaning": value.strip()}] if key == "otherCommonUses" else [{"explanation": value.strip()}]
        return []
    if key in {"meaningHere", "englishExplanation", "title", "content"}:
        text = str(value or "").strip()
        if not text:
            raise EnglishReadingError(f"{key} 不能为空。")
        return text
    return value


def has_cjk_text(value: Any) -> bool:
    if isinstance(value, str):
        return CJK_RE.search(value) is not None
    if isinstance(value, dict):
        return any(has_cjk_text(item) for item in value.values())
    if isinstance(value, list):
        return any(has_cjk_text(item) for item in value)
    return False


def serialize_article(session: Session, article: EnglishReadingArticle) -> dict[str, Any]:
    targets = session.query(EnglishReadingTarget).filter_by(article_id=article.id).order_by(EnglishReadingTarget.start_offset.asc()).all()
    return {**serialize_article_summary(article), "content": article.content, "targets": [serialize_target(session, target) for target in targets]}


def serialize_article_summary(article: EnglishReadingArticle) -> dict[str, Any]:
    return {
        "id": article.id,
        "title": article.title,
        "kind": article.kind,
        "sourceType": article.source_type,
        "originalFilename": article.original_filename,
        "wordCount": article.word_count,
        "depth": article.depth,
        "parentArticleId": article.parent_article_id,
        "generationConfig": json.loads(article.generation_config_json or "{}"),
        "createdAt": article.created_at.isoformat() if article.created_at else None,
        "updatedAt": article.updated_at.isoformat() if article.updated_at else None,
    }


def serialize_target(session: Session, target: EnglishReadingTarget) -> dict[str, Any]:
    explanations = session.query(EnglishReadingExplanation).filter_by(target_id=target.id).order_by(EnglishReadingExplanation.created_at.desc()).all()
    links = (
        session.query(EnglishReadingArticle)
        .join(EnglishReadingArticleTargetLink, EnglishReadingArticleTargetLink.article_id == EnglishReadingArticle.id)
        .filter(EnglishReadingArticleTargetLink.target_id == target.id)
        .order_by(EnglishReadingArticle.created_at.desc())
        .all()
    )
    return {
        "id": target.id,
        "articleId": target.article_id,
        "type": target.target_type,
        "startOffset": target.start_offset,
        "endOffset": target.end_offset,
        "quote": target.quote,
        "normalizedValue": target.normalized_value,
        "priority": target.priority,
        "explanations": [serialize_explanation(item) for item in explanations],
        "linkedArticles": [serialize_article_summary(article) for article in links],
    }


def serialize_explanation(row: EnglishReadingExplanation) -> dict[str, Any]:
    return {
        "id": row.id,
        "targetId": row.target_id,
        "operationId": row.operation_id,
        "type": row.explanation_type,
        "cefr": row.cefr,
        "status": row.status,
        "result": json.loads(row.result_json or "{}"),
        "resolvedAi": json.loads(row.ai_runtime_json or "{}"),
        "createdAt": row.created_at.isoformat() if row.created_at else None,
    }


def serialize_run(row: EnglishReadingGenerationRun) -> dict[str, Any]:
    return {
        "id": row.id,
        "ownerArticleId": row.owner_article_id,
        "resultArticleId": row.result_article_id,
        "operationId": row.operation_id,
        "status": row.status,
        "targetIds": json.loads(row.target_ids_json or "[]"),
        "config": json.loads(row.config_json or "{}"),
        "coverage": json.loads(row.coverage_json or "{}"),
        "errorMessage": row.error_message,
    }


def get_article_row(session: Session, article_id: int) -> EnglishReadingArticle:
    row = session.get(EnglishReadingArticle, article_id)
    if row is None:
        raise EnglishReadingError("阅读文章不存在。")
    return row


def get_target_row(session: Session, target_id: int) -> EnglishReadingTarget:
    row = session.get(EnglishReadingTarget, target_id)
    if row is None:
        raise EnglishReadingError("学习目标不存在。")
    return row


def collect_descendant_ids(session: Session, article_id: int) -> list[int]:
    result: list[int] = []
    pending = [article_id]
    while pending:
        parent_id = pending.pop()
        children = session.query(EnglishReadingArticle.id).filter_by(parent_article_id=parent_id).all()
        child_ids = [int(row[0]) for row in children]
        result.extend(child_ids)
        pending.extend(child_ids)
    return result


def normalize_cefr(value: str) -> str:
    safe_value = str(value or "").strip().upper()
    if safe_value not in CEFR_LEVELS:
        raise EnglishReadingError("CEFR 等级无效。")
    return safe_value


def normalize_operation_id(value: str) -> str:
    safe_value = str(value or "").strip()
    if not 8 <= len(safe_value) <= 80:
        raise EnglishReadingError("operation_id 长度必须在 8 到 80 个字符之间。")
    return safe_value
