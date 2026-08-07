import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FreestyleCard, FreestyleFeedConfig } from '@/shared/api/contracts'
import { DEFAULT_QUEUE_STATE } from '@/modules/practice/domain/queueState'
import { createRoundPlan } from '@/modules/practice/domain/roundPlan'
import { FreestyleRoundPlanDialog } from './FreestyleRoundPlanDialog'
import { getPalacesGroupedApi } from '@/modules/content/public'

vi.mock('@/modules/content/public', () => ({
  getPalacesGroupedApi: vi.fn(),
  getSubjectTreeApi: vi.fn().mockResolvedValue({ chapters: [] }),
}))

const config = {
  content: { mindmap_branch: true, anki_card: true, quiz_question: true },
  weights: { mindmap_branch: 2, anki_card: 2, quiz_question: 1 },
  mix_mode: 'ratio',
  mix_ratio: { mindmap: 2, quiz: 1 },
  bound_quiz_placement: 'into_mix',
  palace_order: 'finish_palace_then_next',
  due_policy: 'due_only',
  quiz_mastery_buckets: ['unseen', 'weak'],
  quiz_scope: 'cross_palace_random',
  queue_length: 50,
  specific_palace_ids: [],
  question_type: 'all',
  weak_quiz_priority: true,
  seed: 17,
} as unknown as FreestyleFeedConfig

const card = (id: string): FreestyleCard => ({
  id,
  type: 'mindmap_branch',
  content_type: 'mindmap_branch',
  palace_id: 1,
  palace_title: '宫殿 A',
  anchor_uid: `${id}-anchor`,
  context_path: [{ uid: `${id}-anchor`, text: id }],
  node_uids: [`${id}-node`],
  node_count: 1,
  unit_id: `${id}-unit`,
  unit_revision: 1,
})

describe('FreestyleRoundPlanDialog', () => {
  beforeEach(() => {
    vi.mocked(getPalacesGroupedApi).mockReset().mockResolvedValue({ subjects: [] } as never)
  })

  it('groups the round, supports batch exclusion, and saves config', async () => {
    const cards = [card('one'), card('two')]
    const plan = createRoundPlan('round-1', cards, config, {
      candidate_count: 8,
      scheduled_count: 2,
      queue_limit: 50,
      limit_reached: false,
    })
    const onExclude = vi.fn()
    const onSaveConfig = vi.fn()
    render(
      <FreestyleRoundPlanDialog
        open
        config={config}
        cards={cards}
        currentIndex={0}
        queueState={{ ...DEFAULT_QUEUE_STATE, roundId: 'round-1', currentCardId: 'one' }}
        roundPlan={plan}
        onOpenChange={vi.fn()}
        onJump={vi.fn()}
        onExclude={onExclude}
        onRestore={vi.fn()}
        onReorder={vi.fn()}
        onSaveConfig={onSaveConfig}
        onResetRound={vi.fn()}
      />,
    )

    expect(await screen.findByText('宫殿 A')).toBeTruthy()
    expect(screen.getByText('已安排 2 张 · 候选 8 · 上限 50')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: '选择one' }))
    fireEvent.click(screen.getByRole('button', { name: '排除选中' }))
    expect(onExclude).toHaveBeenCalledWith(['one'])

    fireEvent.click(screen.getByRole('button', { name: '保存配置并重排' }))
    expect(onSaveConfig).toHaveBeenCalledTimes(1)
  })

  it('marks the current card green, shows a drop placeholder, and applies the quiz preset', async () => {
    const cards = [card('one'), card('two')]
    const plan = createRoundPlan('round-1', cards, config)
    const onReorder = vi.fn()
    const onSaveConfig = vi.fn()
    render(
      <FreestyleRoundPlanDialog
        open
        config={config}
        cards={cards}
        currentIndex={0}
        queueState={{ ...DEFAULT_QUEUE_STATE, roundId: 'round-1', currentCardId: 'one' }}
        roundPlan={plan}
        onOpenChange={vi.fn()}
        onJump={vi.fn()}
        onExclude={vi.fn()}
        onRestore={vi.fn()}
        onReorder={onReorder}
        onSaveConfig={onSaveConfig}
        onResetRound={vi.fn()}
      />,
    )

    expect(screen.getByTestId('round-plan-card-one').className).toContain('bg-emerald-500/12')
    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: vi.fn(),
      getData: vi.fn(() => 'one'),
    }
    act(() => {
      fireEvent.dragStart(screen.getByTestId('round-plan-card-two'), { dataTransfer })
      fireEvent.dragOver(screen.getByTestId('round-plan-card-one'), { dataTransfer })
    })
    expect(screen.getByTestId('round-plan-drop-placeholder')).toBeTruthy()
    act(() => {
      fireEvent.drop(screen.getByTestId('round-plan-card-one'), { dataTransfer })
    })
    expect(onReorder).toHaveBeenCalledWith(['two', 'one'])

    await screen.findByRole('button', { name: /^刷题/ })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^刷题/ }))
      await Promise.resolve()
    })
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '保存配置并重排' }))
    })
    expect(onSaveConfig.mock.calls[0][0]).toMatchObject({
      mix_mode: 'quiz_only',
      content: { mindmap_branch: false, anki_card: false, quiz_question: true },
    })
  })

  it('opens the palace picker without closing the configuration dialog', async () => {
    const cards = [card('one')]
    const plan = createRoundPlan('round-1', cards, config)
    render(
      <FreestyleRoundPlanDialog
        open
        config={config}
        cards={cards}
        currentIndex={0}
        queueState={{ ...DEFAULT_QUEUE_STATE, roundId: 'round-1', currentCardId: 'one' }}
        roundPlan={plan}
        onOpenChange={vi.fn()}
        onJump={vi.fn()}
        onExclude={vi.fn()}
        onRestore={vi.fn()}
        onReorder={vi.fn()}
        onSaveConfig={vi.fn()}
        onResetRound={vi.fn()}
      />,
    )

    fireEvent.click((await screen.findAllByRole('button', { name: '选择宫殿' }))[0])

    expect(screen.getByRole('dialog', { name: /宫殿章节筛选/ })).toBeTruthy()
    // 内层 modal 打开时外层会被 aria-hidden（Radix 嵌套 dialog 行为），但不应卸载。
    expect(document.querySelector('[data-dialog-title="true"]')?.textContent).toMatch(/本轮安排/)
  })

  it('saves the palace scope when the picker confirms', async () => {
    vi.mocked(getPalacesGroupedApi).mockResolvedValue({
      subjects: [{
        subject: { id: 1, name: '教育学', color: null },
        chapter_groups: [],
        ungrouped_palaces: [{
          id: 11,
          title: 'Palace A',
          resolved_title: 'Palace A',
          resolved_subject: null,
          primary_chapter: null,
          chapters: [],
        }],
      }],
    } as never)
    const onSaveConfig = vi.fn()
    const cards = [card('one')]
    const plan = createRoundPlan('round-1', cards, config)
    render(
      <FreestyleRoundPlanDialog
        open
        config={config}
        cards={cards}
        currentIndex={0}
        queueState={{ ...DEFAULT_QUEUE_STATE, roundId: 'round-1', currentCardId: 'one' }}
        roundPlan={plan}
        onOpenChange={vi.fn()}
        onJump={vi.fn()}
        onExclude={vi.fn()}
        onRestore={vi.fn()}
        onReorder={vi.fn()}
        onSaveConfig={onSaveConfig}
        onResetRound={vi.fn()}
      />,
    )

    fireEvent.click((await screen.findAllByRole('button', { name: '选择宫殿' }))[0])
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择宫殿Palace A' }))
    fireEvent.click(screen.getByRole('button', { name: '确认选择' }))

    expect(onSaveConfig).toHaveBeenCalledWith(expect.objectContaining({
      streams: expect.objectContaining({
        memory_palace: expect.objectContaining({ specific_palace_ids: [11] }),
      }),
    }))
  })

  it('shows automatic round rebuild progress and blocks duplicate clicks', async () => {
    const onResetRound = vi.fn()
    const cards = [card('one')]
    const plan = createRoundPlan('round-1', cards, config)
    render(
      <FreestyleRoundPlanDialog
        open
        config={config}
        cards={cards}
        currentIndex={0}
        queueState={{ ...DEFAULT_QUEUE_STATE, roundId: 'round-1', currentCardId: 'one' }}
        roundPlan={plan}
        onOpenChange={vi.fn()}
        onJump={vi.fn()}
        onExclude={vi.fn()}
        onRestore={vi.fn()}
        onReorder={vi.fn()}
        onSaveConfig={vi.fn()}
        onResetRound={onResetRound}
        loading
      />,
    )

    await screen.findByText('宫殿 A')
    const button = screen.getByRole('button', { name: '正在安排...' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    act(() => fireEvent.click(button))
    expect(onResetRound).not.toHaveBeenCalled()
  })
})
