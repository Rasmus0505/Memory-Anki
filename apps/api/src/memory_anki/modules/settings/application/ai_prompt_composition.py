from __future__ import annotations

import json
import uuid
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
from .ai_prompt_composition_catalog import (
    BUILTIN_BLOCKS,
    BUILTIN_SCENES,
    LAYER_ORDER,
    PROMPT_SCENE_BINDINGS,
    SCENE_CATEGORY_ORDER,
    PromptSceneSeed,
    _scene_display_description,
    _scene_display_label,
)
from .ai_prompts import (
    PLACEHOLDER_PATTERN,
    PROMPT_DEFINITIONS,
    AiPromptValidationError,
    get_prompt_template,
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
            # Repair empty builtin defaults so newly added recommended blocks take effect
            # without wiping user customizations.
            active = (
                session.get(AiPromptSceneVersion, scene_row.active_version_id)
                if scene_row.active_version_id
                else None
            )
            active_keys = [str(item) for item in _json_load(active.block_keys_json if active else "[]", [])]
            missing_recommended = [
                key for key in scene_seed.recommended_block_keys if key not in active_keys
            ]
            should_refresh_builtin = active is not None and active.source == "builtin" and (
                (not active_keys and scene_seed.block_keys)
                or bool(missing_recommended and scene_seed.scene_key.startswith("ai_split"))
            )
            if should_refresh_builtin and active is not None:
                active.status = "archived"
                version_id = uuid.uuid4().hex
                session.add(
                    AiPromptSceneVersion(
                        id=version_id,
                        scene_key=scene_seed.scene_key,
                        block_keys_json=json.dumps(list(scene_seed.block_keys), ensure_ascii=False),
                        scene_instruction=scene_seed.scene_instruction,
                        status="active",
                        source="builtin",
                        activated_at=now,
                    )
                )
                scene_row.active_version_id = version_id
                changed = True
            continue
        override = session.query(Config).filter_by(key=scene_seed.prompt_key).first()
        block_keys = list(scene_seed.block_keys)
        scene_instruction = scene_seed.scene_instruction
        source = "builtin"
        # Only migrate legacy full-template overrides onto the primary scene for a prompt_key.
        # Alias scenes (e.g. ai_split_parallel) always use modular defaults.
        primary_scene = PROMPT_SCENE_BINDINGS.get(scene_seed.prompt_key)
        allow_legacy_migration = primary_scene is None or primary_scene == scene_seed.scene_key
        if allow_legacy_migration and override is not None and override.value.strip():
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
    ordered_seeds = sorted(
        BUILTIN_SCENES.values(),
        key=lambda seed: (
            SCENE_CATEGORY_ORDER.index(seed.category)
            if seed.category in SCENE_CATEGORY_ORDER
            else len(SCENE_CATEGORY_ORDER),
            _scene_display_label(seed),
            seed.scene_key,
        ),
    )
    for seed in ordered_seeds:
        version = _active_scene_version(session, seed.scene_key)
        block_keys = [str(item) for item in _json_load(version.block_keys_json, [])]
        compiled = compile_prompt(seed.scene_key, session=session)
        items.append(
            {
                "scene_key": seed.scene_key,
                "prompt_key": seed.prompt_key,
                "label": _scene_display_label(seed),
                "description": _scene_display_description(seed),
                "category": seed.category,
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
