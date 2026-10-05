import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  LiveStudyPresenceContext,
  type LiveStudyPresenceValue,
} from '@/modules/session/ui/live-presence/liveStudyPresenceContext'
import { emptyLiveStudyProjection } from '@/modules/session/domain/session-entity/model/live-study/liveStudyModel'
import type { FreestyleLiveView } from '@/modules/practice/ui/freestyle/model/freestyleLiveView'
import { useFreestyleLiveMirror } from './useFreestyleLiveMirror'

const RICH_REVEAL = { root: 'revealed', child: 'revealed' }
const QUEUE_CARD_IDS = ['card-1', 'card-2']
const NOOP = () => {}

function remoteView(overrides: Partial<FreestyleLiveView> = {}): FreestyleLiveView {
  return {
    palaceId: 7,
    currentCardId: 'card-2',
    currentIndex: 1,
    queueCardIds: ['card-1', 'card-2'],
    questionState: null,
    revealMap: RICH_REVEAL,
    roundComplete: false,
    rating: null,
    visualIndex: 1,
    viewingCompleteSlot: false,
    roundId: 'round-1',
    planVersion: 1,
    ...overrides,
  }
}

function presenceValue(overrides: Partial<LiveStudyPresenceValue> = {}): LiveStudyPresenceValue {
  return {
    clientId: 'pwa',
    connected: true,
    isController: false,
    projection: {
      ...emptyLiveStudyProjection(),
      revision: 4,
      surface: 'freestyle',
      route: '/freestyle',
      view: remoteView(),
      updatedAt: '2026-01-01T00:00:00Z',
    },
    publish: vi.fn(),
    ...overrides,
  }
}

function Harness({
  queueCardIds,
  currentCardId,
  revealMap,
  visualIndex,
  viewingCompleteSlot = false,
  planVersion = 1,
  rating = null,
  roundId = 'round-1',
  route = '/freestyle',
  isActive = true,
  applyViewport,
  applyRevealMap,
  applyRating = NOOP,
}: {
  queueCardIds: string[]
  currentCardId: string | null
  revealMap: Record<string, string> | null
  visualIndex?: number
  viewingCompleteSlot?: boolean
  planVersion?: number
  rating?: FreestyleLiveView['rating']
  roundId?: string
  route?: string
  isActive?: boolean
  applyViewport: (viewport: { currentCardId: string | null; visualIndex: number; viewingCompleteSlot: boolean; roundId: string; planVersion: number }) => boolean
  applyRevealMap: (revealMap: Record<string, string> | null) => void
  applyRating?: (rating: NonNullable<FreestyleLiveView['rating']>) => void
}) {
  useFreestyleLiveMirror({
    route,
    palaceId: 7,
    currentCardId,
    currentIndex: 0,
    visualIndex: visualIndex ?? 1,
    viewingCompleteSlot,
    roundId,
    planVersion,
    queueCardIds,
    roundComplete: false,
    questionId: null,
    questionState: undefined,
    revealMap,
    rating,
    applyViewport,
    applyQuestionState: NOOP,
    applyRevealMap,
    applyRating,
    isActive,
  })
  return null
}

describe('useFreestyleLiveMirror follow retry', () => {
  it('applies remote viewport and reveal updates while this client is controller', () => {
    const applyViewport = vi.fn(() => true)
    const applyRevealMap = vi.fn()
    const presence = presenceValue({ isController: true })
    render(
      <LiveStudyPresenceContext.Provider value={presence}>
        <Harness
          queueCardIds={QUEUE_CARD_IDS}
          currentCardId="card-1"
          revealMap={{ root: 'revealed' }}
          applyViewport={applyViewport}
          applyRevealMap={applyRevealMap}
        />
      </LiveStudyPresenceContext.Provider>,
    )
    expect(applyViewport).toHaveBeenCalledWith({
      currentCardId: 'card-2',
      visualIndex: 1,
      viewingCompleteSlot: false,
      roundId: 'round-1',
      planVersion: 1,
    })
    expect(applyRevealMap).toHaveBeenCalledWith(RICH_REVEAL)
    expect(presence.publish).not.toHaveBeenCalled()
  })

  it.each([
    { label: 'inactive', isActive: false, route: '/freestyle' },
    { label: 'a different route', isActive: true, route: '/freestyle?palace=other' },
  ])('does not apply remote updates when $label', ({ isActive, route }) => {
    const applyViewport = vi.fn(() => true)
    const applyRevealMap = vi.fn()
    const applyRating = vi.fn()
    const presence = presenceValue()
    render(
      <LiveStudyPresenceContext.Provider value={presence}>
        <Harness
          queueCardIds={QUEUE_CARD_IDS}
          currentCardId="card-1"
          revealMap={null}
          route={route}
          isActive={isActive}
          applyViewport={applyViewport}
          applyRevealMap={applyRevealMap}
          applyRating={applyRating}
        />
      </LiveStudyPresenceContext.Provider>,
    )
    expect(applyViewport).not.toHaveBeenCalled()
    expect(applyRevealMap).not.toHaveBeenCalled()
    expect(applyRating).not.toHaveBeenCalled()
  })

  it('retries the same remote revision after the local plan becomes ready', () => {
    let ready = false
    const applyViewport = vi.fn(() => ready)
    const applyRevealMap = vi.fn()
    const presence = presenceValue({
      projection: {
        ...presenceValue().projection,
        view: remoteView({ planVersion: 2 }),
      },
    })
    const tree = (planVersion: number) => (
      <LiveStudyPresenceContext.Provider value={presence}>
        <Harness
          queueCardIds={QUEUE_CARD_IDS}
          currentCardId="card-2"
          revealMap={RICH_REVEAL}
          planVersion={planVersion}
          applyViewport={applyViewport}
          applyRevealMap={applyRevealMap}
        />
      </LiveStudyPresenceContext.Provider>
    )
    const { rerender } = render(tree(1))
    expect(applyViewport).toHaveBeenCalledTimes(1)
    expect(applyRevealMap).not.toHaveBeenCalled()
    ready = true
    rerender(tree(2))
    expect(applyViewport).toHaveBeenCalledTimes(2)
    expect(applyViewport).toHaveBeenLastCalledWith({
      currentCardId: 'card-2',
      visualIndex: 1,
      viewingCompleteSlot: false,
      roundId: 'round-1',
      planVersion: 2,
    })
    expect(applyRevealMap).toHaveBeenCalledWith(RICH_REVEAL)
    expect(presence.publish).not.toHaveBeenCalled()
    rerender(tree(2))
    expect(applyViewport).toHaveBeenCalledTimes(2)
  })

  it('applies a same-round settlement once while the completion viewport is waiting', () => {
    const remoteRating: NonNullable<FreestyleLiveView['rating']> = {
      planVersion: 2,
      currentCardId: 'card-2',
      selectedRating: 3,
      passed: true,
      settled: [
        { cardId: 'card-2', rating: 3, passed: true, restudy: false, retryAfterCards: 0 },
      ],
    }
    let ready = false
    const applyViewport = vi.fn(() => ready)
    const applyRating = vi.fn()
    const applyRevealMap = vi.fn()
    const presence = presenceValue({
      isController: true,
      projection: {
        ...presenceValue().projection,
        view: remoteView({
          visualIndex: 2,
          viewingCompleteSlot: true,
          roundComplete: true,
          planVersion: 2,
          rating: remoteRating,
        }),
      },
    })
    const tree = (planVersion: number) => (
      <LiveStudyPresenceContext.Provider value={presence}>
        <Harness
          queueCardIds={QUEUE_CARD_IDS}
          currentCardId="card-2"
          revealMap={RICH_REVEAL}
          planVersion={planVersion}
          applyViewport={applyViewport}
          applyRevealMap={applyRevealMap}
          applyRating={applyRating}
        />
      </LiveStudyPresenceContext.Provider>
    )
    const { rerender } = render(tree(1))
    expect(applyViewport).toHaveBeenCalledTimes(1)
    expect(applyRating).toHaveBeenCalledExactlyOnceWith(remoteRating)
    expect(applyRevealMap).not.toHaveBeenCalled()
    expect(presence.publish).not.toHaveBeenCalled()
    rerender(tree(2))
    expect(applyViewport).toHaveBeenCalledTimes(2)
    expect(applyRating).toHaveBeenCalledTimes(1)
    expect(presence.publish).not.toHaveBeenCalled()
    ready = true
    rerender(tree(3))
    expect(applyViewport).toHaveBeenCalledTimes(3)
    expect(applyViewport).toHaveBeenLastCalledWith({
      currentCardId: 'card-2',
      visualIndex: 2,
      viewingCompleteSlot: true,
      roundId: 'round-1',
      planVersion: 2,
    })
    expect(applyRating).toHaveBeenCalledTimes(1)
    expect(applyRevealMap).toHaveBeenCalledWith(RICH_REVEAL)
    expect(presence.publish).not.toHaveBeenCalled()
  })

  it('waits for round hydration before applying a different-round settlement once', () => {
    const remoteRating: NonNullable<FreestyleLiveView['rating']> = {
      planVersion: 2,
      currentCardId: 'card-2',
      selectedRating: 4,
      passed: true,
      settled: [
        { cardId: 'card-2', rating: 4, passed: true, restudy: false, retryAfterCards: 0 },
      ],
    }
    let ready = false
    const applyViewport = vi.fn(() => ready)
    const applyRating = vi.fn()
    const applyRevealMap = vi.fn()
    const presence = presenceValue({
      isController: true,
      projection: {
        ...presenceValue().projection,
        view: remoteView({
          roundId: 'round-2',
          visualIndex: 2,
          viewingCompleteSlot: true,
          roundComplete: true,
          planVersion: 2,
          rating: remoteRating,
        }),
      },
    })
    const tree = (roundId: string, planVersion: number) => (
      <LiveStudyPresenceContext.Provider value={presence}>
        <Harness
          queueCardIds={QUEUE_CARD_IDS}
          currentCardId="card-2"
          revealMap={RICH_REVEAL}
          roundId={roundId}
          planVersion={planVersion}
          applyViewport={applyViewport}
          applyRevealMap={applyRevealMap}
          applyRating={applyRating}
        />
      </LiveStudyPresenceContext.Provider>
    )
    const { rerender } = render(tree('round-1', 1))
    expect(applyViewport).toHaveBeenCalledTimes(1)
    expect(applyRating).not.toHaveBeenCalled()
    expect(applyRevealMap).not.toHaveBeenCalled()
    expect(presence.publish).not.toHaveBeenCalled()
    rerender(tree('round-2', 2))
    expect(applyViewport).toHaveBeenCalledTimes(2)
    expect(applyRating).toHaveBeenCalledExactlyOnceWith(remoteRating)
    expect(applyRevealMap).not.toHaveBeenCalled()
    expect(presence.publish).not.toHaveBeenCalled()
    ready = true
    rerender(tree('round-2', 3))
    expect(applyViewport).toHaveBeenCalledTimes(3)
    expect(applyRating).toHaveBeenCalledTimes(1)
    expect(applyRevealMap).toHaveBeenCalledWith(RICH_REVEAL)
    expect(presence.publish).not.toHaveBeenCalled()
  })

  it('does not publish a stale same-card viewport while remote apply is rejected', () => {
    const applyViewport = vi.fn(() => false)
    const applyRevealMap = vi.fn()
    const presence = presenceValue({
      isController: true,
      projection: {
        ...presenceValue().projection,
        view: remoteView({ visualIndex: 2, viewingCompleteSlot: true }),
      },
    })
    render(
      <LiveStudyPresenceContext.Provider value={presence}>
        <Harness
          queueCardIds={QUEUE_CARD_IDS}
          currentCardId="card-2"
          revealMap={RICH_REVEAL}
          applyViewport={applyViewport}
          applyRevealMap={applyRevealMap}
        />
      </LiveStudyPresenceContext.Provider>,
    )
    expect(applyViewport).toHaveBeenCalledTimes(1)
    expect(applyRevealMap).not.toHaveBeenCalled()
    expect(presence.publish).not.toHaveBeenCalled()
  })

  it.each([
    { label: 'entering', initialIndex: 1, initialSlot: false, nextIndex: 2, nextSlot: true },
    { label: 'leaving', initialIndex: 2, initialSlot: true, nextIndex: 1, nextSlot: false },
  ])('applies remote $label of the completion slot without changing the card', ({ initialIndex, initialSlot, nextIndex, nextSlot }) => {
    const applyViewport = vi.fn(() => true)
    const applyRevealMap = vi.fn()
    const presence = presenceValue({
      projection: {
        ...presenceValue().projection,
        view: remoteView({ visualIndex: initialIndex, viewingCompleteSlot: initialSlot }),
      },
    })
    const nextPresence = {
      ...presence,
      projection: {
        ...presence.projection,
        revision: presence.projection.revision + 1,
        view: remoteView({ visualIndex: nextIndex, viewingCompleteSlot: nextSlot }),
      },
    }
    const tree = (value: LiveStudyPresenceValue, visualIndex: number, viewingCompleteSlot: boolean) => (
      <LiveStudyPresenceContext.Provider value={value}>
        <Harness
          queueCardIds={QUEUE_CARD_IDS}
          currentCardId="card-2"
          revealMap={RICH_REVEAL}
          visualIndex={visualIndex}
          viewingCompleteSlot={viewingCompleteSlot}
          applyViewport={applyViewport}
          applyRevealMap={applyRevealMap}
        />
      </LiveStudyPresenceContext.Provider>
    )
    const { rerender } = render(tree(presence, initialIndex, initialSlot))
    rerender(tree(nextPresence, initialIndex, initialSlot))
    expect(applyViewport).toHaveBeenCalledTimes(2)
    expect(applyViewport).toHaveBeenLastCalledWith({
      currentCardId: 'card-2',
      visualIndex: nextIndex,
      viewingCompleteSlot: nextSlot,
      roundId: 'round-1',
      planVersion: 1,
    })
    expect(presence.publish).not.toHaveBeenCalled()
    rerender(tree(nextPresence, nextIndex, nextSlot))
    expect(presence.publish).not.toHaveBeenCalled()
  })

  it.each([
    { label: 'entering', initialIndex: 1, initialSlot: false, nextIndex: 2, nextSlot: true },
    { label: 'leaving', initialIndex: 2, initialSlot: true, nextIndex: 1, nextSlot: false },
  ])('publishes local $label of the completion slot on the same card', ({ initialIndex, initialSlot, nextIndex, nextSlot }) => {
    const applyViewport = vi.fn(() => true)
    const applyRevealMap = vi.fn()
    const presence = presenceValue({
      projection: {
        ...presenceValue().projection,
        view: remoteView({ visualIndex: initialIndex, viewingCompleteSlot: initialSlot }),
      },
    })
    const tree = (visualIndex: number, viewingCompleteSlot: boolean) => (
      <LiveStudyPresenceContext.Provider value={presence}>
        <Harness
          queueCardIds={QUEUE_CARD_IDS}
          currentCardId="card-2"
          revealMap={RICH_REVEAL}
          visualIndex={visualIndex}
          viewingCompleteSlot={viewingCompleteSlot}
          applyViewport={applyViewport}
          applyRevealMap={applyRevealMap}
        />
      </LiveStudyPresenceContext.Provider>
    )
    const { rerender } = render(tree(initialIndex, initialSlot))
    expect(presence.publish).not.toHaveBeenCalled()
    rerender(tree(nextIndex, nextSlot))
    expect(presence.publish).toHaveBeenCalledTimes(1)
    expect(presence.publish).toHaveBeenLastCalledWith(expect.objectContaining({
      takeControl: false,
      surface: 'freestyle',
      route: '/freestyle',
      view: expect.objectContaining({
        currentCardId: 'card-2',
        visualIndex: nextIndex,
        viewingCompleteSlot: nextSlot,
        roundId: 'round-1',
        planVersion: 1,
      }),
    }))
  })

  it('seeks the remote card after the queue loads instead of staying on card 0', () => {
    const applyViewport = vi.fn(() => true)
    const applyRevealMap = vi.fn()
    const presence = presenceValue()
    const { rerender } = render(
      <LiveStudyPresenceContext.Provider value={presence}>
        <Harness
          queueCardIds={[]}
          currentCardId={null}
          revealMap={{ root: 'revealed' }}
          applyViewport={applyViewport}
          applyRevealMap={applyRevealMap}
        />
      </LiveStudyPresenceContext.Provider>,
    )
    expect(applyViewport).not.toHaveBeenCalled()
    rerender(
      <LiveStudyPresenceContext.Provider value={presence}>
        <Harness
          queueCardIds={['card-1', 'card-2']}
          currentCardId="card-1"
          revealMap={{ root: 'revealed' }}
          applyViewport={applyViewport}
          applyRevealMap={applyRevealMap}
        />
      </LiveStudyPresenceContext.Provider>,
    )
    expect(applyViewport).toHaveBeenCalledWith({
      currentCardId: 'card-2',
      visualIndex: 1,
      viewingCompleteSlot: false,
      roundId: 'round-1',
      planVersion: 1,
    })
    expect(presence.publish).not.toHaveBeenCalled()
  })

  it('does not publish a default reveal over a richer remote map', () => {
    const presence = presenceValue()
    render(
      <LiveStudyPresenceContext.Provider value={presence}>
        <Harness
          queueCardIds={['card-1', 'card-2']}
          currentCardId="card-1"
          revealMap={{ root: 'revealed' }}
          applyViewport={vi.fn(() => true)}
          applyRevealMap={vi.fn()}
        />
      </LiveStudyPresenceContext.Provider>,
    )
    expect(presence.publish).not.toHaveBeenCalled()
  })

  it('publishes a real local flip after the applied remote view has been caught up', () => {
    const presence = presenceValue()
    const { rerender } = render(
      <LiveStudyPresenceContext.Provider value={presence}>
        <Harness
          queueCardIds={['card-1', 'card-2']}
          currentCardId="card-2"
          revealMap={RICH_REVEAL}
          applyViewport={vi.fn(() => true)}
          applyRevealMap={vi.fn()}
        />
      </LiveStudyPresenceContext.Provider>,
    )
    expect(presence.publish).not.toHaveBeenCalled()
    rerender(
      <LiveStudyPresenceContext.Provider value={presence}>
        <Harness
          queueCardIds={['card-1', 'card-2']}
          currentCardId="card-2"
          revealMap={{ ...RICH_REVEAL, extra: 'revealed' }}
          applyViewport={vi.fn(() => true)}
          applyRevealMap={vi.fn()}
        />
      </LiveStudyPresenceContext.Provider>,
    )
    expect(presence.publish).toHaveBeenCalled()
    const published = (presence.publish as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as {
      view: { revealMap: Record<string, string> }
    }
    expect(published.view.revealMap.extra).toBe('revealed')
  })

  it('applies a remote palace rating without publishing a default unrated view', () => {
    const applyRating = vi.fn()
    const remoteRating = {
      planVersion: 5,
      currentCardId: 'card-2',
      selectedRating: 3,
      passed: true,
      settled: [
        { cardId: 'card-2', rating: 3, passed: true, restudy: false, retryAfterCards: 0 },
        { cardId: 'card-1', rating: 3, passed: true, restudy: false, retryAfterCards: 0 },
      ],
    }
    const presence = presenceValue({
      projection: {
        ...emptyLiveStudyProjection(),
        revision: 8,
        surface: 'freestyle',
        route: '/freestyle',
        view: remoteView({ currentCardId: 'card-2', rating: remoteRating }),
        updatedAt: '2026-01-01T00:00:00Z',
      },
    })
    render(
      <LiveStudyPresenceContext.Provider value={presence}>
        <Harness
          queueCardIds={['card-1', 'card-2']}
          currentCardId="card-2"
          revealMap={RICH_REVEAL}
          applyViewport={vi.fn(() => true)}
          applyRevealMap={vi.fn()}
          applyRating={applyRating}
        />
      </LiveStudyPresenceContext.Provider>,
    )
    expect(applyRating).toHaveBeenCalledWith(remoteRating)
    expect(presence.publish).not.toHaveBeenCalled()
  })
})
