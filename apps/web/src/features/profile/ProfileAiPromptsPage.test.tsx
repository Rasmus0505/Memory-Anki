import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import ProfileAiPromptsPage from '@/features/profile/ProfileAiPromptsPage'
import * as profileApi from '@/features/profile/api'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
  },
}))

describe('ProfileAiPromptsPage', () => {
  it('loads prompt templates and saves a customized prompt', async () => {
    vi.spyOn(profileApi, 'getAiPromptBlocksApi').mockResolvedValue({ items: [] })
    vi.spyOn(profileApi, 'getAiPromptScenesApi').mockResolvedValue({ items: [] })
    vi.spyOn(profileApi, 'getAiPromptTemplatesApi').mockResolvedValue({
      items: [
        {
          key: 'ai_prompt_import_ocr_mindmap_format',
          label: '识别原文整理脑图',
          description: '测试模板',
          template: '默认模板 {{target_title}} {{ocr_text}}',
          default_template: '默认模板 {{target_title}} {{ocr_text}}',
          is_customized: false,
          source_location: 'apps/api/src/memory_anki/modules/palaces/application/mindmap_import/runtime.py',
          required_placeholders: ['target_title', 'ocr_text'],
          available_placeholders: [
            { name: 'target_title', description: '目标标题' },
            { name: 'ocr_text', description: '识别全文' },
          ],
        },
      ],
    } as never)
    const updateSpy = vi.spyOn(profileApi, 'updateAiPromptTemplatesApi').mockResolvedValue({
      items: [
        {
          key: 'ai_prompt_import_ocr_mindmap_format',
          label: '识别原文整理脑图',
          description: '测试模板',
          template: '自定义模板 {{target_title}} {{ocr_text}}',
          default_template: '默认模板 {{target_title}} {{ocr_text}}',
          is_customized: true,
          source_location: 'apps/api/src/memory_anki/modules/palaces/application/mindmap_import/runtime.py',
          required_placeholders: ['target_title', 'ocr_text'],
          available_placeholders: [
            { name: 'target_title', description: '目标标题' },
            { name: 'ocr_text', description: '识别全文' },
          ],
        },
      ],
    } as never)

    render(
      <MemoryRouter initialEntries={['/profile/ai-prompts']}>
        <ProfileAiPromptsPage standalone />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'AI 提示词' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '完整模板兼容' }))
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '自定义模板 {{target_title}} {{ocr_text}}' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存候选' }))

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith({
        ai_prompt_import_ocr_mindmap_format: '自定义模板 {{target_title}} {{ocr_text}}',
      })
    })
  })
})

