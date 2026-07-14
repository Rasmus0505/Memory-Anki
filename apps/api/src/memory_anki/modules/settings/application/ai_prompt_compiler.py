from __future__ import annotations

import re
from typing import Any

from .ai_prompts import PLACEHOLDER_PATTERN


def render_prompt_text(template: str, variables: dict[str, Any]) -> str:
    def replace(match: re.Match[str]) -> str:
        name = match.group(1)
        if name not in variables:
            return match.group(0)
        value = variables.get(name)
        return "" if value is None else str(value)

    return PLACEHOLDER_PATTERN.sub(replace, template).strip()


def lint_compiled_prompt(
    text: str,
    *,
    variables: dict[str, Any] | None = None,
) -> list[str]:
    warnings: list[str] = []
    normalized = text.strip()
    if not normalized:
        warnings.append("最终提示词为空。")
    if "第一张图" in normalized and "结构图" in normalized and "显式" not in normalized:
        warnings.append("检测到未声明的“第一张图是结构图”假设。")
    if "不要总结" in normalized and any(
        word in normalized for word in ("概括", "精简", "简洁")
    ):
        warnings.append("检测到“禁止总结”与“概括/精简”可能冲突。")
    unresolved = sorted(set(PLACEHOLDER_PATTERN.findall(normalized)))
    missing = [name for name in unresolved if name not in set((variables or {}).keys())]
    if missing:
        warnings.append(f"存在未提供的占位符：{', '.join(missing)}")
    if len(normalized) > 36000:
        warnings.append("提示词超过约 24000 Token 安全预算。")
    return warnings
