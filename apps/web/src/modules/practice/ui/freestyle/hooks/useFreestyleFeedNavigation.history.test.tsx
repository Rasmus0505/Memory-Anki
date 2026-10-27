import { act, render } from '@testing-library/react'
import { useCallback, useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FreestyleUnitEncounterState } from '@/modules/practice/public'
import type { FreestyleCard } from '@/shared/api/contracts'
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

const PAGE = 500

interface Harness {
  navigateNext: () => void
  navigatePrevious: () => void
  /** A finger fling that rests on `index` (visual position moves at once). */
  flingTo: (index: number) => void
  /** A progress-rail jump: straight to an arbitrary page. */
  jumpTo: (index: number) => void
  visualIndex: number
  currentIndex: number
}

/**
 * Mounts the real navigation hook over a fake page-height scroller. A finger
 * gesture only moves the visual index; the queue cursor follows on the real
 * 90ms settle timer, exactly like the feed.
 */
function mount(cards: FreestyleCard[]) {
  const captured: { current: Harness | null } = { current: null }

  function Probe() {
    const queueState = {
      unitEncountersByCardId: {} as Record<string, FreestyleUnitEncounterState>,
      completedIds: [],
      hiddenIds: [],
      roundPlan: null,
    } as unknown as QueueState
    const [currentIndex, setCurrentIndex] = useState(0)
    const goToIndex = useCallback((index: number) => {
      setCurrentIndex(index)
      return index
    }, [])
    const queueRef = useRef(cards)
    queueRef.current = cards
    const nav = useFreestyleFeedNavigation({
      cards,
      currentIndex,
      roundComplete: false,
      goToIndex,
      flushDeferredRestudy: () => currentIndex,
      pendingRestudyCardIds: [],
      queueRef,
      queueState,
      roundPlan: null,
      isActive: true,
      becameActiveAt: 0,
      loading: false,
      queueFrozen: false,
      startupVisualIndex: null,
      onStartupVisualApplied: () => {},
    })
    captured.current = {
      navigateNext: nav.navigateNext,
      navigatePrevious: nav.navigatePrevious,
      flingTo: (index: number) => {
        nav.handleScroll({
          currentTarget: { clientHeight: PAGE, scrollTop: index * PAGE },
        } as never)
      },
      jumpTo: (index: number) => nav.navigateToIndex(index),
      visualIndex: nav.visualIndex,
      currentIndex,
    }
    return null
  }
  render(<Probe />)
  return captured
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('上一张 after a multi-page fling', () => {
  it('returns to the page just above the landing page, not the pre-fling page', () => {
    const harness = mount([card('a'), card('b'), card('c'), card('d')])

    // One fling across b: the visual page rests on c at once, the cursor settles later.
    act(() => harness.current?.flingTo(2))
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(harness.current?.currentIndex).toBe(2)

    act(() => harness.current?.navigatePrevious())
    expect(harness.current?.currentIndex).toBe(1)
  })

  it('returns to the page a rail jump left', () => {
    const harness = mount([card('a'), card('b'), card('c'), card('d')])

    act(() => harness.current?.jumpTo(3))
    expect(harness.current?.currentIndex).toBe(3)
    act(() => harness.current?.navigatePrevious())
    expect(harness.current?.currentIndex).toBe(0)
  })

  it('walks back through the pages a button turn actually left', () => {
    const harness = mount([card('a'), card('b'), card('c'), card('d')])

    act(() => harness.current?.navigateNext())
    act(() => harness.current?.navigateNext())
    expect(harness.current?.currentIndex).toBe(2)

    act(() => harness.current?.navigatePrevious())
    expect(harness.current?.currentIndex).toBe(1)
    act(() => harness.current?.navigatePrevious())
    expect(harness.current?.currentIndex).toBe(0)
  })

  it('never walks forward after a backward swipe', () => {
    const cards = [card('a'), card('b'), card('c'), card('d'), card('e')]
    const harness = mount(cards)

    // Fling forward to d, then swipe back up to b.
    act(() => harness.current?.flingTo(3))
    act(() => {
      vi.advanceTimersByTime(100)
    })
    act(() => harness.current?.flingTo(1))
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(harness.current?.currentIndex).toBe(1)

    // 上一张 must go to the page above (a), never back down to d.
    act(() => harness.current?.navigatePrevious())
    expect(harness.current?.currentIndex).toBe(0)
  })

  it('steps back one page at a time after a long fling', () => {
    const cards = [card('a'), card('b'), card('c'), card('d'), card('e')]
    const harness = mount(cards)

    act(() => harness.current?.navigateNext())
    expect(harness.current?.currentIndex).toBe(1)
    act(() => harness.current?.flingTo(4))
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(harness.current?.currentIndex).toBe(4)

    act(() => harness.current?.navigatePrevious())
    expect(harness.current?.currentIndex).toBe(3)
    act(() => harness.current?.navigatePrevious())
    expect(harness.current?.currentIndex).toBe(2)
    act(() => harness.current?.navigatePrevious())
    expect(harness.current?.currentIndex).toBe(1)
  })
})
