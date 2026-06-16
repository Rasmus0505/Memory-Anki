import {
  Activity,
  BookCopy,
  Cable,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type {
  AiModelCatalogItem,
  AiModelCategory,
  AiModelType,
  AiProviderKey,
  AiProviderSettings,
  AiSceneBinding,
} from "@/shared/api/contracts";

export type WorkspaceTab = "providers" | "models" | "scenes" | "observability";
export type AiWorkspaceProviderFilter = "all" | AiProviderKey;
export type AiWorkspaceModelOriginFilter = "all" | "builtin" | "custom";
export type AiWorkspaceModelCapabilityFilter = "all" | "thinking" | "vision";

export interface ProviderDraft {
  baseUrl: string;
  apiKeyInput: string;
  clearApiKey: boolean;
}

export interface ModelDraft {
  key: string;
  displayName: string;
  provider: AiProviderKey;
  hasVision: boolean;
  supportsThinking: boolean;
  supportsTemperature: boolean;
}

export interface AiWorkspaceLogFilters {
  provider: string;
  model: string;
  feature: string;
  status: string;
}

export const WORKSPACE_TABS: Array<{
  key: WorkspaceTab;
  label: string;
  icon: LucideIcon;
}> = [
  { key: "providers", label: "Providers", icon: Cable },
  { key: "models", label: "模型目录", icon: BookCopy },
  { key: "scenes", label: "场景绑定", icon: Wrench },
  { key: "observability", label: "调用观测", icon: Activity },
];

export const PROVIDER_SELECT_OPTIONS: Array<{
  key: AiProviderKey;
  label: string;
}> = [
  { key: "deepseek", label: "DeepSeek" },
  { key: "qwen", label: "Qwen" },
  { key: "dashscope", label: "DashScope" },
  { key: "zhipu", label: "Zhipu" },
  { key: "siliconflow", label: "SiliconFlow" },
];

export const MODEL_TYPE_OPTIONS: Array<{
  key: AiModelType;
  label: string;
}> = [
  { key: "llm", label: "大语言" },
  { key: "vl", label: "VL" },
  { key: "translation", label: "翻译" },
  { key: "asr", label: "ASR" },
  { key: "tts", label: "TTS" },
];

export const MODEL_TYPE_HINTS: Record<AiModelType, string> = {
  llm: "纯文本推理类模型。大语言模型会额外标注是否有视觉能力。",
  vl: "读图 / 读 PDF / OCR / 图文结构识别模型。",
  translation: "课程翻译、句子翻译等专用翻译模型。",
  asr: "音视频转写、字幕识别模型。",
  tts: "语音合成与语音播报模型。",
};

export function buildEmptyModelDraft(modelType: AiModelType): ModelDraft {
  return {
    key: "",
    displayName: "",
    provider: "qwen",
    hasVision: modelType === "llm" ? false : modelType === "vl",
    supportsThinking: false,
    supportsTemperature: !["asr", "tts"].includes(modelType),
  };
}

export function normalizeWorkspaceTab(value: string | null): WorkspaceTab {
  if (
    value === "providers" ||
    value === "models" ||
    value === "scenes" ||
    value === "observability"
  ) {
    return value;
  }
  return "providers";
}

export function sceneSupportsThinking(
  scene: AiSceneBinding,
  modelKey: string,
) {
  return Boolean(
    scene.available_models.find((item) => item.key === modelKey)
      ?.supports_thinking,
  );
}

export function categorySupportsThinking(
  category: AiModelCategory,
  modelKey: string,
) {
  return Boolean(
    category.available_models.find((item) => item.key === modelKey)
      ?.supports_thinking,
  );
}

export function formatDateTime(value?: string | null) {
  if (!value) return "暂无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function getConnectionStatusTone(provider: AiProviderSettings) {
  if (!provider.has_api_key) return "border-destructive/40 bg-destructive/5";
  if (provider.last_status === "error") return "border-warning/40 bg-warning/5";
  return "border-border/60 bg-card";
}

export function renderModelCapabilityBadges(model: AiModelCatalogItem) {
  return [
    model.provider_label,
    model.model_type_label,
    model.model_type === "llm" ? (model.has_vision ? "有视觉" : "无视觉") : null,
    model.supports_thinking ? "支持思考" : "不支持思考",
    model.supports_temperature ? "支持温度" : "固定参数",
    model.is_builtin ? "内置" : "自定义",
  ].filter(Boolean) as string[];
}

export function stringifyJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
