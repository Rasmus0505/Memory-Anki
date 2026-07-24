import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FreestyleFeedSettingsDialog } from './FreestyleFeedSettingsDialog'
import type { FreestyleFeedConfig } from '@/shared/api/contracts'

const getPalacesGroupedApiMock = vi.fn()

vi.mock('@/modules/content/public', () => ({
  getPalacesGroupedApi: (...args: unknown[]) => getPalacesGroupedApiMock(...args),
}))

const baseConfig: FreestyleFeedConfig = {
  content: {
    mindmap_branch: true,
    anki_card: true,
    quiz_question: true,
  },
  weights: {
    mindmap_branch: 2,
    anki_card: 2,
    quiz_question: 1,
  },
  palace_order: 'finish_palace_then_next',
  within_palace_order: 'tree_order',
  due_policy: 'due_only',
  node_limit: 12,
  queue_length: 20,
  specific_palace_ids: [],
  question_type: 'all',
  weak_quiz_priority: true,
  progress_scopes: ['overdue', 'due', 'reinforcement', 'new'],
  include_calendar_today_due: false,
  seed: 17,
}

function buildConfig(overrides: Partial<FreestyleFeedConfig> = {}): FreestyleFeedConfig {
  return {
    ...baseConfig,
    ...overrides,
  }
}

describe('FreestyleFeedSettingsDialog palace select-all', () => {
  beforeEach(() => {
    getPalacesGroupedApiMock.mockReset()
    getPalacesGroupedApiMock.mockResolvedValue({
      subjects: [
        {
          id: 1,
          name: '学科',
          color: null,
          chapter_groups: [],
          ungrouped_palaces: [
            {
              id: 11,
              title: '宫殿甲',
              resolved_title: '宫殿甲',
              resolved_subject: null,
              primary_chapter: null,
              needs_practice: false,
            },
            {
              id: 22,
              title: '宫殿乙',
              resolved_title: '宫殿乙',
              resolved_subject: null,
              primary_chapter: null,
              needs_practice: false,
            },
          ],
        },
      ],
    })
  })

  it('toggles all palaces with a single 全选 button', async () => {
    const onSave = vi.fn()
    render(
      <FreestyleFeedSettingsDialog
        open
        config={buildConfig({ specific_palace_ids: [] })}
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    )

    expect(await screen.findByText('宫殿甲')).toBeTruthy()
    const selectAll = screen.getByRole('button', { name: '全选' })
    expect(selectAll.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(selectAll)

    await waitFor(() => {
      expect(selectAll.getAttribute('aria-pressed')).toBe('true')
    })
    expect(screen.getByText('已选 2 个宫殿')).toBeTruthy()
    expect(
      screen.getAllByRole('checkbox').every((input) => (input as HTMLInputElement).checked),
    ).toBe(true)

    // second click clears everything back to unrestricted
    fireEvent.click(selectAll)

    await waitFor(() => {
      expect(selectAll.getAttribute('aria-pressed')).toBe('false')
    })
    expect(screen.getByText('不勾选 = 全部宫殿都可以出现')).toBeTruthy()
    expect(
      screen.getAllByRole('checkbox').every((input) => !(input as HTMLInputElement).checked),
    ).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '保存并重排剩余队列' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ specific_palace_ids: [] }))
  })

  it('marks 全选 as pressed when every palace is already selected', async () => {
    render(
      <FreestyleFeedSettingsDialog
        open
        config={buildConfig({ specific_palace_ids: [11, 22] })}
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    expect(await screen.findByText('宫殿甲')).toBeTruthy()
    const selectAll = screen.getByRole('button', { name: '全选' })
    expect(selectAll.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('已选 2 个宫殿')).toBeTruthy()
  })
})
