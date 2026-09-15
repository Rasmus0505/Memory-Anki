import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FREESTYLE_FEED_CONFIG, FREESTYLE_FEED_CONFIG_STORAGE_KEY } from '../domain/feedConfig'
import { FREESTYLE_WORKSPACE_PRIMARY, FREESTYLE_WORKSPACE_SECONDARY } from '../domain/freestyleWorkspace'
import { DEFAULT_QUEUE_STATE, FREESTYLE_QUEUE_STATE_STORAGE_KEY } from '../domain/queueState'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'
import {
  FREESTYLE_PEER_ROUND_EVENT,
  FREESTYLE_SECONDARY_FEED_CONFIG_STORAGE_KEY,
  FREESTYLE_SECONDARY_QUEUE_STATE_STORAGE_KEY,
  emitFreestylePeerRound,
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

  it('compacts the secondary queue key when that workspace exceeds quota', () => {
    window.localStorage.setItem(FREESTYLE_QUEUE_STATE_STORAGE_KEY, JSON.stringify({
      ...DEFAULT_QUEUE_STATE,
      currentCardId: 'primary-card',
    }))
    const originalSetItem = Storage.prototype.setItem
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
      .mockImplementationOnce(() => { throw quotaError() })
      .mockImplementation((key, value) => originalSetItem.call(window.localStorage, key, value))

    const saved = saveQueueState({
      ...DEFAULT_QUEUE_STATE,
      currentCardId: 'secondary-card',
      roundPlan: compactablePlan,
    }, FREESTYLE_WORKSPACE_SECONDARY)

    expect(saved.roundPlan).toBeNull()
    expect(JSON.parse(window.localStorage.getItem(FREESTYLE_SECONDARY_QUEUE_STATE_STORAGE_KEY) || '{}')).toEqual(
      expect.objectContaining({ currentCardId: 'secondary-card', roundPlan: null }),
    )
    expect(JSON.parse(window.localStorage.getItem(FREESTYLE_QUEUE_STATE_STORAGE_KEY) || '{}').currentCardId).toBe('primary-card')
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

  it('keeps primary and secondary feed configs from clobbering each other', () => {
    saveFreestyleFeedConfig({
      ...DEFAULT_FREESTYLE_FEED_CONFIG,
      seed: 11,
      queue_length: 11,
    })
    saveFreestyleFeedConfig({
      ...DEFAULT_FREESTYLE_FEED_CONFIG,
      seed: 22,
      queue_length: 22,
    }, FREESTYLE_WORKSPACE_SECONDARY)

    expect(readFreestyleFeedConfig().seed).toBe(11)
    expect(readFreestyleFeedConfig().queue_length).toBe(11)
    expect(readFreestyleFeedConfig(FREESTYLE_WORKSPACE_PRIMARY).seed).toBe(11)
    expect(readFreestyleFeedConfig(FREESTYLE_WORKSPACE_SECONDARY).seed).toBe(22)
    expect(readFreestyleFeedConfig(FREESTYLE_WORKSPACE_SECONDARY).queue_length).toBe(22)
  })

  it('reads unsynced localStorage drafts from matching workspace keys', () => {
    window.localStorage.setItem(FREESTYLE_FEED_CONFIG_STORAGE_KEY, JSON.stringify({
      ...DEFAULT_FREESTYLE_FEED_CONFIG,
      seed: 31,
    }))
    window.localStorage.setItem(FREESTYLE_SECONDARY_FEED_CONFIG_STORAGE_KEY, JSON.stringify({
      ...DEFAULT_FREESTYLE_FEED_CONFIG,
      seed: 32,
    }))

    expect(readFreestyleFeedConfig().seed).toBe(31)
    expect(readFreestyleFeedConfig(FREESTYLE_WORKSPACE_SECONDARY).seed).toBe(32)
  })

  it('keeps primary and secondary queue drafts on separate storage keys', () => {
    saveQueueState({
      ...DEFAULT_QUEUE_STATE,
      currentCardId: 'primary-card',
      completedIds: ['p-done'],
    })
    saveQueueState({
      ...DEFAULT_QUEUE_STATE,
      currentCardId: 'secondary-card',
      completedIds: ['s-done'],
    }, FREESTYLE_WORKSPACE_SECONDARY)

    expect(readQueueState().currentCardId).toBe('primary-card')
    expect(readQueueState().completedIds).toEqual(['p-done'])
    expect(readQueueState(FREESTYLE_WORKSPACE_PRIMARY).currentCardId).toBe('primary-card')
    expect(readQueueState(FREESTYLE_WORKSPACE_SECONDARY).currentCardId).toBe('secondary-card')
    expect(readQueueState(FREESTYLE_WORKSPACE_SECONDARY).completedIds).toEqual(['s-done'])
    expect(JSON.parse(window.localStorage.getItem(FREESTYLE_QUEUE_STATE_STORAGE_KEY) || '{}').currentCardId).toBe('primary-card')
    expect(JSON.parse(window.localStorage.getItem(FREESTYLE_SECONDARY_QUEUE_STATE_STORAGE_KEY) || '{}').currentCardId).toBe('secondary-card')
  })

  it('emits a peer-round event for the workspace that just mutated', () => {
    const events: unknown[] = []
    const listener = (event: Event) => {
      events.push(event instanceof CustomEvent ? event.detail : null)
    }
    window.addEventListener(FREESTYLE_PEER_ROUND_EVENT, listener)
    emitFreestylePeerRound(FREESTYLE_WORKSPACE_SECONDARY)
    window.removeEventListener(FREESTYLE_PEER_ROUND_EVENT, listener)

    expect(events).toEqual([{ workspace: FREESTYLE_WORKSPACE_SECONDARY }])
  })
})
