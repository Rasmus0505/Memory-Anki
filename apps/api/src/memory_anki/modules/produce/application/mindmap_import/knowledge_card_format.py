"""Card and quiz shaping for 丹丹 knowledge-list palaces.

The live importer calls these functions. Tests drive the same entry points.
"""

from __future__ import annotations

import re
from typing import Any

_INDEX_RE = re.compile(
    r"^(?:"
    r"知识点\s*[0-9０-９一二三四五六七八九十百千]*"
    r"|第[0-9０-９一二三四五六七八九十百千]+(?=[、，,．.\s])"
    r"|[（(][0-9０-９一二三四五六七八九十百千]+[）)]"
    r"|[0-9０-９]+[、.．]"
    r"|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫]"
    r")"
    r"[、，,．.\s]*"
)
_GLUE_RE = re.compile(r"^(.{1,16}?)(?:——|--|—|：|:)(.+)$")
_CONTRAST_LABELS = frozenset({"不同点", "相同点", "对比", "区别"})
_OUT_OF_SCOPE_CHAPTER_MARKERS = (
    "近代教育体制的变革",
    "南京国民政府时期的教育",
    "国民政府时期的教育",
    "现代教育家的教育理论与实践",
    "新民主主义教育的发展",
)


def format_continuous_block(text: str) -> dict[str, Any]:
    """A single uninterrupted text card stays one node titled 图中全文."""
    del text
    return {"title": "图中全文", "children": []}


def format_knowledge_tree(tree: dict[str, Any]) -> dict[str, Any]:
    """Apply label stripping, pair splits, echo trim, and mnemonic cards."""
    title = str(tree.get("title") or "").strip() or "未命名"
    raw_children = tree.get("children") if isinstance(tree.get("children"), list) else []
    children: list[dict[str, Any]] = []
    for child in raw_children:
        if isinstance(child, dict):
            children.extend(_format_node(child, parent_text=None))
    return {"title": title, "children": children}


def prepare_quiz_import(
    items: list[dict[str, Any]],
    *,
    import_batch: str = "cn-edu-ch1-7",
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Dedupe readable in-scope questions and prefix only confirmed source tags.

    Returns ``(ready_payloads, skipped)``. Ready payloads are the dicts passed
    to ``batch_create_questions`` (stem, options, answer, analysis, source_meta).
    """
    ready: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    grouped: dict[tuple[Any, ...], dict[str, Any]] = {}
    order: list[tuple[Any, ...]] = []

    for item in items:
        if _is_out_of_scope_chapter(str(item.get("chapter_title") or "")):
            skipped.append({**item, "skip_reason": "out_of_scope_chapter"})
            continue
        stem = _clean_stem(str(item.get("stem") or ""))
        options = _normalize_options(item.get("options"))
        answer = str(item.get("correct_option_id") or item.get("answer") or "").strip()
        reference = str(item.get("reference_answer") or "").strip()
        question_type = str(item.get("question_type") or "").strip()
        if not question_type:
            question_type = "multiple_choice" if options else "short_answer"
        if not stem or (question_type == "multiple_choice" and (not options or not answer)):
            skipped.append({**item, "skip_reason": "unreadable"})
            continue
        if question_type != "multiple_choice" and not (reference or answer):
            skipped.append({**item, "skip_reason": "unreadable"})
            continue
        knowledge_point = str(item.get("knowledge_point") or "").strip()
        key = (
            _identity_text(stem),
            tuple((opt["id"], _identity_text(opt["text"])) for opt in options),
            answer or reference,
            _identity_text(knowledge_point),
        )
        sources = _confirmed_sources(item.get("sources"))
        if key not in grouped:
            grouped[key] = {
                "stem_body": stem,
                "options": options,
                "question_type": question_type,
                "correct_option_id": answer if question_type == "multiple_choice" else "",
                "reference_answer": reference or (answer if question_type != "multiple_choice" else ""),
                "analysis": str(item.get("analysis") or "").strip(),
                "knowledge_point": knowledge_point,
                "sources": [],
                "bind_text": knowledge_point,
            }
            order.append(key)
        bucket = grouped[key]
        for source in sources:
            if source not in bucket["sources"]:
                bucket["sources"].append(source)
        if not bucket["analysis"] and item.get("analysis"):
            bucket["analysis"] = str(item.get("analysis") or "").strip()

    for key in order:
        bucket = grouped[key]
        tags = "".join(_source_tag(source) for source in bucket["sources"])
        payload: dict[str, Any] = {
            "question_type": bucket["question_type"],
            "stem": f"{tags}{bucket['stem_body']}",
            "options": bucket["options"] if bucket["question_type"] == "multiple_choice" else [],
            "analysis": bucket["analysis"],
            "source_meta": {
                "import_batch": import_batch,
                "knowledge_point": bucket["knowledge_point"],
                "sources": bucket["sources"],
            },
            "bind_text": bucket["bind_text"],
        }
        if bucket["question_type"] == "multiple_choice":
            payload["correct_option_id"] = bucket["correct_option_id"]
        else:
            payload["reference_answer"] = bucket["reference_answer"]
        ready.append(payload)
    return ready, skipped


def prepare_quiz_rows_with_subjective_twins(
    items: list[dict[str, Any]],
    *,
    import_batch: str = "jiaoyuan",
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Same as ``prepare_quiz_import``, plus a short_answer twin for every choice.

    Native short-answer items stay short_answer and are not turned into choices.
    The twin uses the same source tags, knowledge point, and bind text. Its stem
    and reference answer follow the 选择/主观 rewrite: drop 下列/哪项/正确的是
    scaffolding; 不正确/不符合/不包括 asks 有哪些 and answers with the other
    options; otherwise 是什么 / 有哪些 / 简述, answering with the correct option.
    """
    ready, skipped = prepare_quiz_import(items, import_batch=import_batch)
    expanded: list[dict[str, Any]] = []
    for payload in ready:
        expanded.append(payload)
        if payload.get("question_type") != "multiple_choice":
            continue
        body = _clean_stem(str(payload.get("stem") or ""))
        stem = str(payload.get("stem") or "")
        prefix = stem[: stem.rfind(body)] if body and body in stem else ""
        rewritten = rewrite_choice_to_subjective(
            body,
            payload.get("options") or [],
            str(payload.get("correct_option_id") or ""),
        )
        twin = {
            "question_type": "short_answer",
            "stem": f"{prefix}{rewritten['stem']}",
            "options": [],
            "reference_answer": rewritten["reference_answer"],
            "analysis": payload.get("analysis") or "",
            "source_meta": {
                "import_batch": (payload.get("source_meta") or {}).get("import_batch") or import_batch,
                "knowledge_point": (payload.get("source_meta") or {}).get("knowledge_point") or "",
                "sources": list((payload.get("source_meta") or {}).get("sources") or []),
                "subjective_of": "multiple_choice",
            },
            "bind_text": payload.get("bind_text") or "",
        }
        expanded.append(twin)
    return _dedupe_expanded(expanded), skipped


def rewrite_choice_to_subjective(
    stem: str,
    options: list[dict[str, str]],
    correct_option_id: str,
) -> dict[str, str]:
    """Port of the shipped ``rewriteMcqForSubjective`` wording."""
    original = str(stem or "").strip()
    normalized = _normalize_choice_stem(original)
    correct = str(correct_option_id or "").strip()
    for kind, pattern, topic_of, ask in _SUBJECTIVE_MATCHERS:
        match = pattern.match(normalized)
        if match is None:
            continue
        asked = ask(topic_of(match))
        if not asked or _WHICH_ITEM_RE.search(asked):
            continue
        reference = (
            _except_reference(options, correct)
            if kind == "except"
            else _positive_reference(options, correct)
        )
        return {"stem": asked, "reference_answer": reference, "kind": kind}
    if not normalized or not _OPTION_SCAFFOLD_RE.search(normalized):
        return {
            "stem": original,
            "reference_answer": _positive_reference(options, correct),
            "kind": "positive",
        }
    return {
        "stem": _fallback_subjective_stem(normalized),
        "reference_answer": _positive_reference(options, correct),
        "kind": "positive",
    }


def _dedupe_expanded(payloads: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[Any, ...], dict[str, Any]] = {}
    order: list[tuple[Any, ...]] = []
    for payload in payloads:
        options = _normalize_options(payload.get("options"))
        answer = str(payload.get("correct_option_id") or payload.get("reference_answer") or "").strip()
        knowledge_point = str((payload.get("source_meta") or {}).get("knowledge_point") or "").strip()
        key = (
            str(payload.get("question_type") or ""),
            _identity_text(str(payload.get("stem") or "")),
            tuple((opt["id"], _identity_text(opt["text"])) for opt in options),
            _identity_text(answer),
            _identity_text(knowledge_point),
        )
        if key not in grouped:
            grouped[key] = payload
            order.append(key)
            continue
        current = grouped[key]
        sources = list((current.get("source_meta") or {}).get("sources") or [])
        for source in (payload.get("source_meta") or {}).get("sources") or []:
            if source not in sources:
                sources.append(source)
        current["source_meta"]["sources"] = sources
        if not current.get("analysis") and payload.get("analysis"):
            current["analysis"] = payload["analysis"]
    return [grouped[key] for key in order]


_WHICH_ITEM_RE = re.compile(r"哪(?:一)?[项个种]")
_OPTION_SCAFFOLD_RE = re.compile(
    r"(?:以下|下列|下面)|哪(?:一)?[项个种]|正确的是|不正确的是|不符合|不属于|不包括"
)


def _clean_topic(raw: str) -> str:
    cleaned = re.sub(r"\s+", " ", raw)
    cleaned = re.sub(r"[（(]\s*[）)]\s*$", "", cleaned)
    cleaned = re.sub(r"[？?。．.、，,：:；;]+$", "", cleaned)
    cleaned = re.sub(r"的(?:表述|说法|叙述|描述)(?:中)?$", "", cleaned)
    cleaned = re.sub(r"的是$", "", cleaned)
    cleaned = re.sub(r"[（(]\s*[）)]\s*$", "", cleaned)
    return cleaned.strip()


def _normalize_choice_stem(stem: str) -> str:
    cleaned = re.sub(r"\s+", " ", stem)
    return re.sub(r"[（(]\s*[）)]\s*$", "", cleaned).strip()


def _except_ask(topic: str) -> str:
    cleaned = _clean_topic(topic)
    return f"{cleaned}有哪些" if cleaned else "有哪些"


def _positive_ask(topic: str) -> str:
    cleaned = _clean_topic(topic)
    if not cleaned:
        return "简述其内容"
    if re.search(r"(实践|要求|规定|任务)", cleaned):
        return f"{cleaned}要求什么"
    if re.search(r"(原则|观点|思想|主张|特点|内容|意义|作用|措施|途径)", cleaned):
        return f"{cleaned}有哪些"
    return f"简述{cleaned}"


def _identity_ask(topic: str) -> str:
    cleaned = _clean_topic(topic)
    return f"{cleaned}是什么" if cleaned else "是什么"


def _belong_ask(topic: str) -> str:
    cleaned = _clean_topic(topic)
    return f"{cleaned}有哪些" if cleaned else "有哪些"


def _option_text(options: list[dict[str, str]], option_id: str) -> str:
    for item in options:
        if str(item.get("id") or "") == option_id:
            return str(item.get("text") or "").strip()
    return ""


def _except_reference(options: list[dict[str, str]], correct_option_id: str) -> str:
    return "；".join(
        str(item.get("text") or "").strip()
        for item in options
        if str(item.get("id") or "") != correct_option_id and str(item.get("text") or "").strip()
    )


def _positive_reference(options: list[dict[str, str]], correct_option_id: str) -> str:
    return _option_text(options, correct_option_id)


def _fallback_subjective_stem(normalized: str) -> str:
    stripped = normalized
    stripped = re.sub(r"^(?:以下|下列|下面)", "", stripped)
    stripped = re.sub(r"哪(?:一)?[项个种]", "", stripped)
    stripped = re.sub(r"不(?:正确|符合|属于|包括)的是", "", stripped)
    stripped = re.sub(r"正确的是", "", stripped)
    stripped = re.sub(r"[（(]\s*[）)]", "", stripped).strip()
    cleaned = _clean_topic(stripped)
    if not cleaned:
        return "简述其内容"
    if re.search(r"(实践|要求|规定|任务)", cleaned):
        return f"{cleaned}要求什么"
    if re.search(r"(原则|观点|思想|主张|特点|内容|意义|作用|措施|途径)", cleaned):
        return f"{cleaned}有哪些"
    if re.search(r"[是有]$", cleaned):
        return f"{cleaned}什么"
    return f"简述{cleaned}"


_SUBJECTIVE_MATCHERS: list[tuple[Any, ...]] = [
    (
        "except",
        re.compile(r"^(?:以下|下列|下面)哪(?:一)?[项个种]?不(?:符合|属于|包括|是)(.+)$"),
        lambda match: match.group(1) or "",
        _except_ask,
    ),
    (
        "except",
        re.compile(
            r"^(?:以下|下列|下面)(?:有关|关于)(.+?)的(?:表述|说法|叙述|描述)(?:中)?[，,]?不(?:正确|符合)的是.*$"
        ),
        lambda match: match.group(1) or "",
        _except_ask,
    ),
    (
        "except",
        re.compile(r"^关于(.+?)[，,].{0,16}不(?:正确|符合)的是.*$"),
        lambda match: match.group(1) or "",
        _except_ask,
    ),
    (
        "except",
        re.compile(r"^(?:以下|下列|下面).{0,12}不(?:正确|符合|属于|包括)的是(.+)$"),
        lambda match: match.group(1) or "",
        _except_ask,
    ),
    (
        "except",
        re.compile(r"^(.+?)(?:中)?不(?:正确|符合|属于)的是.*$"),
        lambda match: match.group(1) or "",
        _except_ask,
    ),
    (
        "positive",
        re.compile(r"^(?:以下|下列|下面)有关(.+?)的(?:表述|说法|叙述|描述)中正确的是.*$"),
        lambda match: match.group(1) or "",
        _positive_ask,
    ),
    (
        "positive",
        re.compile(
            r"^(?:以下|下列|下面)关于(.+?)的(?:表述|说法|叙述|描述)(?:中)?[，,]?正确的是.*$"
        ),
        lambda match: match.group(1) or "",
        _positive_ask,
    ),
    (
        "positive",
        re.compile(r"^关于(.+?)[，,].{0,20}正确的是.*$"),
        lambda match: match.group(1) or "",
        _positive_ask,
    ),
    (
        "positive",
        re.compile(r"^(?:以下|下列|下面)哪(?:一)?[项个种]?属于(.+)$"),
        lambda match: match.group(1) or "",
        _belong_ask,
    ),
    (
        "positive",
        re.compile(r"^(?:以下|下列|下面)属于(.+?)的是.*$"),
        lambda match: match.group(1) or "",
        _belong_ask,
    ),
    (
        "positive",
        re.compile(r"^(?:以下|下列|下面)哪(?:一)?[项个种]?是(.+)$"),
        lambda match: match.group(1) or "",
        _identity_ask,
    ),
    (
        "positive",
        re.compile(r"^(?:以下|下列|下面)(?:哪(?:一)?[项个种]?)?(?:说法|表述)?正确的是.*$"),
        lambda match: "",
        lambda _topic: "简述其内容",
    ),
]


def bind_text_for_question(payload: dict[str, Any], nodes: list[dict[str, Any]]) -> str:
    """Pick the node text that states this question's 考点, else empty."""
    needle = str(payload.get("bind_text") or payload.get("source_meta", {}).get("knowledge_point") or "").strip()
    if not needle:
        return ""
    found = ""
    for text in _walk_texts(nodes):
        if needle in text and len(text) >= len(found):
            found = text
        elif text and text in needle and len(text) > len(found):
            found = text
    return found


def _format_node(node: dict[str, Any], *, parent_text: str | None) -> list[dict[str, Any]]:
    raw_text = str(node.get("text") or "").strip()
    if not raw_text:
        return []
    text = _strip_label(raw_text)
    if parent_text:
        text = _trim_parent_echo(parent_text, text)
    label, pieces = _split_glued(text)
    if not label:
        return []
    raw_children = node.get("children") if isinstance(node.get("children"), list) else []
    extra = [{"text": piece, "children": []} for piece in pieces]
    formatted: list[dict[str, Any]] = []
    for child in [*extra, *raw_children]:
        if isinstance(child, dict):
            formatted.extend(_format_node(child, parent_text=label))
    if len(formatted) >= 2:
        mnemonic = _mnemonic_from_children([child["text"] for child in formatted])
        if mnemonic:
            formatted.insert(0, {"text": mnemonic, "children": []})
    result: dict[str, Any] = {"text": label, "children": formatted}
    marks = _keep_substring_marks(node.get("emphasis_marks"), label)
    if marks:
        result["emphasis_marks"] = marks
    return [result]


def _strip_label(text: str) -> str:
    cleaned = text.strip()
    matched = _INDEX_RE.match(cleaned)
    if not matched:
        return cleaned
    cleaned = cleaned[matched.end() :].strip()
    if cleaned.endswith(("。", ".")):
        cleaned = cleaned[:-1].strip()
    return cleaned


def _split_glued(text: str) -> tuple[str, list[str]]:
    match = _GLUE_RE.match(text)
    if match is None:
        return text, []
    label = match.group(1).strip()
    rest = match.group(2).strip()
    if not label or not rest:
        return text, []
    clauses = _split_contrast_clauses(rest) if label in _CONTRAST_LABELS else [rest]
    clauses = [clause.strip(" 。;；") for clause in clauses if clause.strip(" 。;；")]
    if not clauses:
        return text, []
    return label, clauses


def _split_contrast_clauses(rest: str) -> list[str]:
    parts = [part.strip() for part in re.split(r"[；;]", rest) if part.strip()]
    return parts or [rest]


def _trim_parent_echo(parent_text: str, child_text: str) -> str:
    parent = parent_text.strip()
    child = child_text.strip()
    if not parent or not child.startswith(parent):
        return child
    rest = child[len(parent) :].lstrip("的是：:，,、 ")
    return rest or child


def _mnemonic_from_children(texts: list[str]) -> str:
    chars: list[str] = []
    for text in texts:
        core = _core_char(text)
        if core:
            chars.append(core)
    if len(chars) < 2:
        return ""
    return "".join(chars)


def _core_char(text: str) -> str:
    cleaned = re.sub(r"[《》〈〉「」『』\"“”'‘’\s（）()\[\]【】]", "", text)
    for char in cleaned:
        if "\u4e00" <= char <= "\u9fff":
            return char
    return ""


def _keep_substring_marks(raw: Any, node_text: str) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        return []
    marks: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        marked = str(item.get("text") or "")
        if not marked or marked not in node_text:
            continue
        if any(existing["text"] == marked for existing in marks):
            continue
        marks.append({"kind": "highlight", "text": marked})
    return marks


def _clean_stem(stem: str) -> str:
    return re.sub(r"^(?:【[^】]*】)+", "", stem).strip()


def _identity_text(value: str) -> str:
    return re.sub(r"\s+", "", value)


def _normalize_options(raw: Any) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        return []
    options: list[dict[str, str]] = []
    for item in raw:
        if isinstance(item, dict):
            option_id = str(item.get("id") or "").strip()
            text = str(item.get("text") or "").strip()
        else:
            option_id = ""
            text = str(item or "").strip()
        if option_id and text:
            options.append({"id": option_id, "text": text})
    return options


def _confirmed_sources(raw: Any) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        return []
    sources: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        source = {
            key: str(item.get(key) or "").strip()
            for key in ("teacher", "kind", "year")
            if str(item.get(key) or "").strip()
        }
        if source and source not in sources:
            sources.append(source)
    return sources


def _source_tag(source: dict[str, str]) -> str:
    parts = [source[key] for key in ("teacher", "kind", "year") if source.get(key)]
    if not parts:
        return ""
    return "【" + "｜".join(parts) + "】"


def _is_out_of_scope_chapter(title: str) -> bool:
    return any(marker in title for marker in _OUT_OF_SCOPE_CHAPTER_MARKERS)


def _walk_texts(nodes: list[dict[str, Any]]) -> list[str]:
    texts: list[str] = []
    for node in nodes:
        text = str(node.get("text") or "")
        if text:
            texts.append(text)
        children = node.get("children")
        if isinstance(children, list):
            texts.extend(_walk_texts([child for child in children if isinstance(child, dict)]))
    return texts
