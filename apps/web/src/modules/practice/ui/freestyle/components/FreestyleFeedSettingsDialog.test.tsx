import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FreestyleFeedSettingsDialog } from './FreestyleFeedSettingsDialog'
import type { FreestyleFeedConfig } from '@/shared/api/contracts'

const getPalacesGroupedApiMock = vi.fn()
const getSubjectTreeApiMock = vi.fn()

vi.mock('@/modules/content/public', () => ({
  getPalacesGroupedApi: (...args: unknown[]) => getPalacesGroupedApiMock(...args),
  getSubjectTreeApi: (...args: unknown[]) => getSubjectTreeApiMock(...args),
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
  mix_mode: 'ratio',
  mix_ratio: { mindmap: 2, quiz: 1 },
  bound_quiz_placement: 'into_mix',
  palace_order: 'finish_palace_then_next',
  due_policy: 'due_only',
  quiz_mastery_buckets: ['unseen', 'weak', 'reinforce'],
  quiz_scope: 'cross_palace_random',
  queue_length: 20,
  specific_palace_ids: [],
  subject_scope: 'all',
  question_type: 'all',
  weak_quiz_priority: true,
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
    getSubjectTreeApiMock.mockReset()
    getSubjectTreeApiMock.mockResolvedValue({ chapters: [], subject: { id: 1, name: 'Subject' } })
    getPalacesGroupedApiMock.mockResolvedValue({
      subjects: [
        {
          subject: { id: 1, name: 'Subject', color: null },
          chapter_groups: [],
          ungrouped_palaces: [
            {
              id: 11,
              title: 'Palace A',
              resolved_title: 'Palace A',
              resolved_subject: null,
              primary_chapter: null,
            },
            {
              id: 22,
              title: 'Palace B',
              resolved_title: 'Palace B',
              resolved_subject: null,
              primary_chapter: null,
            },
          ],
        },
      ],
    })
  })

  it('toggles all palaces with a single select-all button', async () => {
    const onSave = vi.fn()
    render(
      <FreestyleFeedSettingsDialog
        open
        config={buildConfig({ specific_palace_ids: [] })}
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: '打开宫殿筛选器' }))
    expect(await screen.findByText('Palace A')).toBeTruthy()
    const selectAll = screen.getByRole('button', { name: '全选' })
    expect(selectAll.getAttribute('aria-pressed')).toBe('false')

    const palaceCheckbox = (title: string) =>
      screen.getByRole('checkbox', { name: `选择宫殿${title}` }) as HTMLButtonElement

    fireEvent.click(selectAll)

    await waitFor(() => {
      expect(selectAll.getAttribute('aria-pressed')).toBe('true')
    })
    expect(screen.getByText('已选 2 个宫殿')).toBeTruthy()
    expect(palaceCheckbox('Palace A').getAttribute('data-state')).toBe('checked')
    expect(palaceCheckbox('Palace B').getAttribute('data-state')).toBe('checked')

    fireEvent.click(selectAll)

    await waitFor(() => {
      expect(selectAll.getAttribute('aria-pressed')).toBe('false')
    })
    expect(palaceCheckbox('Palace A').getAttribute('data-state')).toBe('unchecked')
    expect(palaceCheckbox('Palace B').getAttribute('data-state')).toBe('unchecked')
    fireEvent.click(screen.getByRole('button', { name: '确认选择' }))
    expect(screen.getByText(/未指定宫殿/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '保存并重排剩余队列' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ specific_palace_ids: [] }))
  })

  it('marks select-all as pressed when every palace is already selected', async () => {
    render(
      <FreestyleFeedSettingsDialog
        open
        config={buildConfig({ specific_palace_ids: [11, 22] })}
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: '打开宫殿筛选器' }))
    expect(await screen.findByText('Palace A')).toBeTruthy()
    const selectAll = screen.getByRole('button', { name: '全选' })
    expect(selectAll.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('已选 2 个宫殿')).toBeTruthy()
  })

  it('saves mix_mode and mix_ratio from the new controls', async () => {
    const onSave = vi.fn()
    render(
      <FreestyleFeedSettingsDialog
        open
        config={buildConfig()}
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    )

    expect(await screen.findByText('宫殿和题怎么混')).toBeTruthy()
    const mixSelect = screen.getByDisplayValue('按比例穿插')
    fireEvent.change(mixSelect, { target: { value: 'random' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并重排剩余队列' }))
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        mix_mode: 'random',
        mix_ratio: { mindmap: 2, quiz: 1 },
        bound_quiz_placement: 'into_mix',
      }),
    )
  })

  it('exposes quiz practice section and persists mastery buckets + quiz scope', async () => {
    const onSave = vi.fn()
    render(
      <FreestyleFeedSettingsDialog
        open
        config={buildConfig()}
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    )

    expect(await screen.findByText('题目刷题')).toBeTruthy()
    expect(screen.getByText('刷什么题')).toBeTruthy()
    expect(screen.getByText('没做过')).toBeTruthy()

    fireEvent.click(screen.getByRole('checkbox', { name: '错的 / 薄弱' }))

    const scopeSelect = screen.getByDisplayValue('跨宫殿随机')
    fireEvent.change(scopeSelect, { target: { value: 'single_palace_random' } })

    fireEvent.click(screen.getByRole('button', { name: '保存并重排剩余队列' }))
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        quiz_scope: 'single_palace_random',
        quiz_mastery_buckets: expect.arrayContaining(['unseen', 'reinforce']),
      }),
    )
    const saved = onSave.mock.calls[0][0] as FreestyleFeedConfig
    expect(saved.quiz_mastery_buckets).not.toContain('weak')
  })
})
