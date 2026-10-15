import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FreestyleUnitEncounterState } from '@/modules/practice/public'
import type { FreestyleCard } from '@/shared/api/contracts'
import { resetFreestyleRatingSavesForTests } from '@/modules/practice/ui/freestyle/model/ratingSaveRuntime'
import { useFreestyleRatingOutbox } from './useFreestyleRatingOutbox'

const mocks = vi.hoisted(() => ({
  rateFreestyleRoundUnitApi: vi.fn(),
  loadSessionWithTimeout: vi.fn(),
}))

vi.mock('@/modules/practice/ui/freestyle/api', () => ({
  rateFreestyleRoundUnitApi: mocks.rateFreestyleRoundUnitApi,
}))

vi.mock('@/modules/practice/ui/freestyle/model/freestyleUnitReviewSession', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/modules/practice/ui/freestyle/model/freestyleUnitReviewSession')>(),
  loadSessionWithTimeout: mocks.loadSessionWithTimeout,
}))

function unitCard(id: string): FreestyleCard {
  return {
    id,
    type: 'mindmap_branch',
    content_type: 'mindmap_branch',
    palace_id: 1,
    palace_title: '宫殿',
    unit_id: `${id}-unit`,
    unit_revision: 2,
    anchor_uid: `${id}-anchor`,
    context_path: [],
    node_uids: [],
    node_count: 1,
  } as FreestyleCard
}

function openEncounter(id: string): FreestyleUnitEncounterState {
  return {
    encounterId: `enc-${id}`,
    roundId: 'round-1',
    unitRevision: 2,
    status: 'open',
    sessionId: `session-${id}`,
    selectedRating: null,
    passed: null,
    retryAfterCards: 0,
  }
}

function ack(cardId: string, rating: number, operationId: string) {
  return {
    item: {
      operation_id: operationId,
      study_session_id: `session-${cardId}`,
      encounter_id: `enc-${cardId}`,
      unit: { id: `${cardId}-unit`, revision: 2 },
      passed: rating >= 3,
      retry_after_cards: rating >= 3 ? 0 : 3,
      rating,
      session_status: 'passed',
      encounter: {
        id: `enc-${cardId}`,
        round_id: 'round-1',
        status: 'open',
        selected_rating: rating,
        passed: rating >= 3,
        retry_after_cards: rating >= 3 ? 0 : 3,
        effective_operation_id: operationId,
      },
    },
    round: { round_id: 'round-1', version: 3, plan_version: 3, conflict: false, duplicate: false, plan: { completed_ids: [] } },
  }
}

function setup(viewingCardId = 'a') {
  const cards = [unitCard('a'), unitCard('b'), unitCard('c'), { id: 'quiz-1', type: 'quiz_question' } as FreestyleCard, unitCard('gone')]
  const encounters: Record<string, FreestyleUnitEncounterState> = { a: openEncounter('a'), b: openEncounter('b') }
  const handlers = {
    ensureUnitEncounter: vi.fn((cardId: string) => encounters[cardId] ?? {
      encounterId: `enc-${cardId}`,
      roundId: 'round-1',
      unitRevision: 2,
      status: 'pending' as const,
      sessionId: null,
      selectedRating: null,
      passed: null,
      retryAfterCards: 0,
    }),
    adoptRound: vi.fn(),
    encounterChange: vi.fn(),
    branchComplete: vi.fn(),
    ratingSettled: vi.fn(),
    cardSaveFailed: vi.fn(),
    staleDrop: vi.fn(),
  }
  const view = renderHook(() => useFreestyleRatingOutbox({
    roundId: 'round-1',
    cards,
    encounters,
    excludedIds: new Set(['gone']),
    planVersion: 2,
    viewingCardId,
    ...handlers,
  }))
  return { view, handlers }
}

describe('useFreestyleRatingOutbox', () => {
  beforeEach(() => {
    resetFreestyleRatingSavesForTests()
    mocks.rateFreestyleRoundUnitApi.mockReset()
    mocks.loadSessionWithTimeout.mockReset()
    mocks.rateFreestyleRoundUnitApi.mockImplementation(async (_roundId: string, payload: { card_id: string; rating: number; operation_id: string }) => (
      ack(payload.card_id, payload.rating, payload.operation_id)
    ))
    mocks.loadSessionWithTimeout.mockImplementation(async (card: FreestyleCard) => ({
      id: `session-${card.id}`,
      units: [{ id: `${card.id}-unit`, revision: 2, anchor_uid: '', encounter: { id: `enc-${card.id}` } }],
    }))
  })

  it('multi-select rates each selected card once, through its own per-card save', async () => {
    const { view, handlers } = setup()
    let result: ReturnType<typeof view.result.current.rateCards> | undefined
    act(() => {
      result = view.result.current.rateCards(['a', 'b', 'c', 'quiz-1', 'gone', 'b'], 3)
    })
    expect(result).toEqual({ queued: 3, unchanged: 0, skipped: 2 })
    await waitFor(() => expect(mocks.rateFreestyleRoundUnitApi).toHaveBeenCalledTimes(3))
    const payloads = mocks.rateFreestyleRoundUnitApi.mock.calls.map((call) => call[1])
    expect(payloads.map((payload) => payload.card_id).sort()).toEqual(['a', 'b', 'c'])
    expect(new Set(payloads.map((payload) => payload.operation_id)).size).toBe(3)
    // No batch scoring of siblings: one unit per request.
    expect(payloads.every((payload) => payload.palace_batch == null)).toBe(true)
    // The card without an open glance gets one first, from the card's own session start.
    expect(mocks.loadSessionWithTimeout).toHaveBeenCalledTimes(1)
    expect(mocks.loadSessionWithTimeout.mock.calls[0][0].id).toBe('c')
    expect(handlers.ensureUnitEncounter).toHaveBeenCalledWith('c', 2, true)
    await waitFor(() => expect(handlers.branchComplete).toHaveBeenCalledTimes(3))
    expect(handlers.adoptRound).toHaveBeenCalled()
  })

  it('rates a row in the background without touching the viewport', async () => {
    const { view, handlers } = setup('a')
    act(() => {
      view.result.current.rateCards(['b'], 1, { toggle: true })
    })
    await waitFor(() => expect(handlers.branchComplete).toHaveBeenCalledWith('b', {
      restudy: true, rating: 1, retryAfterCards: 3,
    }))
    expect(handlers.encounterChange).toHaveBeenCalledWith('b', expect.objectContaining({ selectedRating: 1 }))
    // The ledger reaches only the rated card; nothing addresses card a (the one on screen).
    expect(handlers.encounterChange.mock.calls.every((call) => call[0] === 'b')).toBe(true)
  })

  it('counts 未保存 items and retries them with their original operation ids', async () => {
    mocks.rateFreestyleRoundUnitApi.mockRejectedValueOnce(new Error('503'))
    const { view, handlers } = setup()
    act(() => {
      view.result.current.rateCards(['a'], 4)
    })
    await waitFor(() => expect(view.result.current.failedCount).toBe(1))
    expect(handlers.cardSaveFailed).toHaveBeenCalledWith(expect.any(String), 'a')
    act(() => {
      view.result.current.retryUnsaved()
    })
    await waitFor(() => expect(view.result.current.failedCount).toBe(0))
    const ids = mocks.rateFreestyleRoundUnitApi.mock.calls.map((call) => call[1].operation_id)
    expect(ids).toHaveLength(2)
    expect(ids[1]).toBe(ids[0])
  })
})
