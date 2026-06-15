from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any, Literal

from sqlalchemy.orm import Session

from memory_anki.core.config import (
    DASHSCOPE_API_KEY,
    DASHSCOPE_ASR_MODEL,
    DASHSCOPE_BASE_URL,
    DASHSCOPE_TEXT_MODEL,
    DASHSCOPE_VISION_MODEL,
    ENGLISH_TRANSLATION_MODEL,
    SILICONFLOW_API_KEY,
    SILICONFLOW_BASE_URL,
    ZHIPU_API_KEY,
    ZHIPU_BASE_URL,
)
from memory_anki.infrastructure.db.models import AiModelCatalog, Config, ExternalAiCallLog
from memory_anki.infrastructure.llm.openai_compatible import (
    OpenAICompatibleChatConfig,
    OpenAICompatibleError,
    call_chat_completion_text,
)

AiProviderKey = Literal["dashscope", "qwen", "zhipu", "siliconflow"]
AiModelType = Literal["llm", "vl", "translation", "asr", "tts"]

PROVIDER_API_KEY_CONFIG_KEYS: dict[AiProviderKey, str] = {
    "dashscope": "dashscope_api_key",
    "qwen": "dashscope_api_key",
    "zhipu": "zhipu_api_key",
    "siliconflow": "siliconflow_api_key",
}
PROVIDER_BASE_URL_CONFIG_KEYS: dict[AiProviderKey, str] = {
    "dashscope": "dashscope_base_url",
    "qwen": "dashscope_base_url",
    "zhipu": "zhipu_base_url",
    "siliconflow": "siliconflow_base_url",
}
PROVIDER_LABELS: dict[AiProviderKey, str] = {
    "dashscope": "DashScope",
    "qwen": "Qwen",
    "zhipu": "Zhipu",
    "siliconflow": "SiliconFlow",
}
PROVIDER_ENV_DEFAULTS: dict[AiProviderKey, dict[str, str]] = {
    "dashscope": {
        "api_key": str(DASHSCOPE_API_KEY or "").strip(),
        "base_url": str(DASHSCOPE_BASE_URL or "").strip(),
    },
    "qwen": {
        "api_key": str(DASHSCOPE_API_KEY or "").strip(),
        "base_url": str(DASHSCOPE_BASE_URL or "").strip(),
    },
    "zhipu": {
        "api_key": str(ZHIPU_API_KEY or "").strip(),
        "base_url": str(ZHIPU_BASE_URL or "").strip(),
    },
    "siliconflow": {
        "api_key": str(SILICONFLOW_API_KEY or "").strip(),
        "base_url": str(SILICONFLOW_BASE_URL or "").strip(),
    },
}
PROVIDER_HARDCODED_DEFAULTS: dict[AiProviderKey, dict[str, str]] = {
    "dashscope": {
        "api_key": "",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
    "qwen": {
        "api_key": "",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
    "zhipu": {
        "api_key": "",
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
    },
    "siliconflow": {
        "api_key": "",
        "base_url": "https://api.siliconflow.cn/v1",
    },
}
MODEL_TYPE_LABELS: dict[AiModelType, str] = {
    "llm": "大语言",
    "vl": "VL",
    "translation": "翻译",
    "asr": "ASR",
    "tts": "TTS",
}
THINKING_PAYLOADS: dict[AiProviderKey, tuple[str, str]] = {
    "dashscope": ("enable_thinking", "thinking"),
    "qwen": ("enable_thinking", "thinking"),
    "zhipu": ("enabled", "disabled"),
    "siliconflow": ("enabled", "disabled"),
}
PROVIDER_MODEL_ALIASES: dict[AiProviderKey, dict[str, str]] = {
    "dashscope": {},
    "qwen": {},
    "zhipu": {},
    "siliconflow": {
        "Qwen3.5-4B": "Qwen/Qwen3.5-4B",
        "GLM-Z1-9B-0414": "THUDM/GLM-Z1-9B-0414",
        "Hunyuan-MT-7B": "tencent/Hunyuan-MT-7B",
    },
}


class AiModelRegistryError(ValueError):
    def __init__(
        self,
        message: str,
        *,
        details: dict[str, Any] | None = None,
        code: str | None = None,
    ) -> None:
        super().__init__(message)
        self.details = details or {}
        self.code = code or "ai_model_registry_error"


@dataclass(frozen=True, slots=True)
class AiModelSeed:
    key: str
    display_name: str
    provider: AiProviderKey
    model_type: AiModelType
    has_vision: bool
    supports_thinking: bool
    supports_temperature: bool


@dataclass(frozen=True, slots=True)
class AiModelCategoryDefinition:
    key: AiModelType
    label: str
    description: str


@dataclass(frozen=True, slots=True)
class AiSceneDefinition:
    key: str
    label: str
    description: str
    category_key: AiModelType
    config_key: str
    thinking_config_key: str
    default_model: str
    source_location: str
    allow_visual_llm: bool = False
    legacy_config_keys: tuple[str, ...] = ()
    legacy_thinking_config_keys: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class AiCategoryConfig:
    model: str | None
    thinking_enabled: bool
    has_shared_config: bool


@dataclass(frozen=True, slots=True)
class AiRuntimeOptions:
    model: str | None = None
    thinking_enabled: bool | None = None


@dataclass(frozen=True, slots=True)
class ResolvedAiModelRuntime:
    scene: AiSceneDefinition
    model_key: str
    model_label: str
    api_model: str
    provider: AiProviderKey
    model_type: AiModelType
    has_vision: bool
    thinking_enabled: bool
    supports_thinking: bool
    supports_temperature: bool
    api_key: str
    base_url: str
    extra_payload: dict[str, Any] | None

    @property
    def model(self) -> str:
        return self.api_model

    @property
    def modality(self) -> AiModelType:
        return self.model_type


MODEL_SEEDS: tuple[AiModelSeed, ...] = (
    AiModelSeed("qwen3-vl-flash", "Qwen3 VL Flash", "qwen", "vl", True, False, True),
    AiModelSeed("qwen3-vl-plus", "Qwen3 VL Plus", "qwen", "vl", True, False, True),
    AiModelSeed("qwen-vl-max", "Qwen VL Max", "qwen", "vl", True, False, True),
    AiModelSeed("qwen-vl-plus", "Qwen VL Plus", "qwen", "vl", True, False, True),
    AiModelSeed("glm-4.6v-flash", "GLM 4.6V Flash", "zhipu", "vl", True, True, True),
    AiModelSeed("qwen3.6-flash", "Qwen3.6 Flash", "qwen", "llm", False, False, True),
    AiModelSeed("qwen-plus", "Qwen Plus", "qwen", "llm", False, False, True),
    AiModelSeed("qwen-max", "Qwen Max", "qwen", "llm", False, False, True),
    AiModelSeed("qwen-turbo", "Qwen Turbo", "qwen", "llm", False, False, True),
    AiModelSeed("qwen3-235b-a22b", "Qwen3 235B A22B", "qwen", "llm", False, False, True),
    AiModelSeed("glm-4.7-flash", "GLM 4.7 Flash", "zhipu", "llm", False, True, True),
    AiModelSeed("qwen-mt-flash", "Qwen MT Flash", "qwen", "translation", False, False, True),
    AiModelSeed("qwen-mt-plus", "Qwen MT Plus", "qwen", "translation", False, False, True),
    AiModelSeed("qwen-mt-turbo", "Qwen MT Turbo", "qwen", "translation", False, False, True),
    AiModelSeed("cosyvoice-v3-flash", "CosyVoice V3 Flash", "dashscope", "tts", False, False, False),
    AiModelSeed("cosyvoice-v3", "CosyVoice V3", "dashscope", "tts", False, False, False),
    AiModelSeed("cosyvoice-v2", "CosyVoice V2", "dashscope", "tts", False, False, False),
    AiModelSeed("qwen3-asr-flash-filetrans", "Qwen3 ASR Flash Filetrans", "qwen", "asr", False, False, False),
    AiModelSeed("paraformer-v2", "Paraformer V2", "dashscope", "asr", False, False, False),
    AiModelSeed("fun-asr", "Fun ASR", "dashscope", "asr", False, False, False),
    AiModelSeed("Qwen3.5-4B", "Qwen3.5-4B", "qwen", "llm", False, False, True),
    AiModelSeed("qwen3.5-flash", "qwen3.5-flash", "qwen", "llm", False, False, True),
    AiModelSeed("GLM-Z1-9B-0414", "GLM-Z1-9B-0414", "siliconflow", "llm", False, False, True),
    AiModelSeed("Hunyuan-MT-7B", "Hunyuan-MT-7B", "siliconflow", "translation", False, False, True),
)

CATEGORIES: tuple[AiModelCategoryDefinition, ...] = (
    AiModelCategoryDefinition("llm", "大语言", "负责纯文本推理、改写、点评、归类等场景。"),
    AiModelCategoryDefinition("vl", "VL", "负责读图、读 PDF 页面、读 OCR 结果并产出结构化内容。"),
    AiModelCategoryDefinition("translation", "翻译", "负责中英翻译、句子批量翻译等场景。"),
    AiModelCategoryDefinition("asr", "ASR", "负责音视频转写、字幕识别。"),
    AiModelCategoryDefinition("tts", "TTS", "负责语音合成与播报。"),
)

SCENES: tuple[AiSceneDefinition, ...] = (
    AiSceneDefinition(
        key="ai_split",
        label="AI 分卡",
        description="脑图编辑页右键 AI 分卡。把当前节点拆成新的并列分类，并把旧子节点整体重挂到新分类下。",
        category_key="llm",
        config_key="scene_model_ai_split",
        thinking_config_key="scene_model_ai_split_thinking_enabled",
        default_model=DASHSCOPE_TEXT_MODEL,
        legacy_config_keys=("mindmap_ai_split_model",),
        legacy_thinking_config_keys=("mindmap_ai_split_thinking_enabled",),
        source_location="apps/api/src/memory_anki/modules/palaces/application/mindmap_ai_split_service.py",
    ),
    AiSceneDefinition(
        key="reading_lexical_resolution",
        label="英语阅读词汇分级",
        description="英语阅读生成时，给本地词典未命中的词或短语做 CEFR 分级补判，影响颜色标注与难度判断。",
        category_key="llm",
        config_key="scene_model_reading_lexical",
        thinking_config_key="scene_model_reading_lexical_thinking_enabled",
        default_model=DASHSCOPE_TEXT_MODEL,
        legacy_config_keys=("ai_model_text",),
        legacy_thinking_config_keys=("ai_model_text_thinking_enabled",),
        source_location="apps/api/src/memory_anki/modules/english_reading/application/service.py",
    ),
    AiSceneDefinition(
        key="reading_sentence_rewrite",
        label="英语阅读句子改写",
        description="英语阅读生成时，把超出当前 i+1 难度的句子局部改写，保留原意但降低阅读门槛。",
        category_key="llm",
        config_key="scene_model_reading_sentence",
        thinking_config_key="scene_model_reading_sentence_thinking_enabled",
        default_model=DASHSCOPE_TEXT_MODEL,
        legacy_config_keys=("ai_model_text",),
        legacy_thinking_config_keys=("ai_model_text_thinking_enabled",),
        source_location="apps/api/src/memory_anki/modules/english_reading/application/service.py",
    ),
    AiSceneDefinition(
        key="english_reading",
        label="英语阅读（句子改编+词形分类）",
        description="英语阅读材料生成与句子改编使用的文本模型。与 reading_lexical_resolution/reading_sentence_rewrite 等价的历史别名。",
        category_key="llm",
        config_key="ai_model_text",
        thinking_config_key="ai_model_text_thinking_enabled",
        default_model=DASHSCOPE_TEXT_MODEL,
        source_location="apps/api/src/memory_anki/modules/english_reading/application/service.py",
    ),
    AiSceneDefinition(
        key="translation",
        label="翻译（句子/课程）",
        description="英语句子与课程翻译使用的翻译模型。与 translation_reading_sentence 等价的历史别名。",
        category_key="translation",
        config_key="ai_model_translation",
        thinking_config_key="ai_model_translation_thinking_enabled",
        default_model=ENGLISH_TRANSLATION_MODEL,
        source_location="apps/api/src/memory_anki/modules/english_reading/application/service.py",
    ),
    AiSceneDefinition(
        key="quiz_short_answer_feedback",
        label="宫殿简答点评",
        description="做题页简答题的 AI 点评。根据你的答案、参考答案和解析给出反馈。",
        category_key="llm",
        config_key="scene_model_quiz_short_answer",
        thinking_config_key="scene_model_quiz_short_answer_thinking_enabled",
        default_model=DASHSCOPE_TEXT_MODEL,
        legacy_config_keys=("ai_model_quiz_text",),
        legacy_thinking_config_keys=("ai_model_quiz_text_thinking_enabled",),
        source_location="apps/api/src/memory_anki/modules/palace_quiz/application/ai_service.py",
    ),
    AiSceneDefinition(
        key="quiz_review_mindmap_generation",
        label="复习脑图出题",
        description="基于当前复习脑图与关联宫殿上下文生成一组综合题，并自动写入题库。",
        category_key="llm",
        config_key="scene_model_quiz_review_mindmap_generation",
        thinking_config_key="scene_model_quiz_review_mindmap_generation_thinking_enabled",
        default_model=DASHSCOPE_TEXT_MODEL,
        legacy_config_keys=("ai_model_quiz_text",),
        legacy_thinking_config_keys=("ai_model_quiz_text_thinking_enabled",),
        source_location="apps/api/src/memory_anki/modules/palace_quiz/application/quiz_generation_service.py",
    ),
    AiSceneDefinition(
        key="quiz_mini_palace_grouping",
        label="小宫殿归类",
        description="把题目按小宫殿分组，或把已存在的大宫殿题目批量归类到各个小宫殿。",
        category_key="llm",
        config_key="scene_model_quiz_mini_palace",
        thinking_config_key="scene_model_quiz_mini_palace_thinking_enabled",
        default_model="qwen-turbo",
        legacy_config_keys=("ai_model_quiz_mini_palace",),
        legacy_thinking_config_keys=("ai_model_quiz_mini_palace_thinking_enabled",),
        source_location="apps/api/src/memory_anki/modules/palace_quiz/application/ai_service.py",
    ),
    AiSceneDefinition(
        key="quiz_pdf_pairing",
        label="PDF 出题题答配对",
        description="当题目册和答案册一起导入做题时，把视觉初稿里的题目候选和答案候选配对成最终题库。",
        category_key="llm",
        config_key="scene_model_quiz_pdf_pairing",
        thinking_config_key="scene_model_quiz_pdf_pairing_thinking_enabled",
        default_model="qwen-plus",
        legacy_config_keys=("ai_model_quiz_mini_palace",),
        legacy_thinking_config_keys=("ai_model_quiz_mini_palace_thinking_enabled",),
        source_location="apps/api/src/memory_anki/modules/palace_quiz/application/ai_service.py",
    ),
    AiSceneDefinition(
        key="quiz_pdf_review",
        label="PDF 出题范围复核",
        description="对视觉已生成的题库做二次范围筛查，例如只保留英国教育相关题，避免范围外题目混入。",
        category_key="llm",
        config_key="scene_model_quiz_pdf_review",
        thinking_config_key="scene_model_quiz_pdf_review_thinking_enabled",
        default_model="qwen-turbo",
        legacy_config_keys=("ai_model_quiz_mini_palace",),
        legacy_thinking_config_keys=("ai_model_quiz_mini_palace_thinking_enabled",),
        source_location="apps/api/src/memory_anki/modules/palace_quiz/application/ai_service.py",
    ),
    AiSceneDefinition(
        key="vision_image_mindmap",
        label="单图转脑图",
        description="上传单张图片后，直接识别结构并生成脑图草稿。",
        category_key="vl",
        config_key="scene_model_vision_image_mindmap",
        thinking_config_key="scene_model_vision_image_mindmap_thinking_enabled",
        default_model=DASHSCOPE_VISION_MODEL,
        allow_visual_llm=True,
        legacy_config_keys=("ai_model_vision",),
        legacy_thinking_config_keys=("ai_model_vision_thinking_enabled",),
        source_location="apps/api/src/memory_anki/modules/palaces/application/mindmap_import_service.py",
    ),
    AiSceneDefinition(
        key="vision_image_text",
        label="单图转文字",
        description="上传单张图片后，仅抽取文字，不生成脑图结构。",
        category_key="vl",
        config_key="scene_model_vision_image_text",
        thinking_config_key="scene_model_vision_image_text_thinking_enabled",
        default_model=DASHSCOPE_VISION_MODEL,
        allow_visual_llm=True,
        legacy_config_keys=("ai_model_vision",),
        legacy_thinking_config_keys=("ai_model_vision_thinking_enabled",),
        source_location="apps/api/src/memory_anki/modules/palaces/application/mindmap_import_service.py",
    ),
    AiSceneDefinition(
        key="vision_batch_mindmap",
        label="多图转脑图",
        description="批量图片导入脑图时的整体视觉识别链路，负责结构图与正文图的综合生成。",
        category_key="vl",
        config_key="scene_model_vision_batch_mindmap",
        thinking_config_key="scene_model_vision_batch_mindmap_thinking_enabled",
        default_model=DASHSCOPE_VISION_MODEL,
        allow_visual_llm=True,
        legacy_config_keys=("ai_model_vision",),
        legacy_thinking_config_keys=("ai_model_vision_thinking_enabled",),
        source_location="apps/api/src/memory_anki/modules/palaces/application/mindmap_import_job_service.py",
    ),
    AiSceneDefinition(
        key="vision_pdf_mindmap",
        label="PDF 转脑图",
        description="学科 PDF 转脑图的整体视觉识别链路，负责页面读图、结构抽取与草稿生成。",
        category_key="vl",
        config_key="scene_model_vision_pdf_mindmap",
        thinking_config_key="scene_model_vision_pdf_mindmap_thinking_enabled",
        default_model=DASHSCOPE_VISION_MODEL,
        allow_visual_llm=True,
        legacy_config_keys=("ai_model_vision",),
        legacy_thinking_config_keys=("ai_model_vision_thinking_enabled",),
        source_location="apps/api/src/memory_anki/modules/palaces/application/mindmap_import_job_service.py",
    ),
    AiSceneDefinition(
        key="vision_pdf_text",
        label="PDF 转文字",
        description="学科 PDF 转文字，只抽取文字与段落，不生成脑图结构。",
        category_key="vl",
        config_key="scene_model_vision_pdf_text",
        thinking_config_key="scene_model_vision_pdf_text_thinking_enabled",
        default_model=DASHSCOPE_VISION_MODEL,
        allow_visual_llm=True,
        legacy_config_keys=("ai_model_vision",),
        legacy_thinking_config_keys=("ai_model_vision_thinking_enabled",),
        source_location="apps/api/src/memory_anki/modules/palaces/application/mindmap_import_job_service.py",
    ),
    AiSceneDefinition(
        key="quiz_image_generation",
        label="图片出题",
        description="从上传图片识别题目并生成题库草稿。",
        category_key="vl",
        config_key="scene_model_quiz_image_generation",
        thinking_config_key="scene_model_quiz_image_generation_thinking_enabled",
        default_model=DASHSCOPE_VISION_MODEL,
        allow_visual_llm=True,
        legacy_config_keys=("ai_model_vision",),
        legacy_thinking_config_keys=("ai_model_vision_thinking_enabled",),
        source_location="apps/api/src/memory_anki/modules/palace_quiz/application/ai_service.py",
    ),
    AiSceneDefinition(
        key="quiz_pdf_generation",
        label="PDF 出题",
        description="从 PDF 页面识别题目并生成题库草稿。",
        category_key="vl",
        config_key="scene_model_quiz_pdf_generation",
        thinking_config_key="scene_model_quiz_pdf_generation_thinking_enabled",
        default_model=DASHSCOPE_VISION_MODEL,
        allow_visual_llm=True,
        legacy_config_keys=("ai_model_vision",),
        legacy_thinking_config_keys=("ai_model_vision_thinking_enabled",),
        source_location="apps/api/src/memory_anki/modules/palace_quiz/application/ai_service.py",
    ),
    AiSceneDefinition(
        key="translation_course_batch",
        label="英语课程批量翻译",
        description="英语课程生成时，把 ASR 产出的整批句子翻译成中文。",
        category_key="translation",
        config_key="scene_model_translation_course",
        thinking_config_key="scene_model_translation_course_thinking_enabled",
        default_model=ENGLISH_TRANSLATION_MODEL,
        legacy_config_keys=("ai_model_translation",),
        legacy_thinking_config_keys=("ai_model_translation_thinking_enabled",),
        source_location="apps/api/src/memory_anki/modules/english/infrastructure/dashscope_gateway.py",
    ),
    AiSceneDefinition(
        key="translation_reading_sentence",
        label="英语阅读句子翻译",
        description="英语阅读页长按句子后的即时翻译。",
        category_key="translation",
        config_key="scene_model_translation_reading_sentence",
        thinking_config_key="scene_model_translation_reading_sentence_thinking_enabled",
        default_model=ENGLISH_TRANSLATION_MODEL,
        legacy_config_keys=("ai_model_translation",),
        legacy_thinking_config_keys=("ai_model_translation_thinking_enabled",),
        source_location="apps/api/src/memory_anki/modules/english_reading/application/service.py",
    ),
    AiSceneDefinition(
        key="asr_course_transcription",
        label="英语课程音频转写",
        description="英语课程上传视频或音频后的转写步骤，把媒体内容转成带时间轴的英文句子。",
        category_key="asr",
        config_key="scene_model_asr_course",
        thinking_config_key="scene_model_asr_course_thinking_enabled",
        default_model=DASHSCOPE_ASR_MODEL,
        legacy_config_keys=("ai_model_asr",),
        legacy_thinking_config_keys=("ai_model_asr_thinking_enabled",),
        source_location="apps/api/src/memory_anki/modules/english/infrastructure/dashscope_gateway.py",
    ),
    AiSceneDefinition(
        key="tts_voice_coach",
        label="语音教练合成",
        description="复习和练习过程里自动播报的语音教练提示。",
        category_key="tts",
        config_key="scene_model_tts_voice_coach",
        thinking_config_key="scene_model_tts_voice_coach_thinking_enabled",
        default_model="cosyvoice-v3-flash",
        legacy_config_keys=("flow_voice_model",),
        legacy_thinking_config_keys=("flow_voice_thinking_enabled",),
        source_location="apps/api/src/memory_anki/modules/voice_coach/application.py",
    ),
)

CATEGORY_BY_KEY = {item.key: item for item in CATEGORIES}
SCENE_BY_KEY = {item.key: item for item in SCENES}


def ensure_ai_model_catalog_seed(session: Session) -> None:
    existing_rows = {
        row.key: row
        for row in session.query(AiModelCatalog).all()
    }
    changed = False
    for seed in MODEL_SEEDS:
        row = existing_rows.get(seed.key)
        if row is None:
            session.add(
                AiModelCatalog(
                    key=seed.key,
                    display_name=seed.display_name,
                    provider=seed.provider,
                    model_type=seed.model_type,
                    has_vision=seed.has_vision,
                    supports_thinking=seed.supports_thinking,
                    supports_temperature=seed.supports_temperature,
                    is_builtin=True,
                    is_active=True,
                )
            )
            changed = True
            continue
        next_display_name = row.display_name or seed.display_name
        if (
            row.display_name != next_display_name
            or row.provider != seed.provider
            or row.model_type != seed.model_type
            or bool(row.has_vision) != bool(seed.has_vision)
            or bool(row.supports_thinking) != bool(seed.supports_thinking)
            or bool(row.supports_temperature) != bool(seed.supports_temperature)
            or not row.is_builtin
        ):
            row.display_name = next_display_name
            row.provider = seed.provider
            row.model_type = seed.model_type
            row.has_vision = seed.has_vision
            row.supports_thinking = seed.supports_thinking
            row.supports_temperature = seed.supports_temperature
            row.is_builtin = True
            changed = True
    if changed:
        session.commit()


def _normalize_model_name(value: str | None) -> str:
    return str(value or "").strip()


def category_model_config_key(category_key: AiModelType) -> str:
    return f"category_model_{category_key}"


def category_thinking_config_key(category_key: AiModelType) -> str:
    return f"category_model_{category_key}_thinking_enabled"


def _normalize_bool(value: Any, default: bool = False) -> bool:
    text = str(value or "").strip().lower()
    if text in {"1", "true", "yes", "on"}:
        return True
    if text in {"0", "false", "no", "off"}:
        return False
    return bool(default)


def _mask_secret(value: str) -> str:
    secret = str(value or "").strip()
    if not secret:
        return ""
    if len(secret) <= 8:
        return "*" * len(secret)
    return f"{secret[:4]}{'*' * max(4, len(secret) - 8)}{secret[-4:]}"


def _serialize_model_row(row: AiModelCatalog) -> dict[str, Any]:
    label = row.display_name
    if row.model_type == "llm":
        label = f"{label}（{'有视觉' if row.has_vision else '无视觉'}）"
    return {
        "key": row.key,
        "label": label,
        "display_name": row.display_name,
        "provider": row.provider,
        "provider_label": PROVIDER_LABELS.get(row.provider, row.provider),
        "model_type": row.model_type,
        "model_type_label": MODEL_TYPE_LABELS.get(row.model_type, row.model_type),
        "has_vision": bool(row.has_vision),
        "supports_thinking": bool(row.supports_thinking),
        "supports_temperature": bool(row.supports_temperature),
        "is_builtin": bool(row.is_builtin),
        "is_active": bool(row.is_active),
        "default_base_url": PROVIDER_ENV_DEFAULTS.get(
            str(row.provider or "dashscope"), PROVIDER_ENV_DEFAULTS["dashscope"]
        )["base_url"],
    }


def _build_fallback_model_metadata(
    model_key: str,
    *,
    model_type: AiModelType,
    provider: AiProviderKey = "dashscope",
    has_vision: bool = False,
) -> dict[str, Any]:
    row = AiModelCatalog(
        key=model_key,
        display_name=model_key,
        provider=provider,
        model_type=model_type,
        has_vision=has_vision,
        supports_thinking=False,
        supports_temperature=model_type not in {"asr", "tts"},
        is_builtin=False,
        is_active=True,
    )
    return _serialize_model_row(row)


def _infer_provider_for_unknown_model(model_key: str) -> AiProviderKey:
    normalized = str(model_key or "").strip()
    lowered = normalized.lower()
    if lowered.startswith("qwen"):
        return "qwen"
    if normalized in {"GLM-Z1-9B-0414", "Hunyuan-MT-7B"}:
        return "siliconflow"
    if normalized.lower().startswith("glm-"):
        return "zhipu"
    return "dashscope"


def is_dashscope_compatible_provider(provider: AiProviderKey | str) -> bool:
    return str(provider or "").strip().lower() in {"dashscope", "qwen"}


def _first_config_value(session: Session | None, keys: tuple[str, ...]) -> str:
    if session is None:
        return ""
    for key in keys:
        row = session.query(Config).filter_by(key=key).first()
        if row and str(row.value or "").strip():
            return str(row.value or "").strip()
    return ""


def _has_config_value(session: Session | None, keys: tuple[str, ...]) -> bool:
    return bool(_first_config_value(session, keys))


def resolve_current_model(
    session: Session | None,
    config_key: str,
    env_default: str,
    *,
    fallback_config_keys: tuple[str, ...] = (),
) -> str:
    configured = _first_config_value(session, (config_key, *fallback_config_keys))
    return configured or _normalize_model_name(env_default)


def resolve_current_thinking_enabled(
    session: Session | None,
    thinking_config_key: str,
    *,
    default: bool = False,
    fallback_config_keys: tuple[str, ...] = (),
) -> bool:
    if session is not None:
        for key in (thinking_config_key, *fallback_config_keys):
            row = session.query(Config).filter_by(key=key).first()
            if row is not None:
                return _normalize_bool(row.value, default=default)
    return bool(default)


def resolve_category_config(
    session: Session | None,
    category_key: AiModelType,
) -> AiCategoryConfig:
    model_key = category_model_config_key(category_key)
    configured_model = _first_config_value(session, (model_key,))
    has_shared_config = _has_config_value(session, (model_key,))
    thinking_enabled = False
    if has_shared_config and session is not None:
        row = session.query(Config).filter_by(key=category_thinking_config_key(category_key)).first()
        if row is not None:
            thinking_enabled = _normalize_bool(row.value, default=False)
    return AiCategoryConfig(
        model=configured_model or None,
        thinking_enabled=thinking_enabled,
        has_shared_config=has_shared_config,
    )


def resolve_provider_setting(
    session: Session | None,
    provider: AiProviderKey,
    *,
    kind: Literal["api_key", "base_url"],
) -> str:
    config_key = (
        PROVIDER_API_KEY_CONFIG_KEYS[provider]
        if kind == "api_key"
        else PROVIDER_BASE_URL_CONFIG_KEYS[provider]
    )
    env_default = PROVIDER_ENV_DEFAULTS[provider][kind]
    if session is not None:
        row = session.query(Config).filter_by(key=config_key).first()
        if row is not None and str(row.value or "").strip():
            return str(row.value or "").strip()
    return str(env_default or "").strip()


def resolve_provider_setting_source(
    session: Session | None,
    provider: AiProviderKey,
    *,
    kind: Literal["api_key", "base_url"],
) -> Literal["db", "env", "default"]:
    config_key = (
        PROVIDER_API_KEY_CONFIG_KEYS[provider]
        if kind == "api_key"
        else PROVIDER_BASE_URL_CONFIG_KEYS[provider]
    )
    if session is not None:
        row = session.query(Config).filter_by(key=config_key).first()
        if row is not None and str(row.value or "").strip():
            return "db"
    env_default = str(PROVIDER_ENV_DEFAULTS[provider][kind] or "").strip()
    hardcoded_default = str(PROVIDER_HARDCODED_DEFAULTS[provider][kind] or "").strip()
    if env_default and env_default != hardcoded_default:
        return "env"
    if kind == "api_key" and env_default:
        return "env"
    return "default"


def normalize_ai_runtime_options(value: Any) -> AiRuntimeOptions:
    if not isinstance(value, dict):
        return AiRuntimeOptions()
    model = _normalize_model_name(value.get("model"))
    raw_thinking = value.get("thinking_enabled")
    thinking_enabled = None if raw_thinking is None else _normalize_bool(raw_thinking)
    return AiRuntimeOptions(
        model=model or None,
        thinking_enabled=thinking_enabled,
    )


def _get_catalog_row_by_key(session: Session | None, model_key: str) -> AiModelCatalog | None:
    if session is None or not model_key:
        return None
    return session.query(AiModelCatalog).filter_by(key=model_key).first()


def _build_thinking_payload(
    *,
    provider: AiProviderKey,
    supports_thinking: bool,
    thinking_enabled: bool,
) -> dict[str, Any] | None:
    if not supports_thinking:
        return None
    enabled_value, disabled_value = THINKING_PAYLOADS[provider]
    return {
        "thinking": {
            "type": enabled_value if thinking_enabled else disabled_value,
        }
    }


def _resolve_provider_model_id(provider: AiProviderKey, model_key: str) -> str:
    normalized_key = str(model_key or "").strip()
    if not normalized_key:
        return normalized_key
    return PROVIDER_MODEL_ALIASES.get(provider, {}).get(normalized_key, normalized_key)


def resolve_scenario_runtime(
    session: Session | None,
    scenario_key: str,
    *,
    ai_options: AiRuntimeOptions | None = None,
) -> ResolvedAiModelRuntime:
    scene = SCENE_BY_KEY.get(str(scenario_key or ""))
    if scene is None:
        raise KeyError(f"unknown ai scenario: {scenario_key}")
    runtime_options = ai_options or AiRuntimeOptions()
    scene_has_explicit_model = _has_config_value(session, (scene.config_key, *scene.legacy_config_keys))
    scene_configured_model = _first_config_value(session, (scene.config_key, *scene.legacy_config_keys))
    category_config = resolve_category_config(session, scene.category_key)
    configured_model = (
        scene_configured_model
        if scene_has_explicit_model
        else category_config.model or _normalize_model_name(scene.default_model)
    )
    resolved_model_key = runtime_options.model or configured_model
    row = _get_catalog_row_by_key(session, resolved_model_key)
    if row is None:
        provider = _infer_provider_for_unknown_model(resolved_model_key)
        model_meta = _build_fallback_model_metadata(
            resolved_model_key,
            model_type=scene.category_key,
            provider=provider,
            has_vision=(scene.category_key == "vl"),
        )
    else:
        model_meta = _serialize_model_row(row)
    scene_has_explicit_thinking = bool(session is not None) and any(
        session.query(Config).filter_by(key=key).first() is not None
        for key in (scene.thinking_config_key, *scene.legacy_thinking_config_keys)
    )
    scene_default_thinking_enabled = resolve_current_thinking_enabled(
        session,
        scene.thinking_config_key,
        default=False,
        fallback_config_keys=scene.legacy_thinking_config_keys,
    )
    default_thinking_enabled = (
        scene_default_thinking_enabled
        if scene_has_explicit_thinking
        else category_config.thinking_enabled
        if category_config.has_shared_config and category_config.model
        else scene_default_thinking_enabled
    )
    requested_thinking_enabled = (
        runtime_options.thinking_enabled
        if runtime_options.thinking_enabled is not None
        else default_thinking_enabled
    )
    provider = str(model_meta["provider"])
    supports_thinking = bool(model_meta["supports_thinking"])
    effective_thinking_enabled = bool(requested_thinking_enabled and supports_thinking)
    return ResolvedAiModelRuntime(
        scene=scene,
        model_key=str(model_meta["key"]),
        model_label=str(model_meta["label"]),
        api_model=_resolve_provider_model_id(provider, str(model_meta["key"])),  # type: ignore[arg-type]
        provider=provider,  # type: ignore[arg-type]
        model_type=str(model_meta["model_type"]),  # type: ignore[arg-type]
        has_vision=bool(model_meta["has_vision"]),
        thinking_enabled=effective_thinking_enabled,
        supports_thinking=supports_thinking,
        supports_temperature=bool(model_meta["supports_temperature"]),
        api_key=resolve_provider_setting(session, provider, kind="api_key"),  # type: ignore[arg-type]
        base_url=resolve_provider_setting(session, provider, kind="base_url")  # type: ignore[arg-type]
        or str(model_meta["default_base_url"] or ""),
        extra_payload=_build_thinking_payload(
            provider=provider,  # type: ignore[arg-type]
            supports_thinking=supports_thinking,
            thinking_enabled=effective_thinking_enabled,
        ),
    )


def serialize_resolved_ai_runtime(runtime: ResolvedAiModelRuntime) -> dict[str, Any]:
    return {
        "scene_key": runtime.scene.key,
        "scene_label": runtime.scene.label,
        "model_key": runtime.model_key,
        "model_label": runtime.model_label,
        "api_model": runtime.api_model,
        "provider": runtime.provider,
        "provider_label": PROVIDER_LABELS.get(runtime.provider, runtime.provider),
        "model_type": runtime.model_type,
        "model_type_label": MODEL_TYPE_LABELS.get(runtime.model_type, runtime.model_type),
        "has_vision": runtime.has_vision,
        "thinking_enabled": runtime.thinking_enabled,
    }


def _load_ai_log_insights(session: Session, *, limit: int = 800) -> dict[str, Any]:
    rows = (
        session.query(ExternalAiCallLog)
        .order_by(ExternalAiCallLog.created_at.desc(), ExternalAiCallLog.id.desc())
        .limit(max(1, min(limit, 5000)))
        .all()
    )
    latest_scene_success_runtime: dict[str, dict[str, Any]] = {}
    latest_scene_activity: dict[str, dict[str, Any]] = {}
    latest_provider_activity: dict[str, dict[str, Any]] = {}
    latest_model_activity: dict[str, dict[str, Any]] = {}
    recent_success_count = 0

    for row in rows:
        if row.status == "success":
            recent_success_count += 1
        created_at = row.created_at.isoformat() if row.created_at else None
        provider_entry = latest_provider_activity.setdefault(
            row.provider,
            {
                "last_called_at": created_at,
                "last_status": row.status,
                "last_model": row.model,
                "last_success_at": None,
                "last_error_at": None,
            },
        )
        if row.status == "success" and provider_entry["last_success_at"] is None:
            provider_entry["last_success_at"] = created_at
        if row.status == "error" and provider_entry["last_error_at"] is None:
            provider_entry["last_error_at"] = created_at

        model_entry = latest_model_activity.setdefault(
            row.model,
            {
                "last_used_at": created_at,
                "last_status": row.status,
            },
        )
        if model_entry["last_used_at"] is None:
            model_entry["last_used_at"] = created_at
            model_entry["last_status"] = row.status

        try:
            request_payload = json.loads(row.request_json or "{}")
        except json.JSONDecodeError:
            continue
        resolved_ai = request_payload.get("resolved_ai")
        if not isinstance(resolved_ai, dict):
            continue
        scene_key = str(resolved_ai.get("scene_key") or "").strip()
        if not scene_key:
            continue
        latest_scene_activity.setdefault(
            scene_key,
            {
                "last_called_at": created_at,
                "last_status": row.status,
                "resolved_provider": resolved_ai.get("provider"),
                "resolved_model_label": resolved_ai.get("model_label"),
                "latest_resolved_model": resolved_ai,
            },
        )
        if row.status == "success" and scene_key not in latest_scene_success_runtime:
            latest_scene_success_runtime[scene_key] = resolved_ai

    return {
        "recent_success_count": recent_success_count,
        "providers": latest_provider_activity,
        "models": latest_model_activity,
        "scenes": latest_scene_activity,
        "latest_scene_success_runtime": latest_scene_success_runtime,
    }


def list_provider_settings(
    session: Session,
    *,
    active_models: list[AiModelCatalog] | None = None,
    ai_log_insights: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    model_rows = active_models or []
    provider_model_counts: dict[str, int] = {}
    for row in model_rows:
        provider_model_counts[str(row.provider)] = provider_model_counts.get(str(row.provider), 0) + 1
    provider_insights = dict((ai_log_insights or {}).get("providers") or {})
    providers: list[dict[str, Any]] = []
    for provider in ("dashscope", "zhipu", "siliconflow"):
        normalized_provider = provider  # type: ignore[assignment]
        api_key = resolve_provider_setting(session, normalized_provider, kind="api_key")
        base_url = resolve_provider_setting(session, normalized_provider, kind="base_url")
        provider_activity = provider_insights.get(normalized_provider, {})
        providers.append(
            {
                "key": normalized_provider,
                "label": PROVIDER_LABELS[normalized_provider],
                "api_key_masked": _mask_secret(api_key),
                "has_api_key": bool(api_key),
                "base_url": base_url,
                "api_key_config_key": PROVIDER_API_KEY_CONFIG_KEYS[normalized_provider],
                "base_url_config_key": PROVIDER_BASE_URL_CONFIG_KEYS[normalized_provider],
                "api_key_source": resolve_provider_setting_source(session, normalized_provider, kind="api_key"),
                "base_url_source": resolve_provider_setting_source(session, normalized_provider, kind="base_url"),
                "model_count": provider_model_counts.get(normalized_provider, 0),
                "last_called_at": provider_activity.get("last_called_at"),
                "last_status": provider_activity.get("last_status"),
                "last_success_at": provider_activity.get("last_success_at"),
                "last_error_at": provider_activity.get("last_error_at"),
                "last_model": provider_activity.get("last_model"),
            }
        )
    return providers


def _query_scene_candidate_rows(session: Session, scene: AiSceneDefinition) -> list[AiModelCatalog]:
    query = session.query(AiModelCatalog).filter(AiModelCatalog.is_active.is_(True))
    if scene.category_key == "vl" and scene.allow_visual_llm:
        query = query.filter(
            (AiModelCatalog.model_type == "vl")
            | ((AiModelCatalog.model_type == "llm") & (AiModelCatalog.has_vision.is_(True)))
        )
    else:
        query = query.filter(AiModelCatalog.model_type == scene.category_key)
    return query.order_by(AiModelCatalog.is_builtin.desc(), AiModelCatalog.display_name.asc()).all()


def _query_category_candidate_rows(session: Session, category_key: AiModelType) -> list[AiModelCatalog]:
    query = session.query(AiModelCatalog).filter(AiModelCatalog.is_active.is_(True))
    if category_key == "vl":
        query = query.filter(
            (AiModelCatalog.model_type == "vl")
            | ((AiModelCatalog.model_type == "llm") & (AiModelCatalog.has_vision.is_(True)))
        )
    else:
        query = query.filter(AiModelCatalog.model_type == category_key)
    return query.order_by(AiModelCatalog.is_builtin.desc(), AiModelCatalog.display_name.asc()).all()


def list_model_scenarios(session: Session) -> dict[str, Any]:
    ensure_ai_model_catalog_seed(session)
    active_models = (
        session.query(AiModelCatalog)
        .filter(AiModelCatalog.is_active.is_(True))
        .order_by(AiModelCatalog.model_type.asc(), AiModelCatalog.display_name.asc())
        .all()
    )
    ai_log_insights = _load_ai_log_insights(session)
    latest_scene_runtime = dict(ai_log_insights.get("latest_scene_success_runtime") or {})
    latest_scene_activity = dict(ai_log_insights.get("scenes") or {})
    scenes: list[dict[str, Any]] = []
    category_configs = {
        category.key: resolve_category_config(session, category.key)
        for category in CATEGORIES
    }
    for scene in SCENES:
        scene_model = resolve_current_model(
            session,
            scene.config_key,
            scene.default_model,
            fallback_config_keys=scene.legacy_config_keys,
        )
        scene_thinking_enabled = resolve_current_thinking_enabled(
            session,
            scene.thinking_config_key,
            default=False,
            fallback_config_keys=scene.legacy_thinking_config_keys,
        )
        category_config = category_configs[scene.category_key]
        inherits_category_default = bool(
            category_config.has_shared_config
            and category_config.model
            and scene_model == category_config.model
            and scene_thinking_enabled == category_config.thinking_enabled
        )
        effective_model = category_config.model if inherits_category_default else scene_model
        effective_thinking_enabled = (
            category_config.thinking_enabled if inherits_category_default else scene_thinking_enabled
        )
        scene_activity = latest_scene_activity.get(scene.key, {})
        available_models = [_serialize_model_row(row) for row in _query_scene_candidate_rows(session, scene)]
        if scene_model and not any(item["key"] == scene_model for item in available_models):
            available_models.append(
                _build_fallback_model_metadata(
                    scene_model,
                    model_type=scene.category_key,
                    provider=_infer_provider_for_unknown_model(scene_model),
                    has_vision=(scene.category_key == "vl"),
                )
            )
        scenes.append(
            {
                "key": scene.key,
                "label": scene.label,
                "description": scene.description,
                "category_key": scene.category_key,
                "category_label": CATEGORY_BY_KEY[scene.category_key].label,
                "config_key": scene.config_key,
                "thinking_config_key": scene.thinking_config_key,
                "default_model": scene_model,
                "current_model": scene_model,
                "default_thinking_enabled": scene_thinking_enabled,
                "current_thinking_enabled": scene_thinking_enabled,
                "effective_model": effective_model,
                "effective_thinking_enabled": effective_thinking_enabled,
                "inherits_category_default": inherits_category_default,
                "available_models": available_models,
                "source_location": scene.source_location,
                "latest_resolved_model": latest_scene_runtime.get(scene.key),
                "last_called_at": scene_activity.get("last_called_at"),
                "last_status": scene_activity.get("last_status"),
                "resolved_provider": scene_activity.get("resolved_provider"),
                "resolved_model_label": scene_activity.get("resolved_model_label"),
            }
        )
    scene_usage_by_model: dict[str, list[str]] = {}
    for scene in scenes:
        scene_usage_by_model.setdefault(str(scene["effective_model"]), []).append(str(scene["label"]))
    categories = [
        {
            "key": category.key,
            "label": category.label,
            "description": category.description,
            "shared_model": category_configs[category.key].model,
            "shared_thinking_enabled": category_configs[category.key].thinking_enabled,
            "has_shared_config": category_configs[category.key].has_shared_config,
            "available_models": [
                _serialize_model_row(row) for row in _query_category_candidate_rows(session, category.key)
            ],
            "scene_keys": [scene.key for scene in SCENES if scene.category_key == category.key],
            "scene_details": [
                {
                    "key": scene.key,
                    "label": scene.label,
                    "description": scene.description,
                }
                for scene in SCENES
                if scene.category_key == category.key
            ],
            "scene_count": sum(1 for scene in scenes if scene["category_key"] == category.key),
            "custom_scene_count": sum(
                1
                for scene in scenes
                if scene["category_key"] == category.key and not bool(scene["inherits_category_default"])
            ),
        }
        for category in CATEGORIES
    ]
    model_activity = dict(ai_log_insights.get("models") or {})
    serialized_models: list[dict[str, Any]] = []
    for row in active_models:
        serialized = _serialize_model_row(row)
        usage_labels = scene_usage_by_model.get(row.key, [])
        latest_activity = model_activity.get(row.key, {})
        serialized.update(
            {
                "usage_count": len(usage_labels),
                "bound_scene_labels": usage_labels[:5],
                "last_used_at": latest_activity.get("last_used_at"),
                "last_status": latest_activity.get("last_status") or "never_used",
            }
        )
        serialized_models.append(serialized)
    return {
        "providers": list_provider_settings(
            session,
            active_models=active_models,
            ai_log_insights=ai_log_insights,
        ),
        "categories": categories,
        "models": serialized_models,
        "scenes": scenes,
        "scenarios": scenes,
        "summary": {
            "provider_count": 3,
            "active_model_count": len(active_models),
            "scene_count": len(scenes),
            "recent_success_call_count": int(ai_log_insights.get("recent_success_count") or 0),
        },
    }


def save_ai_model_settings(
    session: Session,
    *,
    scene_updates: dict[str, Any] | None = None,
    category_updates: dict[str, Any] | None = None,
    provider_updates: dict[str, Any] | None = None,
) -> dict[str, Any]:
    for category_key, payload in dict(category_updates or {}).items():
        normalized_category = str(category_key or "").strip().lower()
        if normalized_category not in CATEGORY_BY_KEY or not isinstance(payload, dict):
            continue
        typed_category = normalized_category  # type: ignore[assignment]
        model_name = _normalize_model_name(payload.get("default_model"))
        if model_name:
            _upsert_config_value(session, category_model_config_key(typed_category), model_name)
            _upsert_config_value(
                session,
                category_thinking_config_key(typed_category),
                "true" if _normalize_bool(payload.get("default_thinking_enabled")) else "false",
            )
            if _normalize_bool(payload.get("apply_to_scenes"), default=True):
                for scene in SCENES:
                    if scene.category_key != typed_category:
                        continue
                    _upsert_config_value(session, scene.config_key, model_name)
                    _upsert_config_value(
                        session,
                        scene.thinking_config_key,
                        "true" if _normalize_bool(payload.get("default_thinking_enabled")) else "false",
                    )

    for scene_key, payload in dict(scene_updates or {}).items():
        scene = SCENE_BY_KEY.get(str(scene_key or "").strip())
        if scene is None or not isinstance(payload, dict):
            continue
        model_name = _normalize_model_name(payload.get("default_model") or payload.get("current_model"))
        if model_name:
            _upsert_config_value(session, scene.config_key, model_name)
        if "default_thinking_enabled" in payload or "current_thinking_enabled" in payload:
            raw_thinking = (
                payload.get("default_thinking_enabled")
                if "default_thinking_enabled" in payload
                else payload.get("current_thinking_enabled")
            )
            _upsert_config_value(
                session,
                scene.thinking_config_key,
                "true" if _normalize_bool(raw_thinking) else "false",
            )

    for provider_key, payload in dict(provider_updates or {}).items():
        normalized_provider = str(provider_key or "").strip().lower()
        if normalized_provider not in PROVIDER_API_KEY_CONFIG_KEYS or not isinstance(payload, dict):
            continue
        if "api_key" in payload:
            _upsert_config_value(
                session,
                PROVIDER_API_KEY_CONFIG_KEYS[normalized_provider],  # type: ignore[index]
                str(payload.get("api_key") or "").strip(),
            )
        if "base_url" in payload:
            _upsert_config_value(
                session,
                PROVIDER_BASE_URL_CONFIG_KEYS[normalized_provider],  # type: ignore[index]
                str(payload.get("base_url") or "").strip(),
            )
    session.commit()
    return list_model_scenarios(session)


def get_ai_model_impact(session: Session, model_key: str) -> dict[str, Any]:
    ensure_ai_model_catalog_seed(session)
    normalized_key = _normalize_model_name(model_key)
    row = session.query(AiModelCatalog).filter_by(key=normalized_key).first()
    scene_impacts: list[dict[str, Any]] = []
    category_impacts: list[dict[str, Any]] = []
    for category in CATEGORIES:
        category_config = resolve_category_config(session, category.key)
        if category_config.has_shared_config and category_config.model == normalized_key:
            category_impacts.append(
                {
                    "key": category.key,
                    "label": category.label,
                }
            )
    for scene in SCENES:
        scene_model = resolve_current_model(
            session,
            scene.config_key,
            scene.default_model,
            fallback_config_keys=scene.legacy_config_keys,
        )
        if scene_model != normalized_key:
            continue
        scene_impacts.append(
            {
                "key": scene.key,
                "label": scene.label,
                "category_key": scene.category_key,
                "category_label": CATEGORY_BY_KEY[scene.category_key].label,
                "config_key": scene.config_key,
            }
        )
    return {
        "model_key": normalized_key,
        "model_label": row.display_name if row is not None else normalized_key,
        "exists": row is not None,
        "can_delete": len(scene_impacts) == 0 and len(category_impacts) == 0,
        "usage_count": len(scene_impacts),
        "bound_scene_labels": [item["label"] for item in scene_impacts],
        "scene_impacts": scene_impacts,
        "category_impacts": category_impacts,
    }


def _pick_provider_test_model(
    session: Session,
    provider: AiProviderKey,
    *,
    model_key: str | None = None,
) -> dict[str, Any]:
    ensure_ai_model_catalog_seed(session)
    normalized_model_key = _normalize_model_name(model_key)
    if normalized_model_key:
        row = session.query(AiModelCatalog).filter_by(key=normalized_model_key).first()
        if row is None:
            raise AiModelRegistryError("要测试的模型不存在。", code="model_not_found")
        return _serialize_model_row(row)

    ordered_model_types: tuple[AiModelType, ...] = ("llm", "translation", "vl", "asr", "tts")
    for model_type in ordered_model_types:
        row = (
            session.query(AiModelCatalog)
            .filter(
                AiModelCatalog.is_active.is_(True),
                AiModelCatalog.provider == provider,
                AiModelCatalog.model_type == model_type,
            )
            .order_by(AiModelCatalog.is_builtin.desc(), AiModelCatalog.display_name.asc())
            .first()
        )
        if row is not None:
            return _serialize_model_row(row)
    raise AiModelRegistryError("当前 Provider 下没有可用于测试的活跃模型。", code="model_not_found")


def test_provider_connection(
    session: Session,
    provider: AiProviderKey,
    *,
    model_key: str | None = None,
) -> dict[str, Any]:
    candidate = _pick_provider_test_model(session, provider, model_key=model_key)
    api_key = resolve_provider_setting(session, provider, kind="api_key")
    source = resolve_provider_setting_source(session, provider, kind="api_key")
    base_url = resolve_provider_setting(session, provider, kind="base_url") or str(candidate["default_base_url"] or "")
    if not api_key:
        return {
            "ok": False,
            "provider": provider,
            "provider_label": PROVIDER_LABELS.get(provider, provider),
            "model": candidate["key"],
            "latency_ms": 0,
            "error": "未配置对应 Provider 的 API Key。",
            "source": source,
        }
    config = OpenAICompatibleChatConfig(
        api_key=api_key,
        base_url=base_url,
        model=_resolve_provider_model_id(provider, str(candidate["key"])),
        temperature=(0.0 if bool(candidate["supports_temperature"]) else None),
        timeout_seconds=15.0,
    )
    started = time.perf_counter()
    try:
        call_chat_completion_text(
            config=config,
            messages=[{"role": "user", "content": "Reply with OK."}],
            extra_payload={"max_tokens": 8},
        )
        latency_ms = int((time.perf_counter() - started) * 1000)
        return {
            "ok": True,
            "provider": provider,
            "provider_label": PROVIDER_LABELS.get(provider, provider),
            "model": candidate["key"],
            "latency_ms": latency_ms,
            "error": None,
            "source": source,
        }
    except OpenAICompatibleError as exc:
        latency_ms = int((time.perf_counter() - started) * 1000)
        return {
            "ok": False,
            "provider": provider,
            "provider_label": PROVIDER_LABELS.get(provider, provider),
            "model": candidate["key"],
            "latency_ms": latency_ms,
            "error": str(exc),
            "source": source,
        }


def test_model_connection(session: Session, model_key: str) -> dict[str, Any]:
    ensure_ai_model_catalog_seed(session)
    normalized_key = _normalize_model_name(model_key)
    row = session.query(AiModelCatalog).filter_by(key=normalized_key).first()
    if row is None:
        raise AiModelRegistryError("要测试的模型不存在。", code="model_not_found")
    return test_provider_connection(session, row.provider, model_key=normalized_key)


def upsert_ai_model_catalog_item(session: Session, payload: dict[str, Any]) -> dict[str, Any]:
    ensure_ai_model_catalog_seed(session)
    model_key = _normalize_model_name(payload.get("key"))
    if not model_key:
        raise AiModelRegistryError("模型 key 不能为空。")
    provider = str(payload.get("provider") or "").strip().lower()
    if provider not in PROVIDER_LABELS:
        raise AiModelRegistryError("模型 Provider 无效。")
    model_type = str(payload.get("model_type") or "").strip().lower()
    if model_type not in MODEL_TYPE_LABELS:
        raise AiModelRegistryError("模型类型无效。")
    display_name = _normalize_model_name(payload.get("display_name")) or model_key
    row = session.query(AiModelCatalog).filter_by(key=model_key).first()
    if row is None:
        row = AiModelCatalog(key=model_key)
        session.add(row)
    row.display_name = display_name
    row.provider = provider
    row.model_type = model_type
    row.has_vision = bool(payload.get("has_vision"))
    row.supports_thinking = bool(payload.get("supports_thinking"))
    row.supports_temperature = bool(payload.get("supports_temperature", model_type not in {"asr", "tts"}))
    row.is_builtin = bool(row.is_builtin)
    row.is_active = True
    session.commit()
    return list_model_scenarios(session)


def delete_ai_model_catalog_item(session: Session, model_key: str) -> dict[str, Any]:
    ensure_ai_model_catalog_seed(session)
    normalized_key = _normalize_model_name(model_key)
    row = session.query(AiModelCatalog).filter_by(key=normalized_key).first()
    if row is None:
        raise AiModelRegistryError("要删除的模型不存在。", code="model_not_found")
    impact = get_ai_model_impact(session, normalized_key)
    if not bool(impact.get("can_delete")):
        raise AiModelRegistryError(
            "该模型仍被场景或分类配置使用，暂时不能删除。",
            details=impact,
            code="model_in_use",
        )
    row.is_active = False
    session.commit()
    return list_model_scenarios(session)


def _upsert_config_value(session: Session, key: str, value: str) -> None:
    row = session.query(Config).filter_by(key=key).first()
    if row is not None:
        row.value = value
        return
    session.add(Config(key=key, value=value))
