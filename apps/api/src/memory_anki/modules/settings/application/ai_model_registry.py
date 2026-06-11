from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.config import (
    DASHSCOPE_ASR_MODEL,
    DASHSCOPE_TEXT_MODEL,
    DASHSCOPE_VISION_MODEL,
    ENGLISH_TRANSLATION_MODEL,
)
from memory_anki.infrastructure.db.models import Config


@dataclass(frozen=True)
class AiModelScenario:
    key: str
    label: str
    description: str
    category: str
    config_key: str
    default_model: str
    available_models: tuple[str, ...]
    source_location: str


MODEL_SCENARIOS: tuple[AiModelScenario, ...] = (
    AiModelScenario(
        key="vision",
        label="视觉识别（PDF/图片导入）",
        description="将 PDF 页面或图片识别为脑图结构时使用的视觉模型。用于结构识别、正文 OCR、页面合并和直接生成。",
        category="视觉",
        config_key="ai_model_vision",
        default_model=DASHSCOPE_VISION_MODEL,
        available_models=(
            "qwen3-vl-flash",
            "qwen3-vl-plus",
            "qwen-vl-max",
            "qwen-vl-plus",
        ),
        source_location="apps/api/src/memory_anki/modules/palaces/application/mindmap_import_service.py",
    ),
    AiModelScenario(
        key="ai_split",
        label="AI 分卡（脑图节点拆分）",
        description="将脑图节点的已有子节点按语义拆分成新的分类节点。发送系统提示词给文本模型，要求严格 JSON 输出。",
        category="文本",
        config_key="mindmap_ai_split_model",
        default_model=DASHSCOPE_TEXT_MODEL,
        available_models=(
            "qwen3.6-flash",
            "qwen-plus",
            "qwen-max",
            "qwen-turbo",
            "qwen3-235b-a22b",
        ),
        source_location="apps/api/src/memory_anki/modules/palaces/application/mindmap_ai_split/config_loader.py",
    ),
    AiModelScenario(
        key="english_reading",
        label="英语阅读（句子改编+词形分类）",
        description="将英文句子改编为 i+1 阅读材料，以及为未知单词补全 CEFR 分级信息时使用的文本模型。",
        category="文本",
        config_key="ai_model_text",
        default_model=DASHSCOPE_TEXT_MODEL,
        available_models=(
            "qwen3.6-flash",
            "qwen-plus",
            "qwen-max",
            "qwen-turbo",
            "qwen3-235b-a22b",
        ),
        source_location="apps/api/src/memory_anki/modules/english_reading/application/service.py",
    ),
    AiModelScenario(
        key="translation",
        label="英语翻译",
        description="将英语课程音频转录的英文句子批量翻译为中文时使用的翻译模型。",
        category="翻译",
        config_key="ai_model_translation",
        default_model=ENGLISH_TRANSLATION_MODEL,
        available_models=(
            "qwen-mt-flash",
            "qwen-mt-plus",
            "qwen-mt-turbo",
        ),
        source_location="apps/api/src/memory_anki/modules/english/infrastructure/dashscope_gateway.py",
    ),
    AiModelScenario(
        key="tts",
        label="语音教练（TTS 语音合成）",
        description="复习和练习过程中合成语音提示（开始、督促、里程碑、完成）时使用的 TTS 模型。",
        category="语音",
        config_key="flow_voice_model",
        default_model="cosyvoice-v3-flash",
        available_models=(
            "cosyvoice-v3-flash",
            "cosyvoice-v3",
            "cosyvoice-v2",
        ),
        source_location="apps/api/src/memory_anki/modules/voice_coach/application.py",
    ),
    AiModelScenario(
        key="asr",
        label="英语语音识别（ASR）",
        description="将英语课程视频/音频转录为带时间戳的句子时使用的语音识别模型。",
        category="语音",
        config_key="ai_model_asr",
        default_model=DASHSCOPE_ASR_MODEL,
        available_models=(
            "qwen3-asr-flash-filetrans",
            "paraformer-v2",
            "fun-asr",
        ),
        source_location="apps/api/src/memory_anki/modules/english/infrastructure/dashscope_gateway.py",
    ),
)


def resolve_current_model(
    session: Session | None,
    config_key: str,
    env_default: str,
) -> str:
    if session is not None and config_key:
        row = session.query(Config).filter_by(key=config_key).first()
        if row and row.value:
            return row.value.strip()
    return str(env_default or "").strip()


def list_model_scenarios(session: Session) -> list[dict[str, Any]]:
    scenarios: list[dict[str, Any]] = []
    for scenario in MODEL_SCENARIOS:
        current_model = resolve_current_model(
            session,
            scenario.config_key,
            scenario.default_model,
        )
        scenarios.append(
            {
                "key": scenario.key,
                "label": scenario.label,
                "description": scenario.description,
                "category": scenario.category,
                "config_key": scenario.config_key,
                "current_model": current_model,
                "available_models": list(scenario.available_models),
                "source_location": scenario.source_location,
            }
        )
    return scenarios


def save_model_selection(
    session: Session,
    updates: dict[str, str],
) -> list[dict[str, Any]]:
    key_map = {s.key: s for s in MODEL_SCENARIOS}
    for key, model_name in updates.items():
        scenario = key_map.get(key)
        if scenario is None or not scenario.config_key:
            continue
        normalized = str(model_name or "").strip()
        if not normalized:
            continue
        row = session.query(Config).filter_by(key=scenario.config_key).first()
        if row:
            if row.value != normalized:
                row.value = normalized
        else:
            session.add(Config(key=scenario.config_key, value=normalized))
    session.commit()
    return list_model_scenarios(session)
