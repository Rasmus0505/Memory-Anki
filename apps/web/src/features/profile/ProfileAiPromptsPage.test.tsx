import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import ProfileAiPromptsPage from '@/features/profile/ProfileAiPromptsPage'
import * as profileApi from '@/shared/api/modules/profile'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
  },
}))

describe('ProfileAiPromptsPage', () => {
  it('loads prompt templates and saves a customized prompt', async () => {
    vi.spyOn(profileApi, 'getAiPromptTemplatesApi').mockResolvedValue({
      items: [
        {
          key: 'ai_prompt_import_batch_mindmap',
          label: '多图合成脑图',
          description: '测试模板',
          template: '默认模板 {{structure_tree_json}}',
          default_template: '默认模板 {{structure_tree_json}}',
          is_customized: false,
          required_placeholders: ['structure_tree_json'],
          available_placeholders: [
            { name: 'structure_tree_json', description: '结构 JSON' },
          ],
        },
      ],
    } as never)
    const updateSpy = vi.spyOn(profileApi, 'updateAiPromptTemplatesApi').mockResolvedValue({
      items: [
        {
          key: 'ai_prompt_import_batch_mindmap',
          label: '多图合成脑图',
          description: '测试模板',
          template: '自定义模板 {{structure_tree_json}}',
          default_template: '默认模板 {{structure_tree_json}}',
          is_customized: true,
          required_placeholders: ['structure_tree_json'],
          available_placeholders: [
            { name: 'structure_tree_json', description: '结构 JSON' },
          ],
        },
      ],
    } as never)

    render(
      <MemoryRouter initialEntries={['/profile/ai-prompts']}>
        <ProfileAiPromptsPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'AI 提示词' })).toBeTruthy()
    })

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '自定义模板 {{structure_tree_json}}' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith({
        ai_prompt_import_batch_mindmap: '自定义模板 {{structure_tree_json}}',
      })
    })
  })
})
