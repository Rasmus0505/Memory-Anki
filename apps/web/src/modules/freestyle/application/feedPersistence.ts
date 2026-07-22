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

export function readFreestyleFeedConfig(): FreestyleFeedConfig {
  if (typeof window === 'undefined') return DEFAULT_FREESTYLE_FEED_CONFIG
  try {
    const raw = window.localStorage.getItem(FREESTYLE_FEED_CONFIG_STORAGE_KEY)
    if (!raw) return DEFAULT_FREESTYLE_FEED_CONFIG
    return sanitizeFreestyleFeedConfig(JSON.parse(raw))
  } catch {
    return DEFAULT_FREESTYLE_FEED_CONFIG
  }
}

export function saveFreestyleFeedConfig(config: FreestyleFeedConfig) {
  const sanitized = sanitizeFreestyleFeedConfig(config)
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(FREESTYLE_FEED_CONFIG_STORAGE_KEY, JSON.stringify(sanitized))
  }
  return sanitized
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
