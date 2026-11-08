import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FreestyleCard } from '@/shared/api/contracts'
import type { FreestyleRoundPlanState } from '@/modules/practice/domain/roundPlan'
import type { FreestyleUnitEncounterState } from '@/modules/practice/domain/queueState'
import { FreestyleQueuePanel } from './FreestyleQueuePanel'

const mocks = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastInfo: vi.fn(),
}))
vi.mock('@/shared/feedback/toast', () => ({
  toast: { success: mocks.toastSuccess, info: mocks.toastInfo, error: vi.fn() },
}))

function unitCard(id: string, title: string, palaceId = 1): FreestyleCard {
  return {
    id,
    type: 'mindmap_branch',
    content_type: 'mindmap_branch',
    palace_id: palaceId,
    palace_title: `宫殿 ${palaceId}`,
    unit_id: `unit-${id}`,
    unit_revision: 1,
    anchor_uid: `${id}-anchor`,
    context_path: [{ uid: `${id}-anchor`, text: title }],
    node_uids: [`${id}-anchor`],
    node_count: 1,
  } as FreestyleCard
}

function plan(cards: FreestyleCard[]): FreestyleRoundPlanState {
  const cardsById = Object.fromEntries(cards.map((card) => [card.id, {
    cardId: card.id,
    sourceCardId: card.id,
    occurrenceKind: 'source',
    retryAttempt: 0,
    palaceId: card.type === 'mindmap_branch' ? card.palace_id : null,
    palaceTitle: card.type === 'mindmap_branch' ? card.palace_title ?? '' : '',
    label: card.type === 'mindmap_branch' ? card.context_path.at(-1)?.text ?? card.id : card.id,
    kind: card.type,
    status: 'pending',
    lastRating: null,
    retryAfterCards: 0,
    attemptCount: 0,
    updatedAt: 0,
  }]))
  return {
    roundId: 'round-1',
    configSignature: '',
    createdAt: 0,
    candidateCount: cards.length,
    scheduledCount: cards.length,
    limitReached: false,
    orderIds: cards.map((card) => card.id),
    cardsById,
  } as FreestyleRoundPlanState
}

function renderPanel() {
  const cards = [unitCard('a', '北宋兴学'), unitCard('b', '书院发展', 2), unitCard('c', '官学制度')]
  const encounters: Record<string, FreestyleUnitEncounterState> = {}
  const onExclude = vi.fn()
  const onRestore = vi.fn()
  const onReorder = vi.fn()
  const onRateCards = vi.fn(() => ({ queued: 2, unchanged: 0, skipped: 0 }))
  render(
    <FreestyleQueuePanel
      cards={cards}
      roundPlan={plan(cards)}
      completedIds={[]}
      hiddenIds={[]}
      encounters={encounters}
      currentCardId="a"
      ratingSaveEntries={{}}
      onExclude={onExclude}
      onRestore={onRestore}
      onReorder={onReorder}
      onRateCards={onRateCards}
    />,
  )
  return { cards, onExclude, onRestore, onReorder, onRateCards }
}

beforeEach(() => {
  mocks.toastSuccess.mockReset()
  mocks.toastInfo.mockReset()
})

describe('FreestyleQueuePanel', () => {
  it('filters by keyword and palace without navigating the active feed card', () => {
    renderPanel()
    fireEvent.change(screen.getByRole('searchbox', { name: '筛选本轮队列' }), { target: { value: '书院' } })
    expect(screen.getByText('书院发展')).toBeTruthy()
    expect(screen.queryByText('北宋兴学')).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: '按宫殿筛选' }), { target: { value: '2' } })
    expect(screen.getByText('书院发展')).toBeTruthy()
    expect(screen.queryByText('官学制度')).toBeNull()
    expect(screen.getByTestId('freestyle-queue-panel').getAttribute('data-keyboard-shortcuts-suspended')).toBe('true')
  })

  it('multi-selects available units and removes them from this round only', () => {
    const { onExclude } = renderPanel()
    fireEvent.click(screen.getByRole('checkbox', { name: '选择：北宋兴学' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择：书院发展' }))
    fireEvent.click(screen.getByRole('button', { name: '移出本轮' }))
    expect(onExclude).toHaveBeenCalledWith(['a', 'b'])
    expect(screen.getByText('当前')).toBeTruthy()
  })

  it('bulk-restores all selected items from the removed view', () => {
    const cards = [unitCard('a', '北宋兴学'), unitCard('b', '书院发展')]
    const rowPlan = plan(cards)
    rowPlan.cardsById.a.status = 'excluded'
    rowPlan.cardsById.b.status = 'excluded'
    const onRestore = vi.fn()
    render(
      <FreestyleQueuePanel
        cards={cards}
        roundPlan={rowPlan}
        completedIds={[]}
        hiddenIds={['a', 'b']}
        encounters={{}}
        currentCardId={null}
        ratingSaveEntries={{}}
        onExclude={vi.fn()}
        onRestore={onRestore}
        onReorder={vi.fn()}
        onRateCards={vi.fn(() => ({ queued: 0, unchanged: 0, skipped: 0 }))}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: '已移出 2' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '全选筛选结果' }))
    fireEvent.click(screen.getByRole('button', { name: '恢复 2 张' }))
    expect(onRestore).toHaveBeenCalledWith(['a', 'b'])
  })

  it('restores a removed item from the removed view', () => {
    const cards = [unitCard('a', '北宋兴学')]
    const rowPlan = plan(cards)
    rowPlan.cardsById.a.status = 'excluded'
    const onRestore = vi.fn()
    render(
      <FreestyleQueuePanel
        cards={cards}
        roundPlan={rowPlan}
        completedIds={[]}
        hiddenIds={['a']}
        encounters={{}}
        currentCardId={null}
        ratingSaveEntries={{}}
        onExclude={vi.fn()}
        onRestore={onRestore}
        onReorder={vi.fn()}
        onRateCards={vi.fn(() => ({ queued: 0, unchanged: 0, skipped: 0 }))}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: '已移出 1' }))
    fireEvent.click(screen.getByRole('button', { name: '恢复：北宋兴学' }))
    expect(onRestore).toHaveBeenCalledWith(['a'])
  })

  it('confirms a same-grade batch before invoking the rating outbox', async () => {
    const { onRateCards } = renderPanel()
    fireEvent.click(screen.getByRole('checkbox', { name: '选择：北宋兴学' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择：书院发展' }))
    fireEvent.click(screen.getByRole('button', { name: '困难' }))
    expect(onRateCards).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认评分 2 张' }))
    await waitFor(() => expect(onRateCards).toHaveBeenCalledWith(['a', 'b'], 2))
    expect(mocks.toastSuccess).toHaveBeenCalled()
  })

  it('shows completed items as read-only and offers list-only reorder controls', () => {
    const cards = [unitCard('a', '北宋兴学'), unitCard('b', '书院发展')]
    const rowPlan = plan(cards)
    rowPlan.cardsById.a.status = 'completed'
    rowPlan.cardsById.a.lastRating = 3
    const onReorder = vi.fn()
    render(
      <FreestyleQueuePanel
        cards={cards}
        roundPlan={rowPlan}
        completedIds={['a']}
        hiddenIds={[]}
        encounters={{}}
        currentCardId="a"
        ratingSaveEntries={{}}
        onExclude={vi.fn()}
        onRestore={vi.fn()}
        onReorder={onReorder}
        onRateCards={vi.fn(() => ({ queued: 0, unchanged: 0, skipped: 0 }))}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: '已评分 1' }))
    const readOnlyRow = screen.getByTestId('freestyle-queue-row')
    expect(within(readOnlyRow).getByText('记得')).toBeTruthy()
    expect(within(readOnlyRow).queryByRole('checkbox', { name: '选择：北宋兴学' })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: '待评分 1' }))
    expect(screen.getByRole('button', { name: '上移：书院发展' })).toBeTruthy()
  })

  it('reorders only unrated rows through list controls', () => {
    const cards = [unitCard('a', '已评分'), unitCard('b', '待评分甲'), unitCard('c', '待评分乙')]
    const rowPlan = plan(cards)
    rowPlan.cardsById.a.status = 'completed'
    rowPlan.cardsById.a.lastRating = 3
    const onReorder = vi.fn()
    render(
      <FreestyleQueuePanel
        cards={cards}
        roundPlan={rowPlan}
        completedIds={['a']}
        hiddenIds={[]}
        encounters={{}}
        currentCardId="a"
        ratingSaveEntries={{}}
        onExclude={vi.fn()}
        onRestore={vi.fn()}
        onReorder={onReorder}
        onRateCards={vi.fn(() => ({ queued: 0, unchanged: 0, skipped: 0 }))}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '下移：待评分甲' }))
    expect(onReorder).toHaveBeenCalledWith(['a', 'c', 'b'])
  })
})
