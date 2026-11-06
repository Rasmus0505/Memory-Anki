import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FreestyleFeedConfig } from '@/shared/api/contracts'
import { FreestyleRoundConfigDialog } from './FreestyleRoundConfigDialog'
import { getPalacesGroupedApi } from '@/modules/content/public'

vi.mock('@/modules/content/public', () => ({
  getPalacesGroupedApi: vi.fn(),
  getSubjectTreeApi: vi.fn().mockResolvedValue({ chapters: [] }),
  useIsPalaceFavorite: () => false,
}))

const config = {
  training_mode: 'memory_palace',
  mixed_modes: ['memory_palace'],
  streams: {
    memory_palace: {
      specific_palace_ids: [],
      subject_scope: 'all',
      subject_ids: [],
      palace_order: 'finish_palace_then_next',
      unit_order: 'structured',
    },
    quiz: {
      specific_palace_ids: [],
      subject_scope: 'all',
      subject_ids: [],
      question_type: 'all',
      mastery_buckets: ['unseen', 'weak'],
      quiz_scope: 'cross_palace_random',
      overlay_question_range: 'round_units',
      weak_priority: true,
      order: 'new_first',
    },
    english: {
      specific_palace_ids: [],
      subject_scope: 'english',
      subject_ids: [],
      palace_order: 'finish_palace_then_next',
      unit_order: 'structured',
    },
  },
  learn_scope: ['new', 'review'],
  seed: 17,
} as unknown as FreestyleFeedConfig

const twoSubjects = {
  subjects: [
    {
      subject: { id: 1, name: '教育学', color: null },
      chapter_groups: [],
      ungrouped_palaces: [{ id: 11, title: 'Palace A', resolved_title: 'Palace A', chapters: [] }],
    },
    {
      subject: { id: 2, name: '英语', color: null },
      chapter_groups: [],
      ungrouped_palaces: [{ id: 22, title: 'English', resolved_title: 'English', chapters: [] }],
    },
  ],
} as never

function renderDialog(
  onSaveConfig = vi.fn(),
  options: {
    mode?: 'replan' | 'nextRound'
    settlementCount?: number
    onSettleCompleted?: () => void
  } = {},
) {
  render(
    <FreestyleRoundConfigDialog
      open
      config={config}
      onOpenChange={vi.fn()}
      onSaveConfig={onSaveConfig}
      mode={options.mode ?? 'replan'}
      settlementCount={options.settlementCount}
      onSettleCompleted={options.onSettleCompleted}
    />,
  )
  return { onSaveConfig }
}

async function saveKeepingProgress() {
  fireEvent.click(screen.getByRole('button', { name: '保存配置并重排' }))
  fireEvent.click(await screen.findByRole('button', { name: '保留，继续这一轮' }))
}

describe('FreestyleRoundConfigDialog', () => {
  beforeEach(() => {
    vi.mocked(getPalacesGroupedApi).mockReset().mockResolvedValue({ subjects: [] } as never)
  })

  it('saves a memory-palace-only round', async () => {
    const { onSaveConfig } = renderDialog()

    await screen.findByRole('button', { name: '保存配置并重排' })
    expect(screen.queryByRole('radio', { name: /混合模式/ })).toBeNull()
    await saveKeepingProgress()

    expect(onSaveConfig).toHaveBeenCalledTimes(1)
    expect(onSaveConfig.mock.calls[0][1]).toBe('keep-overlap')
    expect(onSaveConfig.mock.calls[0][0]).toMatchObject({
      training_mode: 'memory_palace',
      mixed_modes: ['memory_palace'],
    })
  })

  it('starts a fresh round when overlapping progress is discarded', async () => {
    const { onSaveConfig } = renderDialog()

    await screen.findByRole('button', { name: '保存配置并重排' })
    fireEvent.click(screen.getByRole('button', { name: '保存配置并重排' }))
    fireEvent.click(await screen.findByRole('button', { name: '不保留，开启新一轮' }))

    expect(onSaveConfig).toHaveBeenCalledTimes(1)
    expect(onSaveConfig.mock.calls[0][1]).toBe('start-fresh')
  })

  it('cancels the save when the overlap reminder is dismissed', async () => {
    const { onSaveConfig } = renderDialog()

    await screen.findByRole('button', { name: '保存配置并重排' })
    fireEvent.click(screen.getByRole('button', { name: '保存配置并重排' }))
    const prompt = await screen.findByTestId('freestyle-overlap-progress-dialog')
    fireEvent.click(within(prompt).getByRole('button', { name: '关闭弹窗' }))

    expect(onSaveConfig).not.toHaveBeenCalled()
    expect(screen.queryByTestId('freestyle-overlap-progress-dialog')).toBeNull()
  })

  it('uses next-round copy and CTA after settlement', async () => {
    const { onSaveConfig } = renderDialog(vi.fn(), { mode: 'nextRound' })

    await screen.findByRole('button', { name: '开始下一轮' })
    expect(screen.getByText(/确认后开始全新一轮/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '开始下一轮' }))
    expect(screen.queryByTestId('freestyle-overlap-progress-dialog')).toBeNull()
    expect(onSaveConfig).toHaveBeenCalledTimes(1)
  })

  it('narrows the pool to 新学 only and never allows an empty pool', async () => {
    const { onSaveConfig } = renderDialog()

    const review = await screen.findByRole('checkbox', { name: '复习' })
    expect(review.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(review)
    // The last remaining pool cannot be turned off.
    fireEvent.click(screen.getByRole('checkbox', { name: '新学' }))

    await saveKeepingProgress()
    expect(onSaveConfig.mock.calls[0][0].learn_scope).toEqual(['new'])
  })

  it('takes the palace scope from the bookshelf, not a picker dialog', async () => {
    vi.mocked(getPalacesGroupedApi).mockResolvedValue(twoSubjects)
    const { onSaveConfig } = renderDialog()

    await screen.findByText('教育学')
    fireEvent.click(screen.getByRole('button', { name: '全选' }))
    await saveKeepingProgress()

    expect(onSaveConfig.mock.calls[0][0].streams.memory_palace.specific_palace_ids).toEqual([11, 22])
  })

  it('clears the palace scope back to every palace', async () => {
    vi.mocked(getPalacesGroupedApi).mockResolvedValue(twoSubjects)
    const { onSaveConfig } = renderDialog()

    await screen.findByText('教育学')
    fireEvent.click(screen.getByRole('button', { name: '全选' }))
    fireEvent.click(screen.getByRole('button', { name: '重置' }))
    await saveKeepingProgress()

    expect(onSaveConfig.mock.calls[0][0].streams.memory_palace.specific_palace_ids).toEqual([])
  })

  it('summarizes the pool and palace order', async () => {
    vi.mocked(getPalacesGroupedApi).mockResolvedValue(twoSubjects)
    renderDialog()

    const summary = await screen.findByTestId('freestyle-config-summary')
    expect(within(summary).getByText('新学 + 复习')).toBeTruthy()
    expect(within(summary).getByText(/全部 2 座/)).toBeTruthy()
  })

  it('settles completed cards from the config page', async () => {
    const onSettleCompleted = vi.fn()
    renderDialog(vi.fn(), { settlementCount: 3, onSettleCompleted })

    fireEvent.click(await screen.findByRole('button', { name: '结算已完成 3' }))
    expect(onSettleCompleted).toHaveBeenCalledTimes(1)
  })

  it('hides the settlement action when nothing is finished', async () => {
    renderDialog(vi.fn(), { settlementCount: 0, onSettleCompleted: vi.fn() })

    const button = await screen.findByRole('button', { name: '没有可结算的' })
    expect(button.hasAttribute('disabled')).toBe(true)
  })
})
