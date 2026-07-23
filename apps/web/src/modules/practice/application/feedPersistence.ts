import {
  DEFAULT_FREESTYLE_FEED_CONFIG,
  FREESTYLE_FEED_CONFIG_STORAGE_KEY,
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
  return feedConfigStore.read()
}

export function saveFreestyleFeedConfig(config: FreestyleFeedConfig) {
  return feedConfigStore.write(config)
}

export function resetFreestyleFeedConfig() {
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

export function saveQueueState(state: FreestyleSkipState) {
  const sanitized = sanitizeQueueState(state)
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(FREESTYLE_QUEUE_STATE_STORAGE_KEY, JSON.stringify(sanitized))
  }
  return sanitized
}

export function createOperationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return createDeterministicOperationId()
}
