import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import PalaceQuizHubPage from '@/app/router/PalaceQuizHubPage'

const getPalacesGroupedApiMock = vi.fn()

vi.mock('@/shared/api/modules/palaces', () => ({
  getPalacesGroupedApi: (...args: unknown[]) => getPalacesGroupedApiMock(...args),
}))

describe('PalaceQuizHubPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getPalacesGroupedApiMock.mockResolvedValue({
      groups: [],
      ungrouped: [],
      subjects: [
        {
          subject: { id: 1, name: '生物', color: '#22c55e' },
          chapter_groups: [
            {
              source_chapter: { id: 11, name: '细胞', subject_id: 1, parent_id: null },
              palaces: [
                {
                  id: 7,
                  title: '细胞宫殿',
                  resolved_title: '细胞宫殿',
                  description: '细胞结构与功能',
                  mastered: false,
                  created_at: '2026-06-01T00:00:00',
                  next_review_at: null,
                  has_due_review: false,
                  current_review_schedule_id: null,
                  review_stage_total: 0,
                  review_stage_completed: 0,
                  review_stage_progress: 0,
                  stage_labels: [],
                  review_stages: [],
                  segments: [],
                  mini_palaces: [],
                  title_mode: 'manual',
                  manual_title: '细胞宫殿',
                  grouping_mode: 'chapter',
                  manual_group_chapter_id: null,
                  binding_status: 'bound',
                  primary_chapter_id: 11,
                  primary_chapter: { id: 11, name: '细胞', subject_id: 1, parent_id: null },
                  resolved_subject: { id: 1, name: '生物', color: '#22c55e' },
                  resolved_parent_chapter: null,
                  group_id: null,
                  group_sort_order: 0,
                  chapters: [],
                },
              ],
            },
          ],
          ungrouped_palaces: [],
        },
      ],
    })
  })

  it('renders palace quiz entries and links into the palace quiz route', async () => {
    render(
      <MemoryRouter>
        <PalaceQuizHubPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('做题区')).toBeTruthy()
    expect(screen.getByText('细胞宫殿')).toBeTruthy()
    expect(screen.getByRole('link', { name: '开始做题' }).getAttribute('href')).toBe('/palaces/7/quiz')
    expect(screen.getByRole('link', { name: '查看脑图' }).getAttribute('href')).toBe('/palaces/7')
  })
})
