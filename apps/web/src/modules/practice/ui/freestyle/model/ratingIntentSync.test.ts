import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  list: vi.fn(),
  put: vi.fn(),
  clear: vi.fn(),
  rate: vi.fn(),
}))

vi.mock('@/modules/practice/ui/freestyle/api', () => ({
  listFreestyleRatingIntentsApi: api.list,
  putFreestyleRatingIntentApi: api.put,
  clearFreestyleRatingIntentApi: api.clear,
  rateFreestyleRoundUnitApi: api.rate,
}))

vi.mock('@/modules/practice/public', () => ({
  closeUnitReviewEncounterApi: vi.fn(),
  rateReviewUnitApi: vi.fn(),
  undoReviewUnitRatingApi: vi.fn(),
}))

import {
  freestyleRatingSaves,
  resetFreestyleRatingSavesForTests,
  syncRatingIntents,
} from './ratingSaveRuntime'

const KEY = 'memory-anki:freestyle-rating-intents:v1'

function localMap(map: Record<string, unknown>) {
  localStorage.setItem(KEY, JSON.stringify(map))
}

beforeEach(() => {
  localStorage.clear()
  resetFreestyleRatingSavesForTests()
  vi.clearAllMocks()
})

describe('syncRatingIntents', () => {
  it('shows the server intents and uploads a failure this browser never delivered', async () => {
    localMap({
      'round-1': {
        'card-b': {
          card_id: 'card-b',
          operation_id: 'op-b',
          rating: 2,
          failure: 'network',
          payload: { encounter_id: 'enc-b', study_session_id: 's-b', unit_id: 'unit-b', unit_revision: 1 },
          confirmed: false,
        },
      },
    })
    api.list.mockResolvedValue({
      items: [{
        card_id: 'card-a',
        operation_id: 'op-a',
        rating: 4,
        failure: 'timeout',
        payload: { encounter_id: 'enc-a', study_session_id: 's-a', unit_id: 'unit-a', unit_revision: 2 },
        updated_at: null,
      }],
    })
    api.put.mockResolvedValue({ item: {} })

    await syncRatingIntents('round-1', () => null)

    expect(api.put).toHaveBeenCalledWith('round-1', 'card-b', expect.objectContaining({ operation_id: 'op-b', rating: 2 }))
    const store = freestyleRatingSaves()
    expect(store.getEntry('round-1', 'card-a')).toMatchObject({ status: 'failed', rating: 4, operationId: 'op-a' })
    expect(store.getEntry('round-1', 'card-b')).toMatchObject({ status: 'failed', rating: 2, operationId: 'op-b' })
    expect(store.failedCount('round-1')).toBe(2)
  })

  it('forgets a local failure the server no longer lists because it was saved or cleared elsewhere', async () => {
    localMap({
      'round-1': {
        'card-c': {
          card_id: 'card-c',
          operation_id: 'op-c',
          rating: 3,
          failure: 'network',
          payload: {},
          confirmed: true,
        },
      },
    })
    api.list.mockResolvedValue({ items: [] })

    await syncRatingIntents('round-1', () => null)

    expect(api.put).not.toHaveBeenCalled()
    expect(freestyleRatingSaves().getEntry('round-1', 'card-c')).toBeNull()
    expect(localStorage.getItem(KEY)).toBe('{}')
  })

  it('falls back to the local mirror when the server cannot be reached', async () => {
    localMap({
      'round-1': {
        'card-d': {
          card_id: 'card-d',
          operation_id: 'op-d',
          rating: 1,
          failure: 'network',
          payload: {},
          confirmed: false,
        },
      },
    })
    api.list.mockRejectedValue(new Error('offline'))

    await syncRatingIntents('round-1', () => null)

    expect(freestyleRatingSaves().getEntry('round-1', 'card-d')).toMatchObject({ status: 'failed', operationId: 'op-d' })
    expect(api.put).not.toHaveBeenCalled()
  })
})
