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

function remoteView(overrides: Partial<FreestyleLiveView> = {}): FreestyleLiveView {
  return {
    palaceId: 7,
    currentCardId: 'card-2',
    currentIndex: 1,
    queueCardIds: ['card-1', 'card-2'],
    flip: null,
    questionState: null,
    revealMap: RICH_REVEAL,
    roundComplete: false,
    rating: null,
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
  rating = null,
  seekCardId,
  applyRevealMap,
  applyRating = vi.fn(),
}: {
  queueCardIds: string[]
  currentCardId: string | null
  revealMap: Record<string, string> | null
  rating?: FreestyleLiveView['rating']
  seekCardId: (cardId: string) => void
  applyRevealMap: (revealMap: Record<string, string> | null) => void
  applyRating?: (rating: NonNullable<FreestyleLiveView['rating']>) => void
}) {
  useFreestyleLiveMirror({
    route: '/freestyle',
    palaceId: 7,
    currentCardId,
    currentIndex: 0,
    queueCardIds,
    roundComplete: false,
    questionId: null,
    questionState: undefined,
    ankiFlip: null,
    revealMap,
    rating,
    seekCardId,
    applyQuestionState: vi.fn(),
    applyAnkiFlip: vi.fn(),
    applyRevealMap,
    applyRating,
    isActive: true,
  })
  return null
}

describe('useFreestyleLiveMirror follow retry', () => {
  it('seeks the remote card after the queue loads instead of staying on card 0', () => {
    const seekCardId = vi.fn()
    const applyRevealMap = vi.fn()
    const presence = presenceValue()
    const { rerender } = render(
      <LiveStudyPresenceContext.Provider value={presence}>
        <Harness
          queueCardIds={[]}
          currentCardId={null}
          revealMap={{ root: 'revealed' }}
          seekCardId={seekCardId}
          applyRevealMap={applyRevealMap}
        />
      </LiveStudyPresenceContext.Provider>,
    )
    expect(seekCardId).not.toHaveBeenCalled()
    rerender(
      <LiveStudyPresenceContext.Provider value={presence}>
        <Harness
          queueCardIds={['card-1', 'card-2']}
          currentCardId="card-1"
          revealMap={{ root: 'revealed' }}
          seekCardId={seekCardId}
          applyRevealMap={applyRevealMap}
        />
      </LiveStudyPresenceContext.Provider>,
    )
    expect(seekCardId).toHaveBeenCalledWith('card-2')
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
          seekCardId={vi.fn()}
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
          seekCardId={vi.fn()}
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
          seekCardId={vi.fn()}
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
          seekCardId={vi.fn()}
          applyRevealMap={vi.fn()}
          applyRating={applyRating}
        />
      </LiveStudyPresenceContext.Provider>,
    )
    expect(applyRating).toHaveBeenCalledWith(remoteRating)
    expect(presence.publish).not.toHaveBeenCalled()
  })
})
