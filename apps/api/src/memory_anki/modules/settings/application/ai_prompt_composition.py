from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.misc import (
    AiPromptBlock,
    AiPromptBlockVersion,
    AiPromptSceneDefault,
    AiPromptSceneVersion,
    Config,
)

from .ai_prompt_compiler import lint_compiled_prompt, render_prompt_text
from .ai_prompt_split_seeds import AI_SPLIT_BLOCK_SEEDS, AI_SPLIT_SCENE_SEEDS
from .ai_prompts import (
    PLACEHOLDER_PATTERN,
    PROMPT_DEFINITIONS,
    AiPromptValidationError,
    get_prompt_template,
)

LAYER_ORDER = {
    "role": 10,
    "task": 20,
    "content": 30,
    "boundary": 40,
    "output": 50,
    "quality": 60,
}


@dataclass(frozen=True, slots=True)
class PromptBlockSeed:
    key: str
    label: str
    description: str
    layer: str
    sort_order: int
    template: str


@dataclass(frozen=True, slots=True)
class PromptSceneSeed:
    scene_key: str
    prompt_key: str
    block_keys: tuple[str, ...]
    scene_instruction: str
    recommended_block_keys: tuple[str, ...] = ()


BUILTIN_BLOCKS = (
    PromptBlockSeed(
        key="role.strict_json",
        label="严格 JSON 助手",
        description="要求模型只输出可解析 JSON，不输出解释或 Markdown。",
        layer="role",
        sort_order=10,
        template="你是一个严格输出 JSON 的助手。只输出 JSON，不要输出 Markdown，不要输出解释。",
    ),
    PromptBlockSeed(
        key="role.source_extractor",
        label="忠实资料提取助手",
        description="用于 OCR、转写和资料抽取，不主动组织或补充内容。",
        layer="role",
        sort_order=20,
        template="你是一个忠实的资料提取助手，只处理输入中实际可见或明确提供的内容。",
    ),
    PromptBlockSeed(
        key="content.fidelity",
        label="忠实原文与禁止编造",
        description="保留来源措辞和信息，不总结、删减、改写或编造。",
        layer="content",
        sort_order=10,
        template=(
            "严格保留目标范围内的原文信息，不要总结、删减、改写或补充来源中不存在的内容；"
            "允许按原意拆分并列要点。"
        ),
    ),
    PromptBlockSeed(
        key="content.semantic_preservation",
        label="语义保持",
        description="允许调整表达，但必须保持原意、事实和关键限制。",
        layer="content",
        sort_order=20,
        template="允许调整表达和组织方式，但必须保持原意、事实、条件和关键限制，不得引入新结论。",
    ),
    PromptBlockSeed(
        key="content.literal_ocr",
        label="OCR 逐字提取",
        description="用于文字识别，禁止总结和结构化改写。",
        layer="content",
        sort_order=30,
        template="按自然阅读顺序逐字提取正文；不要总结、解释、补全缺失文字或改写表达。",
    ),
    PromptBlockSeed(
        key="boundary.document_chapter",
        label="教材章节边界",
        description="综合正文层级，保留跨页续文并在下一同级章节停止。",
        layer="boundary",
        sort_order=10,
        template=(
            "不要假设任何页面天然是结构页。综合标题、编号、段落、缩进和并列关系判断层级；"
            "精华提要、目录、表格和示意图只能辅助判断，不能代替正文。"
            "保留跨页续文，遇到下一同级章节标题时立即停止。"
        ),
    ),
    PromptBlockSeed(
        key="boundary.noise_filter",
        label="页面噪声排除",
        description="排除页眉页脚、页码、广告、群号和水印。",
        layer="boundary",
        sort_order=20,
        template="排除页眉、页脚、页码、广告、群号、版权信息和扫描水印。",
    ),
    PromptBlockSeed(
        key="boundary.explicit_structure",
        label="显式结构图补全",
        description="仅在用户明确指定结构图时，以其为骨架补充正文。",
        layer="boundary",
        sort_order=30,
        template=(
            "用户已显式指定结构图。以识别出的结构为主骨架，用其余正文补全节点；"
            "不得让正文中的下一同级章节扩展当前结构。"
        ),
    ),
    PromptBlockSeed(
        key="output.mindmap_json",
        label="脑图 JSON Schema",
        description="统一脑图根节点和 children 递归结构。",
        layer="output",
        sort_order=10,
        template=(
            '顶层格式必须为 {"title":"根节点标题","children":[{"text":"节点文字","children":[]}]}。'
            "每个节点必须有非空 text 和数组 children；无子节点也必须输出 children: []。"
            "多个并列要点必须拆成并列 children。"
        ),
    ),
    PromptBlockSeed(
        key="quality.json_integrity",
        label="JSON 完整性自检",
        description="输出前检查 JSON、必填字段和有效内容节点。",
        layer="quality",
        sort_order=10,
        template="输出前检查括号、引号和数组完整闭合，并确认至少包含一个有效内容节点。",
    ),
    PromptBlockSeed(
        key="quality.source_grounding",
        label="来源证据自检",
        description="检查生成内容是否都能回溯到输入证据。",
        layer="quality",
        sort_order=20,
        template="输出前逐项检查：每个事实、题目或结论都必须能回溯到输入资料，不得凭常识补写。",
    ),
    *(PromptBlockSeed(**seed) for seed in AI_SPLIT_BLOCK_SEEDS),
)


PROMPT_SCENE_BINDINGS = {
    "ai_prompt_import_image_mindmap": "vision_image_mindmap",
    "ai_prompt_import_image_text": "vision_image_text",
    "ai_prompt_import_document_mindmap": "vision_batch_mindmap",
    "ai_prompt_import_batch_mindmap": "vision_structure_mindmap",
    "ai_prompt_import_ocr_mindmap_format": "mindmap_ocr_formatter",
    "ai_prompt_mindmap_ai_split_system": "ai_split",
    "ai_prompt_peg_association": "peg_association_suggestions",
    "ai_prompt_ai_learning_workbench": "review_ai_learning",
    "ai_prompt_batch_palace_generation": "batch_palace_generation",
    "ai_prompt_batch_quiz_generation": "batch_quiz_generation",
    "ai_prompt_palace_quiz_generate": "quiz_image_generation",
    "ai_prompt_palace_quiz_short_answer_feedback": "quiz_short_answer_feedback",
    "ai_prompt_palace_quiz_group_by_mini_palace": "quiz_mini_palace_grouping",
    "ai_prompt_palace_quiz_classify_existing_to_mini_palace": "quiz_mini_palace_grouping_existing",
    "ai_prompt_palace_quiz_text_formatting": "quiz_text_generation",
    "ai_prompt_palace_quiz_review_mindmap": "quiz_review_mindmap_generation",
    "ai_prompt_palace_quiz_source_pair_transcription": "quiz_source_pair_transcription",
    "ai_prompt_english_reading_generate": "english_reading",
    "ai_prompt_english_translation_batch": "translation_course_batch",
    "ai_prompt_english_translation_single": "translation_reading_sentence",
}

SCENE_PROMPT_BINDINGS = {scene: prompt for prompt, scene in PROMPT_SCENE_BINDINGS.items()}


def _mindmap_scene_instruction(task: str) -> str:
    return f"任务：{task}\n根据输入中实际出现的标题、编号、段落、缩进和并列关系建立层级。"


BUILTIN_SCENES: dict[str, PromptSceneSeed] = {
    **{seed["scene_key"]: PromptSceneSeed(**seed) for seed in AI_SPLIT_SCENE_SEEDS},
    "vision_image_mindmap": PromptSceneSeed(
        scene_key="vision_image_mindmap",
        prompt_key="ai_prompt_import_image_mindmap",
        block_keys=("role.strict_json", "content.fidelity", "output.mindmap_json", "quality.json_integrity"),
        scene_instruction=_mindmap_scene_instruction("识别单张现成脑图截图，尽量一比一还原图中的层级和顺序。"),
        recommended_block_keys=("role.strict_json", "content.fidelity", "output.mindmap_json"),
    ),
    "vision_batch_mindmap": PromptSceneSeed(
        scene_key="vision_batch_mindmap",
        prompt_key="ai_prompt_import_document_mindmap",
        block_keys=(
            "role.strict_json",
            "content.fidelity",
            "boundary.document_chapter",
            "boundary.noise_filter",
            "output.mindmap_json",
            "quality.json_integrity",
        ),
        scene_instruction=_mindmap_scene_instruction("读取全部教材正文页面，生成目标章节的完整思维导图。"),
        recommended_block_keys=(
            "role.strict_json",
            "content.fidelity",
            "boundary.document_chapter",
            "output.mindmap_json",
        ),
    ),
    "vision_structure_mindmap": PromptSceneSeed(
        scene_key="vision_structure_mindmap",
        prompt_key="ai_prompt_import_batch_mindmap",
        block_keys=(
            "role.strict_json",
            "content.fidelity",
            "boundary.explicit_structure",
            "boundary.noise_filter",
            "output.mindmap_json",
            "quality.json_integrity",
        ),
        scene_instruction=(
            "任务：根据用户显式指定的结构图和其余正文图片补全脑图。\n"
            "已识别的结构图 JSON：\n{{structure_tree_json}}"
        ),
        recommended_block_keys=("role.strict_json", "boundary.explicit_structure", "output.mindmap_json"),
    ),
    "mindmap_ocr_formatter": PromptSceneSeed(
        scene_key="mindmap_ocr_formatter",
        prompt_key="ai_prompt_import_ocr_mindmap_format",
        block_keys=(
            "role.strict_json",
            "content.fidelity",
            "boundary.document_chapter",
            "boundary.noise_filter",
            "output.mindmap_json",
            "quality.json_integrity",
        ),
        scene_instruction=(
            "任务：把带页码的逐页 OCR 原文整理为目标章节脑图。\n"
            "目标章节标题：{{target_title}}\n\n逐页 OCR 原文：\n{{ocr_text}}"
        ),
        recommended_block_keys=(
            "role.strict_json",
            "content.fidelity",
            "boundary.document_chapter",
            "output.mindmap_json",
        ),
    ),
    "vision_image_text": PromptSceneSeed(
        scene_key="vision_image_text",
        prompt_key="ai_prompt_import_image_text",
        block_keys=("role.source_extractor", "content.literal_ocr", "boundary.noise_filter"),
        scene_instruction="任务：提取图片或 PDF 页面中的正文文字，保持自然阅读顺序和段落。",
        recommended_block_keys=("content.literal_ocr",),
    ),
    "peg_association_suggestions": PromptSceneSeed(
        scene_key="peg_association_suggestions",
        prompt_key="ai_prompt_peg_association",
        block_keys=("role.strict_json", "content.semantic_preservation", "quality.source_grounding"),
        scene_instruction=PROMPT_DEFINITIONS["ai_prompt_peg_association"].default_template,
        recommended_block_keys=("quality.source_grounding",),
    ),
    "review_ai_learning": PromptSceneSeed(
        scene_key="review_ai_learning",
        prompt_key="ai_prompt_ai_learning_workbench",
        block_keys=("content.semantic_preservation", "quality.source_grounding"),
        scene_instruction=(
            "任务：在复习 AI 学习工作台中处理冻结的学习上下文。"
            "优先依据上下文，明确区分事实、推断和待核实内容；不要声称已经修改或发布学习内容。"
        ),
        recommended_block_keys=("content.semantic_preservation",),
    ),
    "batch_palace_generation": PromptSceneSeed(
        scene_key="batch_palace_generation",
        prompt_key="ai_prompt_batch_palace_generation",
        block_keys=("content.fidelity", "boundary.document_chapter", "boundary.noise_filter", "quality.source_grounding"),
        scene_instruction=PROMPT_DEFINITIONS["ai_prompt_batch_palace_generation"].default_template,
        recommended_block_keys=("content.fidelity", "boundary.document_chapter"),
    ),
    "batch_quiz_generation": PromptSceneSeed(
        scene_key="batch_quiz_generation",
        prompt_key="ai_prompt_batch_quiz_generation",
        block_keys=("quality.source_grounding",),
        scene_instruction=PROMPT_DEFINITIONS["ai_prompt_batch_quiz_generation"].default_template,
        recommended_block_keys=("quality.source_grounding",),
    ),
}


for _prompt_key, _scene_key in PROMPT_SCENE_BINDINGS.items():
    if _scene_key in BUILTIN_SCENES:
        continue
    _definition = PROMPT_DEFINITIONS[_prompt_key]
    _blocks = ("quality.source_grounding",) if "quiz" in _scene_key else ()
    BUILTIN_SCENES[_scene_key] = PromptSceneSeed(
        scene_key=_scene_key,
        prompt_key=_prompt_key,
        block_keys=_blocks,
        scene_instruction=_definition.default_template,
        recommended_block_keys=_blocks,
    )


def _json_load(value: str | None, default: Any) -> Any:
    try:
        parsed = json.loads(value or "")
    except json.JSONDecodeError:
        return default
    return parsed if parsed is not None else default


def ensure_prompt_composition_seed(session: Session) -> None:
    changed = False
    now = utc_now_naive()
    for block_seed in BUILTIN_BLOCKS:
        row = session.get(AiPromptBlock, block_seed.key)
        if row is None:
            version_id = uuid.uuid4().hex
            session.add(
                AiPromptBlock(
                    key=block_seed.key,
                    label=block_seed.label,
                    description=block_seed.description,
                    layer=block_seed.layer,
                    sort_order=block_seed.sort_order,
                    applicable_scenes_json="[]",
                    placeholders_json=json.dumps(sorted(set(PLACEHOLDER_PATTERN.findall(block_seed.template)))),
                    active_version_id=version_id,
                    is_builtin=True,
                    is_active=True,
                )
            )
            session.add(
                AiPromptBlockVersion(
                    id=version_id,
                    block_key=block_seed.key,
                    template=block_seed.template,
                    status="active",
                    source="builtin",
                    activated_at=now,
                )
            )
            changed = True
        else:
            row.label = block_seed.label
            row.description = block_seed.description
            row.layer = block_seed.layer
            row.sort_order = block_seed.sort_order
            row.is_builtin = True

    for scene_seed in BUILTIN_SCENES.values():
        scene_row = session.get(AiPromptSceneDefault, scene_seed.scene_key)
        if scene_row is not None:
            continue
        override = session.query(Config).filter_by(key=scene_seed.prompt_key).first()
        block_keys = list(scene_seed.block_keys)
        scene_instruction = scene_seed.scene_instruction
        source = "builtin"
        if override is not None and override.value.strip():
            legacy_key = f"legacy.{scene_seed.prompt_key}"
            legacy = session.get(AiPromptBlock, legacy_key)
            if legacy is None:
                legacy_version_id = uuid.uuid4().hex
                session.add(
                    AiPromptBlock(
                        key=legacy_key,
                        label=f"历史完整提示词：{PROMPT_DEFINITIONS[scene_seed.prompt_key].label}",
                        description="从旧版完整自定义提示词迁移，仅供当前场景兼容。",
                        layer="task",
                        sort_order=10,
                        applicable_scenes_json=json.dumps([scene_seed.scene_key], ensure_ascii=False),
                        placeholders_json=json.dumps(sorted(set(PLACEHOLDER_PATTERN.findall(override.value)))),
                        active_version_id=legacy_version_id,
                        is_builtin=False,
                        is_active=True,
                    )
                )
                session.add(
                    AiPromptBlockVersion(
                        id=legacy_version_id,
                        block_key=legacy_key,
                        template=override.value.strip(),
                        status="active",
                        source="migrated",
                        activated_at=now,
                    )
                )
            block_keys = [legacy_key]
            scene_instruction = ""
            source = "migrated"
        version_id = uuid.uuid4().hex
        session.add(
            AiPromptSceneDefault(
                scene_key=scene_seed.scene_key,
                prompt_key=scene_seed.prompt_key,
                active_version_id=version_id,
            )
        )
        session.add(
            AiPromptSceneVersion(
                id=version_id,
                scene_key=scene_seed.scene_key,
                block_keys_json=json.dumps(block_keys, ensure_ascii=False),
                scene_instruction=scene_instruction,
                status="active",
                source=source,
                activated_at=now,
            )
        )
        changed = True
    if changed:
        session.commit()


def _active_scene_version(session: Session, scene_key: str) -> AiPromptSceneVersion:
    row = session.get(AiPromptSceneDefault, scene_key)
    if row is None or not row.active_version_id:
        raise AiPromptValidationError(f"未知的提示词场景：{scene_key}")
    version = session.get(AiPromptSceneVersion, row.active_version_id)
    if version is None:
        raise AiPromptValidationError(f"提示词场景缺少活动版本：{scene_key}")
    return version


def _active_block_version(session: Session, block_key: str) -> tuple[AiPromptBlock, AiPromptBlockVersion]:
    block = session.get(AiPromptBlock, block_key)
    if block is None or not block.is_active or not block.active_version_id:
        raise AiPromptValidationError(f"未知或已停用的提示词块：{block_key}")
    version = session.get(AiPromptBlockVersion, block.active_version_id)
    if version is None:
        raise AiPromptValidationError(f"提示词块缺少活动版本：{block_key}")
    return block, version


def _static_scene(seed: PromptSceneSeed) -> dict[str, Any]:
    block_map = {item.key: item for item in BUILTIN_BLOCKS}
    return {
        "block_keys": list(seed.block_keys),
        "scene_instruction": seed.scene_instruction,
        "blocks": [block_map[key] for key in seed.block_keys if key in block_map],
        "versions": {},
        "scene_version_id": None,
    }


def _resolved_scene(session: Session | None, scene_key: str) -> dict[str, Any]:
    seed = BUILTIN_SCENES.get(scene_key)
    if seed is None:
        raise AiPromptValidationError(f"未知的提示词场景：{scene_key}")
    if session is None:
        return _static_scene(seed)
    ensure_prompt_composition_seed(session)
    version = _active_scene_version(session, scene_key)
    block_keys = [str(key) for key in _json_load(version.block_keys_json, [])]
    blocks: list[AiPromptBlock] = []
    versions: dict[str, AiPromptBlockVersion] = {}
    for key in block_keys:
        block, block_version = _active_block_version(session, key)
        blocks.append(block)
        versions[key] = block_version
    return {
        "block_keys": block_keys,
        "scene_instruction": version.scene_instruction,
        "blocks": blocks,
        "versions": versions,
        "scene_version_id": version.id,
    }


def _static_block_template(key: str) -> str:
    for seed in BUILTIN_BLOCKS:
        if seed.key == key:
            return seed.template
    return ""


def compile_prompt(
    scene_key: str,
    variables: dict[str, Any] | None = None,
    *,
    session: Session | None = None,
    selection: dict[str, Any] | None = None,
) -> dict[str, Any]:
    variables = variables or {}
    resolved = _resolved_scene(session, scene_key)
    selected_keys = (
        [str(key) for key in selection.get("block_keys", [])]
        if selection is not None and isinstance(selection.get("block_keys"), list)
        else list(resolved["block_keys"])
    )
    scene_instruction = (
        str(selection.get("scene_instruction") or "").strip()
        if selection is not None and "scene_instruction" in selection
        else str(resolved["scene_instruction"] or "").strip()
    )
    run_instruction = str((selection or {}).get("run_instruction") or "").strip()
    parts: list[tuple[int, int, str, str]] = []
    block_versions: dict[str, str | None] = {}
    for key in selected_keys:
        if session is None:
            seed = next((item for item in BUILTIN_BLOCKS if item.key == key), None)
            if seed is None:
                raise AiPromptValidationError(f"未知的提示词块：{key}")
            parts.append((LAYER_ORDER[seed.layer], seed.sort_order, key, seed.template))
            block_versions[key] = None
            continue
        block, version = _active_block_version(session, key)
        parts.append((LAYER_ORDER.get(block.layer, 999), block.sort_order, key, version.template))
        block_versions[key] = version.id
    parts.sort(key=lambda item: (item[0], item[1], item[2]))
    rendered_parts = [render_prompt_text(item[3], variables) for item in parts if item[3].strip()]
    if scene_instruction:
        rendered_parts.append(render_prompt_text(scene_instruction, variables))
    if run_instruction:
        rendered_parts.append(f"本次运行追加要求：\n{run_instruction}")
    text = "\n\n".join(part for part in rendered_parts if part).strip()
    scene_seed = BUILTIN_SCENES[scene_key]
    missing = [key for key in scene_seed.recommended_block_keys if key not in selected_keys]
    warnings = [f"已取消推荐提示词块：{key}" for key in missing]
    warnings.extend(lint_compiled_prompt(text, variables=variables))
    return {
        "scene_key": scene_key,
        "prompt_key": scene_seed.prompt_key,
        "text": text,
        "block_keys": selected_keys,
        "block_versions": block_versions,
        "scene_instruction": scene_instruction,
        "run_instruction": run_instruction,
        "scene_version_id": resolved["scene_version_id"],
        "warnings": list(dict.fromkeys(warnings)),
        "estimated_tokens": max(1, (len(text) + 1) // 2),
    }


def _affected_scenes(session: Session, block_key: str) -> list[str]:
    affected: list[str] = []
    for row in session.query(AiPromptSceneDefault).all():
        if not row.active_version_id:
            continue
        version = session.get(AiPromptSceneVersion, row.active_version_id)
        if version and block_key in _json_load(version.block_keys_json, []):
            affected.append(row.scene_key)
    return sorted(affected)


def list_prompt_blocks(session: Session) -> list[dict[str, Any]]:
    ensure_prompt_composition_seed(session)
    items: list[dict[str, Any]] = []
    for row in session.query(AiPromptBlock).order_by(AiPromptBlock.layer, AiPromptBlock.sort_order).all():
        version = session.get(AiPromptBlockVersion, row.active_version_id) if row.active_version_id else None
        items.append(
            {
                "key": row.key,
                "label": row.label,
                "description": row.description,
                "layer": row.layer,
                "sort_order": row.sort_order,
                "template": version.template if version else "",
                "active_version_id": row.active_version_id,
                "is_builtin": bool(row.is_builtin),
                "is_active": bool(row.is_active),
                "applicable_scene_keys": _json_load(row.applicable_scenes_json, []),
                "placeholders": _json_load(row.placeholders_json, []),
                "affected_scene_keys": _affected_scenes(session, row.key),
            }
        )
    return items


def save_prompt_block(session: Session, block_key: str, data: dict[str, Any]) -> dict[str, Any]:
    ensure_prompt_composition_seed(session)
    row = session.get(AiPromptBlock, block_key)
    is_new = row is None
    layer = str(data.get("layer") or (row.layer if row else "task"))
    if layer not in LAYER_ORDER:
        raise AiPromptValidationError(f"未知的提示词层级：{layer}")
    template = str(data.get("template") or "").replace("\r\n", "\n").strip()
    if not template:
        raise AiPromptValidationError("提示词块内容不能为空。")
    affected = _affected_scenes(session, block_key) if row else []
    acknowledged = sorted(str(item) for item in data.get("acknowledged_scene_keys", []))
    if affected and acknowledged != affected:
        raise AiPromptValidationError("共享提示词块影响范围未确认。")
    now = utc_now_naive()
    if row is None:
        row = AiPromptBlock(
            key=block_key,
            label=str(data.get("label") or block_key),
            description=str(data.get("description") or ""),
            layer=layer,
            sort_order=int(data.get("sort_order") or 0),
            applicable_scenes_json=json.dumps(data.get("applicable_scene_keys") or [], ensure_ascii=False),
            placeholders_json=json.dumps(sorted(set(PLACEHOLDER_PATTERN.findall(template)))),
            is_builtin=False,
            is_active=bool(data.get("is_active", True)),
        )
        session.add(row)
    else:
        row.label = str(data.get("label") or row.label)
        row.description = str(data.get("description") or row.description)
        row.layer = layer
        row.sort_order = int(data.get("sort_order", row.sort_order))
        row.is_active = bool(data.get("is_active", row.is_active))
        row.placeholders_json = json.dumps(sorted(set(PLACEHOLDER_PATTERN.findall(template))))
    if row.active_version_id:
        active = session.get(AiPromptBlockVersion, row.active_version_id)
        if active:
            active.status = "archived"
    version_id = uuid.uuid4().hex
    session.add(
        AiPromptBlockVersion(
            id=version_id,
            block_key=block_key,
            template=template,
            status="active",
            source="custom" if not is_new or not row.is_builtin else "builtin",
            activated_at=now,
        )
    )
    row.active_version_id = version_id
    session.commit()
    return next(item for item in list_prompt_blocks(session) if item["key"] == block_key)


def list_scene_defaults(session: Session) -> list[dict[str, Any]]:
    ensure_prompt_composition_seed(session)
    blocks = {item["key"]: item for item in list_prompt_blocks(session)}
    items: list[dict[str, Any]] = []
    for seed in BUILTIN_SCENES.values():
        version = _active_scene_version(session, seed.scene_key)
        block_keys = [str(item) for item in _json_load(version.block_keys_json, [])]
        compiled = compile_prompt(seed.scene_key, session=session)
        items.append(
            {
                "scene_key": seed.scene_key,
                "prompt_key": seed.prompt_key,
                "label": PROMPT_DEFINITIONS[seed.prompt_key].label,
                "description": PROMPT_DEFINITIONS[seed.prompt_key].description,
                "block_keys": block_keys,
                "blocks": [blocks[key] for key in block_keys if key in blocks],
                "scene_instruction": version.scene_instruction,
                "active_version_id": version.id,
                "source": version.source,
                "recommended_block_keys": list(seed.recommended_block_keys),
                "compiled_prompt": compiled["text"],
                "warnings": compiled["warnings"],
                "estimated_tokens": compiled["estimated_tokens"],
            }
        )
    return items


def save_scene_default(session: Session, scene_key: str, data: dict[str, Any]) -> dict[str, Any]:
    ensure_prompt_composition_seed(session)
    row = session.get(AiPromptSceneDefault, scene_key)
    if row is None:
        raise AiPromptValidationError(f"未知的提示词场景：{scene_key}")
    block_keys = [str(item) for item in data.get("block_keys", [])]
    for block_key in block_keys:
        _active_block_version(session, block_key)
    scene_instruction = str(data.get("scene_instruction") or "").replace("\r\n", "\n").strip()
    current = session.get(AiPromptSceneVersion, row.active_version_id) if row.active_version_id else None
    if current:
        current.status = "archived"
    version_id = uuid.uuid4().hex
    version = AiPromptSceneVersion(
        id=version_id,
        scene_key=scene_key,
        block_keys_json=json.dumps(block_keys, ensure_ascii=False),
        scene_instruction=scene_instruction,
        status="active",
        source="custom",
        activated_at=utc_now_naive(),
    )
    session.add(version)
    row.active_version_id = version_id
    session.commit()
    return next(item for item in list_scene_defaults(session) if item["scene_key"] == scene_key)


def list_block_versions(session: Session, block_key: str) -> list[dict[str, Any]]:
    ensure_prompt_composition_seed(session)
    if session.get(AiPromptBlock, block_key) is None:
        raise AiPromptValidationError(f"未知的提示词块：{block_key}")
    rows = (
        session.query(AiPromptBlockVersion)
        .filter_by(block_key=block_key)
        .order_by(AiPromptBlockVersion.created_at.desc())
        .all()
    )
    return [
        {
            "id": row.id,
            "block_key": row.block_key,
            "template": row.template,
            "status": row.status,
            "source": row.source,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "activated_at": row.activated_at.isoformat() if row.activated_at else None,
        }
        for row in rows
    ]


def activate_block_version(session: Session, block_key: str, version_id: str) -> dict[str, Any]:
    ensure_prompt_composition_seed(session)
    block = session.get(AiPromptBlock, block_key)
    version = session.get(AiPromptBlockVersion, version_id)
    if block is None or version is None or version.block_key != block_key:
        raise AiPromptValidationError("提示词块版本不存在。")
    if block.active_version_id:
        active = session.get(AiPromptBlockVersion, block.active_version_id)
        if active:
            active.status = "archived"
    version.status = "active"
    version.activated_at = utc_now_naive()
    block.active_version_id = version.id
    session.commit()
    return next(item for item in list_prompt_blocks(session) if item["key"] == block_key)


def list_scene_versions(session: Session, scene_key: str) -> list[dict[str, Any]]:
    ensure_prompt_composition_seed(session)
    if session.get(AiPromptSceneDefault, scene_key) is None:
        raise AiPromptValidationError(f"未知的提示词场景：{scene_key}")
    rows = (
        session.query(AiPromptSceneVersion)
        .filter_by(scene_key=scene_key)
        .order_by(AiPromptSceneVersion.created_at.desc())
        .all()
    )
    return [
        {
            "id": row.id,
            "scene_key": row.scene_key,
            "block_keys": _json_load(row.block_keys_json, []),
            "scene_instruction": row.scene_instruction,
            "status": row.status,
            "source": row.source,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "activated_at": row.activated_at.isoformat() if row.activated_at else None,
        }
        for row in rows
    ]


def activate_scene_version(session: Session, scene_key: str, version_id: str) -> dict[str, Any]:
    ensure_prompt_composition_seed(session)
    row = session.get(AiPromptSceneDefault, scene_key)
    version = session.get(AiPromptSceneVersion, version_id)
    if row is None or version is None or version.scene_key != scene_key:
        raise AiPromptValidationError("场景提示词版本不存在。")
    if row.active_version_id:
        active = session.get(AiPromptSceneVersion, row.active_version_id)
        if active:
            active.status = "archived"
    version.status = "active"
    version.activated_at = utc_now_naive()
    row.active_version_id = version.id
    session.commit()
    return next(item for item in list_scene_defaults(session) if item["scene_key"] == scene_key)


def compile_prompt_for_key(
    prompt_key: str,
    variables: dict[str, Any] | None = None,
    *,
    session: Session | None = None,
    selection: dict[str, Any] | None = None,
) -> dict[str, Any]:
    scene_key = PROMPT_SCENE_BINDINGS.get(prompt_key)
    if scene_key is None:
        return {
            "scene_key": None,
            "prompt_key": prompt_key,
            "text": get_prompt_template(session, prompt_key),
            "block_keys": [],
            "block_versions": {},
            "scene_instruction": "",
            "run_instruction": "",
            "scene_version_id": None,
            "warnings": [],
            "estimated_tokens": max(1, len(get_prompt_template(session, prompt_key)) // 2),
        }
    return compile_prompt(scene_key, variables, session=session, selection=selection)
