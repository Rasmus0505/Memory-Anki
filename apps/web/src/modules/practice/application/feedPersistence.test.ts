import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FREESTYLE_FEED_CONFIG } from '../domain/feedConfig'
import { FREESTYLE_WORKSPACE_PRIMARY, type FreestyleWorkspaceId } from '../domain/freestyleWorkspace'
import { DEFAULT_QUEUE_STATE, FREESTYLE_QUEUE_STATE_STORAGE_KEY } from '../domain/queueState'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'
import {
  isQueueStateFromPreviousDay,
  readFreestyleFeedConfig,
  readQueueState,
  saveFreestyleFeedConfig,
  saveQueueState,
} from './feedPersistence'

vi.mock('@/modules/settings/public', () => ({
  getClientPreferencesApi: vi.fn(),
  updateClientPreferencesApi: vi.fn(async (data: Record<string, unknown>) => ({
    items: data,
  })),
}))

function quotaError() {
  const error = new Error('quota exceeded')
  Object.defineProperty(error, 'name', { value: 'QuotaExceededError' })
  return error
}

const compactablePlan = {
  roundId: 'round-1',
  configSignature: '{}',
  createdAt: 1,
  candidateCount: 1,
  scheduledCount: 1,
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

describe('saveQueueState', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('drops the rebuildable round plan when localStorage quota is exceeded', () => {
    const originalSetItem = Storage.prototype.setItem
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
      .mockImplementationOnce(() => { throw quotaError() })
      .mockImplementation((key, value) => originalSetItem.call(window.localStorage, key, value))

    const saved = saveQueueState({
      ...DEFAULT_QUEUE_STATE,
      roundPlan: compactablePlan,
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

describe('per-workspace feed config and queue drafts', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetClientPreferenceCacheForTest()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetClientPreferenceCacheForTest()
  })

  it('does not write the global freestyle selection for a palace review', () => {
    saveFreestyleFeedConfig({
      ...DEFAULT_FREESTYLE_FEED_CONFIG,
      seed: 11,
    })
    const saved = saveFreestyleFeedConfig({
      ...DEFAULT_FREESTYLE_FEED_CONFIG,
      seed: 99,
    }, 'p23')

    expect(saved.seed).toBe(99)
    expect(readFreestyleFeedConfig().seed).toBe(11)
    expect(readFreestyleFeedConfig()).not.toHaveProperty('queue_length')
    expect(readFreestyleFeedConfig('p23').seed).toBe(11)
  })

  it('keeps a palace review queue draft off the primary key', () => {
    saveQueueState({
      ...DEFAULT_QUEUE_STATE,
      currentCardId: 'primary-card',
    })
    saveQueueState({
      ...DEFAULT_QUEUE_STATE,
      currentCardId: 'palace-card',
    }, 'p23')

    expect(readQueueState().currentCardId).toBe('primary-card')
    expect(readQueueState('p23').currentCardId).toBe('palace-card')
    expect(JSON.parse(window.localStorage.getItem(FREESTYLE_QUEUE_STATE_STORAGE_KEY) || '{}').currentCardId).toBe('primary-card')
  })

  it('folds a stale secondary workspace id into the single 随心 storage slot', () => {
    saveFreestyleFeedConfig({ ...DEFAULT_FREESTYLE_FEED_CONFIG, seed: 41 }, 'secondary' as unknown as FreestyleWorkspaceId)

    expect(readFreestyleFeedConfig(FREESTYLE_WORKSPACE_PRIMARY).seed).toBe(41)
  })

})
