from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from memory_anki.core.config import (
    DASHSCOPE_API_KEY,
    DASHSCOPE_ASR_MODEL,
    DASHSCOPE_BASE_URL,
    DASHSCOPE_OCR_MODEL,
    DASHSCOPE_TEXT_MODEL,
    DEEPSEEK_API_KEY,
    DEEPSEEK_BASE_URL,
    ENGLISH_TRANSLATION_MODEL,
    SILICONFLOW_API_KEY,
    SILICONFLOW_BASE_URL,
    ZHIPU_API_KEY,
    ZHIPU_BASE_URL,
)
from memory_anki.infrastructure.db._tables.misc import AiModelCatalog

from .ai_model_registry_contracts import (
    AiModelCategoryDefinition,
    AiModelSeed,
    AiModelType,
    AiProviderKey,
    AiSceneDefinition,
)


@dataclass(frozen=True, slots=True)
class AiProviderCatalogSpec:
    key: AiProviderKey
    label: str
    api_key_config_key: str
    base_url_config_key: str
    env_api_key: str
    env_base_url: str
    default_base_url: str
    thinking_enabled_value: str
    thinking_disabled_value: str
    model_aliases: dict[str, str] = field(default_factory=dict)


PROVIDER_SPECS: tuple[AiProviderCatalogSpec, ...] = (
    AiProviderCatalogSpec(
        key="dashscope",
        label="DashScope",
        api_key_config_key="dashscope_api_key",
        base_url_config_key="dashscope_base_url",
        env_api_key=str(DASHSCOPE_API_KEY or "").strip(),
        env_base_url=str(DASHSCOPE_BASE_URL or "").strip(),
        default_base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        thinking_enabled_value="enable_thinking",
        thinking_disabled_value="thinking",
    ),
    AiProviderCatalogSpec(
        key="qwen",
        label="Qwen",
        api_key_config_key="dashscope_api_key",
        base_url_config_key="dashscope_base_url",
        env_api_key=str(DASHSCOPE_API_KEY or "").strip(),
        env_base_url=str(DASHSCOPE_BASE_URL or "").strip(),
        default_base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        thinking_enabled_value="enable_thinking",
        thinking_disabled_value="thinking",
    ),
    AiProviderCatalogSpec(
        key="zhipu",
        label="Zhipu",
        api_key_config_key="zhipu_api_key",
        base_url_config_key="zhipu_base_url",
        env_api_key=str(ZHIPU_API_KEY or "").strip(),
        env_base_url=str(ZHIPU_BASE_URL or "").strip(),
        default_base_url="https://open.bigmodel.cn/api/paas/v4",
        thinking_enabled_value="enabled",
        thinking_disabled_value="disabled",
    ),
    AiProviderCatalogSpec(
        key="siliconflow",
        label="SiliconFlow",
        api_key_config_key="siliconflow_api_key",
        base_url_config_key="siliconflow_base_url",
        env_api_key=str(SILICONFLOW_API_KEY or "").strip(),
        env_base_url=str(SILICONFLOW_BASE_URL or "").strip(),
        default_base_url="https://api.siliconflow.cn/v1",
        thinking_enabled_value="enabled",
        thinking_disabled_value="disabled",
        model_aliases={
            "Qwen3.5-4B": "Qwen/Qwen3.5-4B",
            "GLM-Z1-9B-0414": "THUDM/GLM-Z1-9B-0414",
            "Hunyuan-MT-7B": "tencent/Hunyuan-MT-7B",
        },
    ),
    AiProviderCatalogSpec(
        key="deepseek",
        label="DeepSeek",
        api_key_config_key="deepseek_api_key",
        base_url_config_key="deepseek_base_url",
        env_api_key=str(DEEPSEEK_API_KEY or "").strip(),
        env_base_url=str(DEEPSEEK_BASE_URL or "").strip(),
        default_base_url="https://api.deepseek.com",
        thinking_enabled_value="enabled",
        thinking_disabled_value="disabled",
    ),
)
PROVIDER_SPEC_BY_KEY: dict[AiProviderKey, AiProviderCatalogSpec] = {
    spec.key: spec for spec in PROVIDER_SPECS
}
PROVIDER_KEYS: tuple[AiProviderKey, ...] = tuple(spec.key for spec in PROVIDER_SPECS)
PROVIDER_API_KEY_CONFIG_KEYS: dict[AiProviderKey, str] = {
    spec.key: spec.api_key_config_key for spec in PROVIDER_SPECS
}
PROVIDER_BASE_URL_CONFIG_KEYS: dict[AiProviderKey, str] = {
    spec.key: spec.base_url_config_key for spec in PROVIDER_SPECS
}
PROVIDER_LABELS: dict[AiProviderKey, str] = {
    spec.key: spec.label for spec in PROVIDER_SPECS
}
PROVIDER_ENV_DEFAULTS: dict[AiProviderKey, dict[str, str]] = {
    spec.key: {
        "api_key": spec.env_api_key,
        "base_url": spec.env_base_url,
    }
    for spec in PROVIDER_SPECS
}
PROVIDER_HARDCODED_DEFAULTS: dict[AiProviderKey, dict[str, str]] = {
    spec.key: {
        "api_key": "",
        "base_url": spec.default_base_url,
    }
    for spec in PROVIDER_SPECS
}
MODEL_TYPE_LABELS: dict[AiModelType, str] = {
    "llm": "大语言",
    "vl": "VL",
    "translation": "翻译",
    "asr": "ASR",
}
THINKING_PAYLOADS: dict[AiProviderKey, tuple[str, str]] = {
    spec.key: (spec.thinking_enabled_value, spec.thinking_disabled_value)
    for spec in PROVIDER_SPECS
}
PROVIDER_MODEL_ALIASES: dict[AiProviderKey, dict[str, str]] = {
    spec.key: dict(spec.model_aliases)
    for spec in PROVIDER_SPECS
}
_provider_scope_to_canonical: dict[tuple[str, str], AiProviderKey] = {}
PROVIDER_CONFIG_CANONICAL_KEYS: dict[AiProviderKey, AiProviderKey] = {}
for _provider_key in PROVIDER_KEYS:
    _provider_scope = (
        PROVIDER_API_KEY_CONFIG_KEYS[_provider_key],
        PROVIDER_BASE_URL_CONFIG_KEYS[_provider_key],
    )
    _canonical_provider = _provider_scope_to_canonical.setdefault(_provider_scope, _provider_key)
    PROVIDER_CONFIG_CANONICAL_KEYS[_provider_key] = _canonical_provider
CONFIGURABLE_PROVIDER_KEYS: tuple[AiProviderKey, ...] = tuple(_provider_scope_to_canonical.values())


def normalize_provider_key(provider: str | None) -> AiProviderKey | None:
    normalized_provider = str(provider or "").strip().lower()
    if normalized_provider not in PROVIDER_SPEC_BY_KEY:
        return None
    return normalized_provider  # type: ignore[return-value]


def canonicalize_provider_config_scope(provider: str | None) -> AiProviderKey | None:
    normalized_provider = normalize_provider_key(provider)
    if normalized_provider is None:
        return None
    return PROVIDER_CONFIG_CANONICAL_KEYS[normalized_provider]

MODEL_SEEDS: tuple[AiModelSeed, ...] = (
    AiModelSeed("qwen3-vl-flash", "Qwen3 VL Flash", "qwen", "vl", True, False, True),
    AiModelSeed("qwen3-vl-plus", "Qwen3 VL Plus", "qwen", "vl", True, False, True),
    AiModelSeed("qwen-vl-max", "Qwen VL Max", "qwen", "vl", True, False, True),
    AiModelSeed("qwen-vl-plus", "Qwen VL Plus", "qwen", "vl", True, False, True),
    AiModelSeed("qwen3.5-ocr", "Qwen3.5 OCR", "qwen", "vl", True, False, True),
    AiModelSeed("qwen-vl-ocr", "Qwen VL OCR", "qwen", "vl", True, False, True),
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
    AiModelSeed("qwen3-asr-flash-filetrans", "Qwen3 ASR Flash Filetrans", "qwen", "asr", False, False, False),
    AiModelSeed("paraformer-v2", "Paraformer V2", "dashscope", "asr", False, False, False),
    AiModelSeed("fun-asr", "Fun ASR", "dashscope", "asr", False, False, False),
    AiModelSeed("Qwen3.5-4B", "Qwen3.5-4B", "qwen", "llm", False, False, True),
    AiModelSeed("qwen3.5-flash", "qwen3.5-flash", "qwen", "llm", False, False, True),
    AiModelSeed("GLM-Z1-9B-0414", "GLM-Z1-9B-0414", "siliconflow", "llm", False, False, True),
    AiModelSeed("Hunyuan-MT-7B", "Hunyuan-MT-7B", "siliconflow", "translation", False, False, True),
    AiModelSeed("deepseek-v4-flash", "DeepSeek V4 Flash", "deepseek", "llm", False, True, True),
    AiModelSeed("deepseek-v4-pro", "DeepSeek V4 Pro", "deepseek", "llm", False, True, True),
)

CATEGORIES: tuple[AiModelCategoryDefinition, ...] = (
    AiModelCategoryDefinition("llm", "大语言", "负责纯文本推理、改写、点评、归类等场景。"),
    AiModelCategoryDefinition("vl", "VL", "负责读图、读 OCR 结果并产出结构化内容。"),
    AiModelCategoryDefinition("translation", "翻译", "负责中英翻译、句子批量翻译等场景。"),
    AiModelCategoryDefinition("asr", "ASR", "负责音视频转写、字幕识别。"),
)

SCENES: tuple[AiSceneDefinition, ...] = (
    AiSceneDefinition(
        key="ai_split",
        label="AI 分卡",
        description="脑图编辑页右键 AI 分卡。把无子节点的长内容卡片原位拆成并列或层级小卡片，尽量保留原句。",
        category_key="llm",
        config_key="scene_model_ai_split",
        thinking_config_key="scene_model_ai_split_thinking_enabled",
        default_model=DASHSCOPE_TEXT_MODEL,
        legacy_config_keys=("mindmap_ai_split_model",),
        legacy_thinking_config_keys=("mindmap_ai_split_thinking_enabled",),
        source_location="apps/api/src/memory_anki/modules/palaces/application/mindmap_ai_split_service.py",
    ),
    AiSceneDefinition(
        key="peg_association_suggestions",
        label="记忆桩联想建议",
        description="基于宫殿记忆桩、关联章节和用户输入知识点，生成可挂载到具体桩位的联想建议。",
        category_key="llm",
        config_key="scene_model_peg_association_suggestions",
        thinking_config_key="scene_model_peg_association_suggestions_thinking_enabled",
        default_model=DASHSCOPE_TEXT_MODEL,
        legacy_config_keys=("mindmap_ai_split_model",),
        legacy_thinking_config_keys=("mindmap_ai_split_thinking_enabled",),
        source_location="apps/api/src/memory_anki/modules/palaces/application/peg_association_service.py",
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
        key="review_ai_learning",
        label="复习 AI 学习工作台",
        description="复习中的提问、讲解、即时出题和知识纠错。",
        category_key="llm",
        config_key="scene_model_review_ai_learning",
        thinking_config_key="scene_model_review_ai_learning_thinking_enabled",
        default_model=DASHSCOPE_TEXT_MODEL,
        legacy_config_keys=("ai_model_text",),
        legacy_thinking_config_keys=("ai_model_text_thinking_enabled",),
        source_location="apps/api/src/memory_anki/modules/ai_learning/application/service.py",
    ),    AiSceneDefinition(
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
        label="学习组归类",
        description="把题目按学习组分组，或把已存在的大宫殿题目批量归类到各个学习组。",
        category_key="llm",
        config_key="scene_model_quiz_mini_palace",
        thinking_config_key="scene_model_quiz_mini_palace_thinking_enabled",
        default_model="qwen-turbo",
        legacy_config_keys=("ai_model_quiz_mini_palace",),
        legacy_thinking_config_keys=("ai_model_quiz_mini_palace_thinking_enabled",),
        source_location="apps/api/src/memory_anki/modules/palace_quiz/application/ai_service.py",
    ),
    AiSceneDefinition(
        key="quiz_node_binding",
        label="题库结合",
        description="分析宫殿题库与思维导图，把题目绑定到知识点卡片。",
        category_key="llm",
        config_key="scene_model_quiz_node_binding",
        thinking_config_key="scene_model_quiz_node_binding_thinking_enabled",
        default_model="qwen-plus",
        legacy_config_keys=("ai_model_quiz_text",),
        legacy_thinking_config_keys=("ai_model_quiz_text_thinking_enabled",),
        source_location="apps/api/src/memory_anki/modules/palace_quiz/application/node_binding.py",
    ),
    AiSceneDefinition(
        key="quiz_text_generation",
        label="文本文件转题",
        description="把 txt、markdown、json 等文本资料整理为程序可识别的最终题库 JSON。",
        category_key="llm",
        config_key="scene_model_quiz_text_generation",
        thinking_config_key="scene_model_quiz_text_generation_thinking_enabled",
        default_model="qwen-plus",
        legacy_config_keys=("ai_model_quiz_text",),
        legacy_thinking_config_keys=("ai_model_quiz_text_thinking_enabled",),
        source_location="apps/api/src/memory_anki/modules/palace_quiz/application/ai_service.py",
    ),
    AiSceneDefinition(
        key="vision_image_mindmap",
        label="单图转脑图",
        description="上传单张图片后，直接识别结构并生成脑图草稿。",
        category_key="vl",
        config_key="scene_model_vision_image_mindmap",
        thinking_config_key="scene_model_vision_image_mindmap_thinking_enabled",
        default_model=DASHSCOPE_OCR_MODEL,
        allow_visual_llm=True,
        legacy_config_keys=("ai_model_vision",),
        legacy_thinking_config_keys=("ai_model_vision_thinking_enabled",),
        source_location="apps/api/src/memory_anki/modules/palaces/application/mindmap_import_job_service.py",
    ),
    AiSceneDefinition(
        key="vision_image_text",
        label="单图转文字",
        description="上传单张图片后，仅抽取文字，不生成脑图结构。",
        category_key="vl",
        config_key="scene_model_vision_image_text",
        thinking_config_key="scene_model_vision_image_text_thinking_enabled",
        default_model=DASHSCOPE_OCR_MODEL,
        allow_visual_llm=True,
        legacy_config_keys=("ai_model_vision",),
        legacy_thinking_config_keys=("ai_model_vision_thinking_enabled",),
        source_location="apps/api/src/memory_anki/modules/palaces/application/mindmap_import_job_service.py",
    ),
    AiSceneDefinition(
        key="vision_batch_mindmap",
        label="多图转脑图",
        description="普通正文先视觉直出，失败时逐页 OCR；显式结构图使用独立补全提示词。",
        category_key="vl",
        config_key="scene_model_vision_batch_mindmap",
        thinking_config_key="scene_model_vision_batch_mindmap_thinking_enabled",
        default_model="qwen3-vl-flash",
        allow_visual_llm=True,
        legacy_config_keys=("ai_model_vision",),
        legacy_thinking_config_keys=("ai_model_vision_thinking_enabled",),
        source_location="apps/api/src/memory_anki/modules/palaces/application/mindmap_import_job_service.py",
    ),
    AiSceneDefinition(
        key="vision_structure_mindmap",
        label="结构图补全正文",
        description="用户显式指定结构图时，先识别结构并用正文补全。",
        category_key="vl",
        config_key="scene_model_vision_structure_mindmap",
        thinking_config_key="scene_model_vision_structure_mindmap_thinking_enabled",
        default_model="qwen3-vl-flash",
        allow_visual_llm=True,
        legacy_config_keys=("scene_model_vision_batch_mindmap", "ai_model_vision"),
        legacy_thinking_config_keys=(
            "scene_model_vision_batch_mindmap_thinking_enabled",
            "ai_model_vision_thinking_enabled",
        ),
        source_location="apps/api/src/memory_anki/modules/palaces/application/mindmap_import_job_service.py",
    ),    AiSceneDefinition(
        key="mindmap_ocr_formatter",
        label="OCR 脑图格式整理",
        description="把逐页 OCR 原文整理为严格脑图 JSON，仅在回退或用户主动重整时调用。",
        category_key="llm",
        config_key="scene_model_mindmap_ocr_formatter",
        thinking_config_key="scene_model_mindmap_ocr_formatter_thinking_enabled",
        default_model="deepseek-v4-flash",
        source_location="apps/api/src/memory_anki/modules/palaces/application/mindmap_import_job_service.py",
    ),
    AiSceneDefinition(
        key="quiz_image_generation",
        label="图片出题",
        description="从上传图片识别题目并生成题库草稿。",
        category_key="vl",
        config_key="scene_model_quiz_image_generation",
        thinking_config_key="scene_model_quiz_image_generation_thinking_enabled",
        default_model=DASHSCOPE_OCR_MODEL,
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
)

CATEGORY_BY_KEY = {item.key: item for item in CATEGORIES}
SCENE_BY_KEY = {item.key: item for item in SCENES}


def ensure_ai_model_catalog_seed(session: Session) -> None:
    existing_rows = {row.key: row for row in session.query(AiModelCatalog).all()}
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


def normalize_model_name(value: str | None) -> str:
    return str(value or "").strip()


def category_model_config_key(category_key: AiModelType) -> str:
    return f"category_model_{category_key}"


def category_thinking_config_key(category_key: AiModelType) -> str:
    return f"category_model_{category_key}_thinking_enabled"

