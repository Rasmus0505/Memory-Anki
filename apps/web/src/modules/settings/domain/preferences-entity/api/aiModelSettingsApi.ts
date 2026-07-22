import { request } from '@/shared/api/http'
import type {
  AiConnectionTestResponse,
  AiModelImpactResponse,
  AiModelSettingsResponse,
  AiPromptTemplateListResponse,
  AiPromptBlock,
  AiPromptRunSelection,
  AiPromptSceneDefault,
  CompiledPromptSnapshot,
} from '@/shared/api/contracts'

export function getAiModelScenariosApi() {
  return request<AiModelSettingsResponse>('/settings/ai-models')
}

export function getAiPromptTemplatesApi() {
  return request<AiPromptTemplateListResponse>('/settings/ai-prompts')
}

export function getAiPromptBlocksApi() {
  return request<{ items: AiPromptBlock[] }>('/settings/ai-prompt-blocks')
}

export function getAiPromptScenesApi() {
  return request<{ items: AiPromptSceneDefault[] }>('/settings/ai-prompt-scenes')
}

export function previewAiPromptCompositionApi(
  sceneKey: string,
  selection: AiPromptRunSelection,
  variables: Record<string, unknown> = {},
) {
  return request<CompiledPromptSnapshot>('/settings/ai-prompt-compose/preview', {
    method: 'POST',
    body: JSON.stringify({ scene_key: sceneKey, selection, variables }),
  })
}

export function saveAiPromptSceneDefaultApi(sceneKey: string, selection: AiPromptRunSelection) {
  return request<AiPromptSceneDefault>(
    `/settings/ai-prompt-scenes/${encodeURIComponent(sceneKey)}/default`,
    {
      method: 'PUT',
      body: JSON.stringify({
        block_keys: selection.block_keys ?? [],
        scene_instruction: selection.scene_instruction ?? '',
      }),
      persistence: {
        resourceKey: `settings:ai-prompt-scene:${sceneKey}`,
        description: '保存场景默认提示词组合',
        replayMode: 'manual',
      },
    },
  )
}

export function updateAiModelScenariosApi(data: {
  scene_updates?: Record<string, {
    default_model?: string
    current_model?: string
    default_thinking_enabled?: boolean
    current_thinking_enabled?: boolean
  }>
  category_updates?: Partial<Record<'llm' | 'vl' | 'translation' | 'asr', {
    default_model?: string
    default_thinking_enabled?: boolean
    apply_to_scenes?: boolean
  }>>
  scenario_updates?: Record<string, {
    default_model?: string
    current_model?: string
    default_thinking_enabled?: boolean
    current_thinking_enabled?: boolean
  }>
  provider_updates?: Record<string, {
    api_key?: string
    base_url?: string
  }>
}) {
  return request<AiModelSettingsResponse>('/settings/ai-models', {
    method: 'PUT',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: 'settings:ai-models',
      coalesceKey: 'settings:ai-models',
      description: '保存 AI 模型配置',
      replayMode: 'auto',
    },
  })
}

export function createOrUpdateAiModelApi(data: {
  key: string
  display_name?: string
  provider: 'dashscope' | 'qwen' | 'zhipu' | 'siliconflow' | 'deepseek'
  model_type: 'llm' | 'vl' | 'translation' | 'asr'
  has_vision?: boolean
  supports_thinking?: boolean
  supports_temperature?: boolean
  structured_output_mode?: 'json_schema' | 'json_object' | 'prompt_only'
  input_price_per_million?: number | null
  output_price_per_million?: number | null
  cached_input_price_per_million?: number | null
}) {
  return request<AiModelSettingsResponse>('/settings/ai-models/models', {
    method: 'POST',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `settings:ai-models:model:${data.key}`,
      description: '保存 AI 模型目录',
      replayMode: 'manual',
    },
  })
}

export function deleteAiModelApi(modelKey: string) {
  return request<AiModelSettingsResponse>(`/settings/ai-models/models/${encodeURIComponent(modelKey)}`, {
    method: 'DELETE',
    persistence: {
      resourceKey: `settings:ai-models:model:${modelKey}:delete`,
      description: '删除 AI 模型目录',
      replayMode: 'manual',
    },
  })
}

export function getAiModelImpactApi(modelKey: string) {
  return request<AiModelImpactResponse>(`/settings/ai-models/models/${encodeURIComponent(modelKey)}/impact`)
}

export function testAiModelApi(modelKey: string) {
  return request<AiConnectionTestResponse>(`/settings/ai-models/models/${encodeURIComponent(modelKey)}/test`, {
    method: 'POST',
  })
}

export function testAiProviderApi(providerKey: string, modelKey?: string) {
  return request<AiConnectionTestResponse>(`/settings/ai-models/providers/${encodeURIComponent(providerKey)}/test`, {
    method: 'POST',
    body: JSON.stringify(modelKey ? { model_key: modelKey } : {}),
  })
}
