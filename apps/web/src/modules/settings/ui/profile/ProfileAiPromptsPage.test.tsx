import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import ProfileAiPromptsPage from '@/modules/settings/ui/profile/ProfileAiPromptsPage'
import * as profileApi from '@/modules/settings/domain/preferences-entity/api'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
  },
}))

describe('ProfileAiPromptsPage', () => {
  it('loads current prompt scenes without the retired template compatibility tab', async () => {
    vi.spyOn(profileApi, 'getAiPromptBlocksApi').mockResolvedValue({ items: [] })
    vi.spyOn(profileApi, 'getAiPromptScenesApi').mockResolvedValue({
      items: [
        {
          scene_key: 'ai_split',
          prompt_key: 'ai_prompt_mindmap_ai_split_system',
          label: 'AI 分卡',
          description: '统一分卡场景',
          category: '脑图分卡',
          block_keys: [],
          blocks: [],
          scene_instruction: '保留原句',
          active_version_id: 'version-1',
          source: 'builtin',
          recommended_block_keys: [],
          compiled_prompt: '保留原句',
          warnings: [],
          estimated_tokens: 10,
        },
        {
          scene_key: 'translation_course_batch',
          prompt_key: 'ai_prompt_translation_course_batch',
          label: '课程翻译',
          description: '听力课程批量翻译',
          category: '做题',
          block_keys: [],
          blocks: [],
          scene_instruction: '指出遗漏要点',
          active_version_id: 'version-2',
          source: 'builtin',
          recommended_block_keys: [],
          compiled_prompt: '指出遗漏要点',
          warnings: [],
          estimated_tokens: 12,
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
      expect(screen.getByText('听力课程批量翻译')).toBeTruthy()
    })
    expect(screen.queryByText('统一分卡场景')).toBeNull()
    expect(screen.queryByRole('button', { name: '完整模板兼容' })).toBeNull()
  })
})
