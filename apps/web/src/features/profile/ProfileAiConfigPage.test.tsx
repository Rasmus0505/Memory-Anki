import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AiWorkspacePage as ProfileAiConfigPage } from '@/features/profile/AiWorkspacePage'
import * as aiLogsApi from '@/entities/ai-log/api'
import * as profileApi from '@/entities/preferences/api'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const baseResponse = {
  summary: {
    provider_count: 4,
    active_model_count: 2,
    scene_count: 2,
    recent_success_call_count: 3,
  },
  providers: [
    {
      key: 'dashscope',
      label: 'DashScope',
      api_key_masked: 'dash****key',
      has_api_key: true,
      base_url: 'https://dashscope.example/v1',
      api_key_config_key: 'dashscope_api_key',
      base_url_config_key: 'dashscope_base_url',
      api_key_source: 'db',
      base_url_source: 'db',
      model_count: 1,
      last_called_at: '2026-06-15T08:00:00',
      last_status: 'success',
      last_success_at: '2026-06-15T08:00:00',
      last_error_at: null,
      last_model: 'qwen3.5-flash',
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
      scene_count: 2,
      custom_scene_count: 1,
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
        { key: 'ai_split', label: 'AI 知识点拆分', description: '拆分知识点' },
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
      usage_count: 1,
      bound_scene_labels: ['英语阅读句子改写'],
      last_used_at: '2026-06-15T08:00:00',
      last_status: 'success',
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
      usage_count: 1,
      bound_scene_labels: ['AI 知识点拆分'],
      last_used_at: null,
      last_status: 'never_used',
    },
  ],
  scenes: [
    {
      key: 'ai_split',
      label: 'AI 知识点拆分',
      description: '拆分知识点',
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
      last_called_at: '2026-06-15T08:00:00',
      last_status: 'success',
      resolved_provider: 'zhipu',
      resolved_model_label: 'GLM 4.7 Flash（无视觉）',
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
      last_called_at: null,
      last_status: null,
      resolved_provider: null,
      resolved_model_label: null,
    },
  ],
} as const

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/profile?aiTab=scenes']}>
      <Routes>
        <Route path="/profile" element={<ProfileAiConfigPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ProfileAiConfigPage', () => {
  it('shows custom-scene state and saves shared category config', async () => {
    vi.spyOn(profileApi, 'getAiModelScenariosApi').mockResolvedValue(baseResponse as never)
    vi.spyOn(aiLogsApi, 'listAiCallLogsApi').mockResolvedValue({ items: [] } as never)
    const updateSpy = vi.spyOn(profileApi, 'updateAiModelScenariosApi').mockResolvedValue(baseResponse as never)

    renderPage()

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
    vi.spyOn(aiLogsApi, 'listAiCallLogsApi').mockResolvedValue({ items: [] } as never)
    const updateSpy = vi.spyOn(profileApi, 'updateAiModelScenariosApi').mockResolvedValue(baseResponse as never)

    renderPage()

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

  it('opens impact dialog before model delete', async () => {
    vi.spyOn(profileApi, 'getAiModelScenariosApi').mockResolvedValue(baseResponse as never)
    vi.spyOn(aiLogsApi, 'listAiCallLogsApi').mockResolvedValue({ items: [] } as never)
    vi.spyOn(profileApi, 'getAiModelImpactApi').mockResolvedValue({
      model_key: 'qwen3.5-flash',
      model_label: 'qwen3.5-flash',
      exists: true,
      can_delete: false,
      usage_count: 1,
      bound_scene_labels: ['英语阅读句子改写'],
      scene_impacts: [
        {
          key: 'reading_sentence_rewrite',
          label: '英语阅读句子改写',
          category_key: 'llm',
          category_label: '大语言',
          config_key: 'scene_model_reading_sentence',
        },
      ],
      category_impacts: [],
    } as never)

    render(
      <MemoryRouter initialEntries={['/profile?aiTab=models']}>
        <Routes>
          <Route path="/profile" element={<ProfileAiConfigPage />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('新增或覆盖模型')).toBeTruthy()
    })

    fireEvent.click(screen.getAllByRole('button', { name: '查看使用影响' })[0])

    await waitFor(() => {
      expect(screen.getByText('模型影响分析')).toBeTruthy()
      expect(screen.getByText('英语阅读句子改写')).toBeTruthy()
    })
  })

  it('loads observability logs and opens detail dialog', async () => {
    vi.spyOn(profileApi, 'getAiModelScenariosApi').mockResolvedValue(baseResponse as never)
    vi.spyOn(aiLogsApi, 'listAiCallLogsApi').mockResolvedValue({
      items: [
        {
          id: 'log-1',
          feature: 'AI 知识点拆分',
          operation: 'mindmap_ai_split',
          status: 'success',
          provider: 'qwen',
          base_url: 'https://dashscope.example/v1',
          model: 'qwen3.5-flash',
          request_id: 'req-1',
          job_id: null,
          palace_id: null,
          created_at: '2026-06-15T08:00:00',
          updated_at: '2026-06-15T08:00:01',
        },
      ],
    } as never)
    vi.spyOn(aiLogsApi, 'getAiCallLogApi').mockResolvedValue({
      id: 'log-1',
      feature: 'AI 知识点拆分',
      operation: 'mindmap_ai_split',
      status: 'success',
      provider: 'qwen',
      base_url: 'https://dashscope.example/v1',
      model: 'qwen3.5-flash',
      request_id: 'req-1',
      job_id: null,
      palace_id: null,
      created_at: '2026-06-15T08:00:00',
      updated_at: '2026-06-15T08:00:01',
      request_payload: { hello: 'world' },
      response_payload: { ok: true },
      error_payload: {},
      prompt_text: 'Reply with OK.',
      response_text: 'OK',
      input_artifacts: [],
    } as never)

    render(
      <MemoryRouter initialEntries={['/profile?aiTab=observability']}>
        <Routes>
          <Route path="/profile" element={<ProfileAiConfigPage />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('AI 知识点拆分')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '查看详情' }))

    await waitFor(() => {
      expect(screen.getByText('AI 调用详情')).toBeTruthy()
      expect(screen.getByText('Prompt')).toBeTruthy()
      expect(screen.getByText('Response Payload')).toBeTruthy()
    })
  })
})
