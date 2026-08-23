import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_QUEUE_STATE, FREESTYLE_QUEUE_STATE_STORAGE_KEY } from '../domain/queueState'
import {
  isQueueStateFromPreviousDay,
  readQueueState,
  saveQueueState,
} from './feedPersistence'

function quotaError() {
  const error = new Error('quota exceeded')
  Object.defineProperty(error, 'name', { value: 'QuotaExceededError' })
  return error
}

describe('saveQueueState', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('drops the rebuildable round plan when localStorage quota is exceeded', () => {
    const plan = {
      roundId: 'round-1',
      configSignature: '{}',
      createdAt: 1,
      candidateCount: 1,
      scheduledCount: 1,
      queueLimit: 1,
      limitReached: false,
      orderIds: ['card-1'],
      cardsById: {
        'card-1': {
          cardId: 'card-1',
          sourceCardId: 'card-1',
          occurrenceKind: 'source' as const,
          retryAttempt: 0,
          palaceId: 1,
          palaceTitle: '宫殿',
          label: '单元',
          kind: 'mindmap_branch',
          status: 'pending' as const,
          lastRating: null,
          retryAfterCards: 0,
          attemptCount: 0,
          updatedAt: 1,
        },
      },
    }
    const originalSetItem = Storage.prototype.setItem
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
      .mockImplementationOnce(() => { throw quotaError() })
      .mockImplementation((key, value) => originalSetItem.call(window.localStorage, key, value))

    const saved = saveQueueState({
      ...DEFAULT_QUEUE_STATE,
      roundPlan: plan,
    })

    expect(saved.roundPlan).toBeNull()
    expect(JSON.parse(window.localStorage.getItem(FREESTYLE_QUEUE_STATE_STORAGE_KEY) || '{}').roundPlan).toBeNull()
    expect(setItem).toHaveBeenCalledTimes(2)
  })

  it('resets the temporary round if the compact write still exceeds quota', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw quotaError() })
    const saved = saveQueueState({
      ...DEFAULT_QUEUE_STATE,
      mutedPalaceIds: [17],
      completedIds: ['card-1'],
    })

    expect(saved.roundPlan).toBeNull()
    expect(saved.completedIds).toEqual(['card-1'])
    expect(saved.mutedPalaceIds).toEqual([17])
    expect(setItem).toHaveBeenCalled()
  })
})

describe('readQueueState', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it('keeps an unfinished round that started yesterday', () => {
    const yesterday = Date.now() - 36 * 60 * 60 * 1000
    window.localStorage.setItem(FREESTYLE_QUEUE_STATE_STORAGE_KEY, JSON.stringify({
      ...DEFAULT_QUEUE_STATE,
      roundId: 'round-yesterday',
      startedAt: yesterday,
      currentCardId: 'still-here',
      completedIds: ['done-1'],
    }))

    const state = readQueueState()
    expect(state.roundId).toBe('round-yesterday')
    expect(state.currentCardId).toBe('still-here')
    expect(state.completedIds).toEqual(['done-1'])
    expect(isQueueStateFromPreviousDay(state)).toBe(true)
  })
})
