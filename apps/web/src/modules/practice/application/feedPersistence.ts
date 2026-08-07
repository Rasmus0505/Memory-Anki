import {
  DEFAULT_FREESTYLE_FEED_CONFIG,
  FREESTYLE_FEED_CONFIG_STORAGE_KEY,
  LEGACY_FREESTYLE_FEED_CONFIG_STORAGE_KEY,
  createOperationId as createDeterministicOperationId,
  sanitizeFreestyleFeedConfig,
} from '../domain/feedConfig'
import {
  DEFAULT_QUEUE_STATE,
  FREESTYLE_QUEUE_STATE_STORAGE_KEY,
  createQueueRoundState,
  sanitizeQueueState,
  type FreestyleSkipState,
} from '../domain/queueState'
import type { FreestyleFeedConfig } from '@/shared/api/contracts'
import { createPersistentPreferenceStore } from '@/shared/preferences/persistentPreferenceStore'

export const FREESTYLE_FEED_CONFIG_UPDATED_EVENT = 'memory-anki-freestyle-feed-config-change'

const feedConfigStore = createPersistentPreferenceStore<FreestyleFeedConfig>({
  cacheKey: 'freestyle_feed_config',
  defaultValue: DEFAULT_FREESTYLE_FEED_CONFIG,
  localStorageKey: FREESTYLE_FEED_CONFIG_STORAGE_KEY,
  sanitize: sanitizeFreestyleFeedConfig,
  updatedEvent: FREESTYLE_FEED_CONFIG_UPDATED_EVENT,
  isValidCache: (value): value is FreestyleFeedConfig => Boolean(value && typeof value === 'object'),
})

export function readFreestyleFeedConfig(): FreestyleFeedConfig {
  if (typeof window !== 'undefined' && !window.localStorage.getItem(FREESTYLE_FEED_CONFIG_STORAGE_KEY)) {
    const legacy = window.localStorage.getItem(LEGACY_FREESTYLE_FEED_CONFIG_STORAGE_KEY)
    if (legacy) {
      try {
        const migrated = sanitizeFreestyleFeedConfig(JSON.parse(legacy))
        feedConfigStore.write(migrated)
        return migrated
      } catch {
        // The store will fall back to its sanitized default below.
      }
    }
  }
  return feedConfigStore.read()
}

export function saveFreestyleFeedConfig(config: FreestyleFeedConfig) {
  return feedConfigStore.write(config)
}

export function resetFreestyleFeedConfig() {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(LEGACY_FREESTYLE_FEED_CONFIG_STORAGE_KEY)
  }
  return feedConfigStore.reset()
}

export function readQueueState(): FreestyleSkipState {
  if (typeof window === 'undefined') return DEFAULT_QUEUE_STATE
  try {
    const raw = window.localStorage.getItem(FREESTYLE_QUEUE_STATE_STORAGE_KEY)
    if (!raw) return createQueueRoundState()
    const state = sanitizeQueueState(JSON.parse(raw))
    const now = Date.now()
    const started = new Date(state.startedAt)
    const today = new Date(now)
    const sameLocalDay =
      started.getFullYear() === today.getFullYear() &&
      started.getMonth() === today.getMonth() &&
      started.getDate() === today.getDate()
    return sameLocalDay ? state : createQueueRoundState(state.seed, now)
  } catch {
    return createQueueRoundState()
  }
}

function isQuotaExceededError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const value = error as { name?: string; code?: number }
  return value.name === 'QuotaExceededError' || value.code === 22 || value.code === 1014
}

function compactQueueState(state: FreestyleSkipState): FreestyleSkipState {
  // The plan is a rebuildable projection. Dropping it prevents stale-card history
  // from growing the localStorage record indefinitely after repeated queue rebuilds.
  return sanitizeQueueState({
    ...state,
    roundPlan: null,
  })
}

export function saveQueueState(state: FreestyleSkipState) {
  const sanitized = sanitizeQueueState(state)
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(FREESTYLE_QUEUE_STATE_STORAGE_KEY, JSON.stringify(sanitized))
    } catch (error) {
      if (!isQuotaExceededError(error)) throw error

      const compacted = compactQueueState(sanitized)
      try {
        // Remove first because some Chromium versions reject replacement writes
        // while the old value already consumes the origin quota.
        window.localStorage.removeItem(FREESTYLE_QUEUE_STATE_STORAGE_KEY)
        window.localStorage.setItem(FREESTYLE_QUEUE_STATE_STORAGE_KEY, JSON.stringify(compacted))
        return compacted
      } catch (retryError) {
        if (!isQuotaExceededError(retryError)) throw retryError

        const reset = createQueueRoundState(compacted.seed)
        reset.mutedPalaceIds = [...compacted.mutedPalaceIds]
        try {
          window.localStorage.removeItem(FREESTYLE_QUEUE_STATE_STORAGE_KEY)
          window.localStorage.setItem(FREESTYLE_QUEUE_STATE_STORAGE_KEY, JSON.stringify(reset))
        } catch (resetError) {
          if (!isQuotaExceededError(resetError)) throw resetError
        }
        return reset
      }
    }
  }
  return sanitized
}

export function createOperationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return createDeterministicOperationId()
}
