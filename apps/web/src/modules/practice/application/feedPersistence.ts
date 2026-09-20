import {
  DEFAULT_FREESTYLE_FEED_CONFIG,
  FREESTYLE_FEED_CONFIG_STORAGE_KEY,
  LEGACY_FREESTYLE_FEED_CONFIG_STORAGE_KEY,
  createOperationId as createDeterministicOperationId,
  sanitizeFreestyleFeedConfig,
} from '../domain/feedConfig'
import {
  FREESTYLE_WORKSPACE_SECONDARY,
  normalizeFreestyleWorkspaceId,
  type FreestyleWorkspaceId,
} from '../domain/freestyleWorkspace'
import {
  DEFAULT_QUEUE_STATE,
  FREESTYLE_QUEUE_STATE_STORAGE_KEY,
  createQueueRoundState,
  sanitizeQueueState,
  type FreestyleSkipState,
} from '../domain/queueState'
import type { FreestyleFeedConfig } from '@/shared/api/contracts'
import { emitAppEvent } from '@/shared/events/appEvents'
import { createPersistentPreferenceStore } from '@/shared/preferences/persistentPreferenceStore'

export const FREESTYLE_FEED_CONFIG_UPDATED_EVENT = 'memory-anki-freestyle-feed-config-change'
export const FREESTYLE_SECONDARY_FEED_CONFIG_UPDATED_EVENT = 'memory-anki-freestyle-feed-config-secondary-change'
export const FREESTYLE_SECONDARY_FEED_CONFIG_STORAGE_KEY = 'memory-anki.freestyle.feed-config.secondary.v2'
export const FREESTYLE_SECONDARY_QUEUE_STATE_STORAGE_KEY = 'memory-anki.freestyle.queue-state.secondary.v1'
export const FREESTYLE_PEER_ROUND_EVENT = 'memory-anki-freestyle-peer-round'

export type FreestylePeerRoundDetail = {
  workspace: FreestyleWorkspaceId
}

const isValidFeedConfigCache = (value: unknown): value is FreestyleFeedConfig =>
  Boolean(value && typeof value === 'object')

const feedConfigStore = createPersistentPreferenceStore<FreestyleFeedConfig>({
  cacheKey: 'freestyle_feed_config',
  defaultValue: DEFAULT_FREESTYLE_FEED_CONFIG,
  localStorageKey: FREESTYLE_FEED_CONFIG_STORAGE_KEY,
  sanitize: sanitizeFreestyleFeedConfig,
  updatedEvent: FREESTYLE_FEED_CONFIG_UPDATED_EVENT,
  isValidCache: isValidFeedConfigCache,
})

const secondaryFeedConfigStore = createPersistentPreferenceStore<FreestyleFeedConfig>({
  cacheKey: 'freestyle_feed_config_secondary',
  defaultValue: DEFAULT_FREESTYLE_FEED_CONFIG,
  localStorageKey: FREESTYLE_SECONDARY_FEED_CONFIG_STORAGE_KEY,
  sanitize: sanitizeFreestyleFeedConfig,
  updatedEvent: FREESTYLE_SECONDARY_FEED_CONFIG_UPDATED_EVENT,
  isValidCache: isValidFeedConfigCache,
})

function isSecondaryWorkspace(workspace?: FreestyleWorkspaceId) {
  return normalizeFreestyleWorkspaceId(workspace) === FREESTYLE_WORKSPACE_SECONDARY
}

function feedConfigStoreFor(workspace?: FreestyleWorkspaceId) {
  return isSecondaryWorkspace(workspace) ? secondaryFeedConfigStore : feedConfigStore
}

function queueStateStorageKey(workspace?: FreestyleWorkspaceId) {
  return isSecondaryWorkspace(workspace)
    ? FREESTYLE_SECONDARY_QUEUE_STATE_STORAGE_KEY
    : FREESTYLE_QUEUE_STATE_STORAGE_KEY
}

export function readFreestyleFeedConfig(workspace?: FreestyleWorkspaceId): FreestyleFeedConfig {
  const store = feedConfigStoreFor(workspace)
  if (!isSecondaryWorkspace(workspace) && typeof window !== 'undefined' && !window.localStorage.getItem(FREESTYLE_FEED_CONFIG_STORAGE_KEY)) {
    const legacy = window.localStorage.getItem(LEGACY_FREESTYLE_FEED_CONFIG_STORAGE_KEY)
    if (legacy) {
      try {
        const migrated = sanitizeFreestyleFeedConfig(JSON.parse(legacy))
        store.write(migrated)
        return migrated
      } catch {
        // The store will fall back to its sanitized default below.
      }
    }
  }
  return store.read()
}

export function saveFreestyleFeedConfig(config: FreestyleFeedConfig, workspace?: FreestyleWorkspaceId) {
  return feedConfigStoreFor(workspace).write(config)
}

export function resetFreestyleFeedConfig(workspace?: FreestyleWorkspaceId) {
  if (!isSecondaryWorkspace(workspace) && typeof window !== 'undefined') {
    window.localStorage.removeItem(LEGACY_FREESTYLE_FEED_CONFIG_STORAGE_KEY)
  }
  return feedConfigStoreFor(workspace).reset()
}

export function emitFreestylePeerRound(workspace: FreestyleWorkspaceId) {
  const detail: FreestylePeerRoundDetail = {
    workspace: normalizeFreestyleWorkspaceId(workspace),
  }
  emitAppEvent(FREESTYLE_PEER_ROUND_EVENT, detail)
}

export function isSameLocalDay(left: number, right = Date.now()) {
  const start = new Date(left)
  const other = new Date(right)
  return (
    start.getFullYear() === other.getFullYear()
    && start.getMonth() === other.getMonth()
    && start.getDate() === other.getDate()
  )
}

export function isQueueStateFromPreviousDay(state: FreestyleSkipState, now = Date.now()) {
  if (!state.startedAt) return false
  return !isSameLocalDay(state.startedAt, now)
}

export function readQueueState(workspace?: FreestyleWorkspaceId): FreestyleSkipState {
  if (typeof window === 'undefined') return DEFAULT_QUEUE_STATE
  try {
    const raw = window.localStorage.getItem(queueStateStorageKey(workspace))
    if (!raw) return createQueueRoundState()
    // Unfinished and fully handled rounds survive midnight/refresh. A new
    // round_id is minted only after explicit config confirm (再来一轮).
    return sanitizeQueueState(JSON.parse(raw))
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

function persistQueueState(storageKey: string, state: FreestyleSkipState): FreestyleSkipState {
  const sanitized = sanitizeQueueState(state)
  if (typeof window === 'undefined') return sanitized
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(sanitized))
    return sanitized
  } catch (error) {
    if (!isQuotaExceededError(error)) throw error

    const compacted = compactQueueState(sanitized)
    try {
      // Remove first because some Chromium versions reject replacement writes
      // while the old value already consumes the origin quota.
      window.localStorage.removeItem(storageKey)
      window.localStorage.setItem(storageKey, JSON.stringify(compacted))
      return compacted
    } catch (retryError) {
      if (!isQuotaExceededError(retryError)) throw retryError

      const reset = createQueueRoundState(compacted.seed)
      reset.mutedPalaceIds = [...compacted.mutedPalaceIds]
      reset.currentCardId = compacted.currentCardId
      reset.completedIds = [...compacted.completedIds]
      reset.unitEncountersByCardId = { ...compacted.unitEncountersByCardId }
      try {
        window.localStorage.removeItem(storageKey)
        window.localStorage.setItem(storageKey, JSON.stringify(reset))
      } catch (resetError) {
        if (!isQuotaExceededError(resetError)) throw resetError
      }
      return reset
    }
  }
}

export function saveQueueState(state: FreestyleSkipState, workspace?: FreestyleWorkspaceId) {
  return persistQueueState(queueStateStorageKey(workspace), state)
}

export function createOperationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return createDeterministicOperationId()
}
