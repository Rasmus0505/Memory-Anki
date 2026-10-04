import { act, render } from '@testing-library/react'
import { useCallback, useRef, useState } from 'react'
import { describe, expect, it } from 'vitest'
import type { FreestyleUnitEncounterState } from '@/modules/practice/public'
import type { FreestyleCard } from '@/shared/api/contracts'
import { isFreestyleRoundComplete } from '@/modules/practice/ui/freestyle/model/roundCompletion'
import type { useImmersiveQueue } from './useImmersiveQueue'
import { useFreestyleFeedNavigation } from './useFreestyleFeedNavigation'

type QueueState = ReturnType<typeof useImmersiveQueue>['queueState']

function card(id: string): FreestyleCard {
  return {
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
  } as unknown as FreestyleCard
}

interface Harness {
  handleCompleteRound: () => void
  visualIndex: number
  currentIndex: number
  canCompleteRound: boolean
  completeTitle: string
  goToLog: number[]
}

function excludedPlan(cardIds: string[]) {
  return {
    cardsById: Object.fromEntries(cardIds.map((id) => [id, { status: 'excluded' }])),
  }
}

function mount(options: {
  cards: FreestyleCard[]
  encounters?: Record<string, FreestyleUnitEncounterState>
  completedIds?: string[]
  hiddenIds?: string[]
  roundPlan?: unknown
}) {
  const captured: { current: Harness | null } = { current: null }
  function Probe() {
    const { cards } = options
    const queueState = {
      unitEncountersByCardId: options.encounters ?? {},
      completedIds: options.completedIds ?? [],
      hiddenIds: options.hiddenIds ?? [],
      roundPlan: options.roundPlan ?? null,
    } as unknown as QueueState
    const [currentIndex, setCurrentIndex] = useState(0)
    const goToLog = useRef<number[]>([])
    const goToIndex = useCallback((index: number) => {
      goToLog.current = [...goToLog.current, index]
      setCurrentIndex(index)
      return index
    }, [])
    const queueRef = useRef(cards)
    queueRef.current = cards
    const roundComplete = isFreestyleRoundComplete(
      cards,
      queueState.unitEncountersByCardId,
      queueState.completedIds,
      queueState.roundPlan,
      queueState.hiddenIds,
    )
    const nav = useFreestyleFeedNavigation({
      cards,
      currentIndex,
      roundComplete,
      goToIndex,
      flushDeferredRestudy: () => currentIndex,
      pendingRestudyCardIds: [],
      queueRef,
      queueState,
      roundPlan: queueState.roundPlan,
      isActive: true,
      becameActiveAt: 0,
      loading: false,
      queueFrozen: false,
      startupVisualIndex: null,
      onStartupVisualApplied: () => {},
    })
    captured.current = {
      handleCompleteRound: nav.handleCompleteRound,
      visualIndex: nav.visualIndex,
      currentIndex,
      canCompleteRound: nav.canCompleteRound,
      completeTitle: nav.completeTitle,
      goToLog: goToLog.current,
    }
    return null
  }
  const result = render(<Probe />)
  return { captured, ...result }
}

describe('useFreestyleFeedNavigation complete cycle', () => {
  it('walks unscored cards one by one and wraps', () => {
    const { captured } = mount({ cards: [card('a'), card('b'), card('c')] })

    expect(captured.current?.goToLog).toEqual([])
    act(() => captured.current?.handleCompleteRound())
    expect(captured.current?.goToLog).toEqual([1])
    expect(captured.current?.currentIndex).toBe(1)
    expect(captured.current?.visualIndex).toBe(1)

    act(() => captured.current?.handleCompleteRound())
    expect(captured.current?.goToLog).toEqual([1, 2])
    expect(captured.current?.currentIndex).toBe(2)

    act(() => captured.current?.handleCompleteRound())
    expect(captured.current?.goToLog).toEqual([1, 2, 0])
    expect(captured.current?.currentIndex).toBe(0)
  })

  // 移除本队列 must never come back as a 完成 target, even while the card is
  // still present in the feed array (the optimistic drop has not landed yet).
  it('never seeks a card that is hidden (移除本队列)', () => {
    const { captured } = mount({
      cards: [card('a'), card('b'), card('c')],
      hiddenIds: ['b'],
    })

    act(() => captured.current?.handleCompleteRound())
    expect(captured.current?.goToLog).toEqual([2]) // skips the removed index 1
    expect(captured.current?.currentIndex).toBe(2)

    act(() => captured.current?.handleCompleteRound())
    expect(captured.current?.goToLog).toEqual([2, 0]) // wraps past the removed card
    expect(captured.current?.currentIndex).toBe(0)
  })

  it('never seeks a card the round plan already excluded', () => {
    const { captured } = mount({
      cards: [card('a'), card('b'), card('c')],
      roundPlan: excludedPlan(['b']),
    })

    act(() => captured.current?.handleCompleteRound())
    expect(captured.current?.goToLog).toEqual([2]) // index 1 is excluded
    expect(captured.current?.currentIndex).toBe(2)
  })

  it('has nowhere to go once 移除本队列 leaves a single unscored card you are on', () => {
    const { captured } = mount({
      cards: [card('a'), card('b')],
      hiddenIds: ['b'],
    })

    // Only 'a' is outstanding and the viewport starts on it → nothing left to seek.
    expect(captured.current?.canCompleteRound).toBe(false)
  })
})
