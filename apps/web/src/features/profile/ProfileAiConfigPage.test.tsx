import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProfileAiConfigPage } from '@/features/profile/ProfileAiConfigPage'
import * as profileApi from '@/shared/api/modules/profile'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/shared/api/modules/voiceCoach', () => ({
  synthesizeVoiceCoachApi: vi.fn(),
}))

const baseResponse = {
  providers: [
    {
      key: 'dashscope',
      label: 'DashScope',
      api_key_masked: 'dash****key',
      has_api_key: true,
      base_url: 'https://dashscope.example/v1',
      api_key_config_key: 'dashscope_api_key',
      base_url_config_key: 'dashscope_base_url',
    },
  ],
  categories: [
    {
      key: 'llm',
      label: '大语言',
      description: '测试分类',
      shared_model: 'qwen3.5-flash',
      shared_thinking_enabled: false,
      has_shared_config: true,
      available_models: [
        {
          key: 'qwen3.5-flash',
          label: 'qwen3.5-flash（无视觉）',
          display_name: 'qwen3.5-flash',
          provider: 'qwen',
          provider_label: 'Qwen',
          model_type: 'llm',
          model_type_label: '大语言',
          has_vision: false,
          supports_thinking: false,
          supports_temperature: true,
          is_builtin: true,
          is_active: true,
          default_base_url: 'https://dashscope.example/v1',
        },
        {
          key: 'glm-4.7-flash',
          label: 'GLM 4.7 Flash（无视觉）',
          display_name: 'GLM 4.7 Flash',
          provider: 'zhipu',
          provider_label: 'Zhipu',
          model_type: 'llm',
          model_type_label: '大语言',
          has_vision: false,
          supports_thinking: true,
          supports_temperature: true,
          is_builtin: true,
          is_active: true,
          default_base_url: 'https://zhipu.example/v1',
        },
      ],
      scene_keys: ['ai_split', 'reading_sentence_rewrite'],
      scene_details: [
        { key: 'ai_split', label: 'AI 分卡', description: '拆分节点' },
        { key: 'reading_sentence_rewrite', label: '英语阅读句子改写', description: '改写句子' },
      ],
    },
  ],
  models: [
    {
      key: 'qwen3.5-flash',
      label: 'qwen3.5-flash（无视觉）',
      display_name: 'qwen3.5-flash',
      provider: 'qwen',
      provider_label: 'Qwen',
      model_type: 'llm',
      model_type_label: '大语言',
      has_vision: false,
      supports_thinking: false,
      supports_temperature: true,
      is_builtin: true,
      is_active: true,
      default_base_url: 'https://dashscope.example/v1',
    },
    {
      key: 'glm-4.7-flash',
      label: 'GLM 4.7 Flash（无视觉）',
      display_name: 'GLM 4.7 Flash',
      provider: 'zhipu',
      provider_label: 'Zhipu',
      model_type: 'llm',
      model_type_label: '大语言',
      has_vision: false,
      supports_thinking: true,
      supports_temperature: true,
      is_builtin: true,
      is_active: true,
      default_base_url: 'https://zhipu.example/v1',
    },
  ],
  scenes: [
    {
      key: 'ai_split',
      label: 'AI 分卡',
      description: '拆分节点',
      category_key: 'llm',
      category_label: '大语言',
      config_key: 'scene_model_ai_split',
      thinking_config_key: 'scene_model_ai_split_thinking_enabled',
      default_model: 'glm-4.7-flash',
      current_model: 'glm-4.7-flash',
      default_thinking_enabled: true,
      current_thinking_enabled: true,
      effective_model: 'glm-4.7-flash',
      effective_thinking_enabled: true,
      inherits_category_default: false,
      available_models: [
        {
          key: 'qwen3.5-flash',
          label: 'qwen3.5-flash（无视觉）',
          display_name: 'qwen3.5-flash',
          provider: 'qwen',
          provider_label: 'Qwen',
          model_type: 'llm',
          model_type_label: '大语言',
          has_vision: false,
          supports_thinking: false,
          supports_temperature: true,
          is_builtin: true,
          is_active: true,
          default_base_url: 'https://dashscope.example/v1',
        },
        {
          key: 'glm-4.7-flash',
          label: 'GLM 4.7 Flash（无视觉）',
          display_name: 'GLM 4.7 Flash',
          provider: 'zhipu',
          provider_label: 'Zhipu',
          model_type: 'llm',
          model_type_label: '大语言',
          has_vision: false,
          supports_thinking: true,
          supports_temperature: true,
          is_builtin: true,
          is_active: true,
          default_base_url: 'https://zhipu.example/v1',
        },
      ],
      source_location: 'test.py',
      latest_resolved_model: null,
    },
    {
      key: 'reading_sentence_rewrite',
      label: '英语阅读句子改写',
      description: '改写句子',
      category_key: 'llm',
      category_label: '大语言',
      config_key: 'scene_model_reading_sentence',
      thinking_config_key: 'scene_model_reading_sentence_thinking_enabled',
      default_model: 'qwen3.5-flash',
      current_model: 'qwen3.5-flash',
      default_thinking_enabled: false,
      current_thinking_enabled: false,
      effective_model: 'qwen3.5-flash',
      effective_thinking_enabled: false,
      inherits_category_default: true,
      available_models: [
        {
          key: 'qwen3.5-flash',
          label: 'qwen3.5-flash（无视觉）',
          display_name: 'qwen3.5-flash',
          provider: 'qwen',
          provider_label: 'Qwen',
          model_type: 'llm',
          model_type_label: '大语言',
          has_vision: false,
          supports_thinking: false,
          supports_temperature: true,
          is_builtin: true,
          is_active: true,
          default_base_url: 'https://dashscope.example/v1',
        },
        {
          key: 'glm-4.7-flash',
          label: 'GLM 4.7 Flash（无视觉）',
          display_name: 'GLM 4.7 Flash',
          provider: 'zhipu',
          provider_label: 'Zhipu',
          model_type: 'llm',
          model_type_label: '大语言',
          has_vision: false,
          supports_thinking: true,
          supports_temperature: true,
          is_builtin: true,
          is_active: true,
          default_base_url: 'https://zhipu.example/v1',
        },
      ],
      source_location: 'test.py',
      latest_resolved_model: null,
    },
  ],
} as const

describe('ProfileAiConfigPage', () => {
  it('shows custom-scene state and saves shared category config', async () => {
    vi.spyOn(profileApi, 'getAiModelScenariosApi').mockResolvedValue(baseResponse as never)
    const updateSpy = vi.spyOn(profileApi, 'updateAiModelScenariosApi').mockResolvedValue(baseResponse as never)

    render(<ProfileAiConfigPage />)

    await waitFor(() => {
      expect(screen.getByText('通用配置')).toBeTruthy()
    })

    expect(screen.getByText('已单独配置')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('通用模型'), {
      target: { value: 'glm-4.7-flash' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存并覆盖全部场景' }))

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith({
        category_updates: {
          llm: {
            default_model: 'glm-4.7-flash',
            default_thinking_enabled: false,
            apply_to_scenes: true,
          },
        },
      })
    })
  })

  it('restores a custom scene back to the shared model', async () => {
    vi.spyOn(profileApi, 'getAiModelScenariosApi').mockResolvedValue(baseResponse as never)
    const updateSpy = vi.spyOn(profileApi, 'updateAiModelScenariosApi').mockResolvedValue(baseResponse as never)

    render(<ProfileAiConfigPage />)

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: '恢复通用配置' }).length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getAllByRole('button', { name: '恢复通用配置' })[0])

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith({
        scene_updates: {
          ai_split: {
            default_model: 'qwen3.5-flash',
            current_model: 'qwen3.5-flash',
            default_thinking_enabled: false,
            current_thinking_enabled: false,
          },
        },
      })
    })
  })
})
