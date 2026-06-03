import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import ProfileAiSplitPage from '@/features/profile/ProfileAiSplitPage'
import * as profileApi from '@/shared/api/modules/profile'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
  },
}))

function buildSettings() {
  return {
    default_algorithm: 'ebbinghaus',
    default_review_mode: 'flashcard',
    custom_intervals: '1,2,4',
    algorithm_change_scope: 'future_only',
    sleep_review_time: '22:00',
    early_review_anchor: 'true',
    ebbinghaus_intervals: '1h,sleep,1,2,4',
    daily_max_reviews: '0',
    mastered_interval: '180',
    auto_smooth_overdue: 'true',
    overdue_smoothing_days: '7',
    overdue_smoothing_threshold: '5',
    time_recording_threshold_seconds: '0',
    import_pdf_quote_original_default: 'true',
    import_pdf_mount_leaf_only_default: 'true',
    import_pdf_preserve_emphasis_default: 'true',
    import_pdf_semantic_split_default: 'true',
    import_pdf_preserve_line_breaks_default: 'true',
    mindmap_ai_split_api_key: '',
    mindmap_ai_split_base_url: '',
    mindmap_ai_split_model: 'qwen3.6-flash',
    mindmap_ai_split_temperature: '0.2',
    mindmap_ai_split_max_children: '5',
    mindmap_ai_split_include_note: 'true',
    mindmap_ai_split_custom_instruction: '',
  }
}

describe('ProfileAiSplitPage', () => {
  it('loads and saves ai split settings through review settings api', async () => {
    vi.spyOn(profileApi, 'getReviewSettingsApi').mockResolvedValue(buildSettings() as never)
    const updateReviewSettingsApi = vi
      .spyOn(profileApi, 'updateReviewSettingsApi')
      .mockResolvedValue({
        ...buildSettings(),
        mindmap_ai_split_model: 'qwen-plus',
        mindmap_ai_split_include_note: 'false',
        mindmap_ai_split_custom_instruction: '优先按考试框架拆分。',
      } as never)

    render(
      <MemoryRouter initialEntries={['/profile/ai-split']}>
        <ProfileAiSplitPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'AI分卡配置' })).toBeTruthy()
    })

    fireEvent.change(screen.getByLabelText('Model'), {
      target: { value: 'qwen-plus' },
    })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.change(screen.getByLabelText('自定义附加说明'), {
      target: { value: '优先按考试框架拆分。' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存 AI 分卡配置' }))

    await waitFor(() => {
      expect(updateReviewSettingsApi).toHaveBeenCalledWith(
        expect.objectContaining({
          mindmap_ai_split_model: 'qwen-plus',
          mindmap_ai_split_include_note: 'false',
          mindmap_ai_split_custom_instruction: '优先按考试框架拆分。',
        }),
      )
    })
  })
})
