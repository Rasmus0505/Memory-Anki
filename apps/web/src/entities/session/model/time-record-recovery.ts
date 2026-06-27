import * as React from 'react'
import { createTimeRecordApi } from '@/entities/session/api/time-records'
import type { TimeSessionRecord } from '@/entities/session/model/session-records'

const TIME_RECORD_RECOVERY_STORAGE_KEY = 'memory-anki.time-record-recovery.v1'
const TIME_RECORD_RECOVERY_CHANGE_EVENT = 'memory-anki-time-record-recovery:changed'
const AUTO_RETRY_INTERVAL_MS = 30_000

export type PendingTimeRecordRecoveryStatus = 'pending' | 'syncing' | 'failed'

export interface PendingTimeRecordRecoveryEntry {
  recordId: string
  mutationId: string
  record: TimeSessionRecord
  status: PendingTimeRecordRecoveryStatus
  createdAt: string
  updatedAt: string
  lastError: string | null
}

interface PendingTimeRecordRecoveryStore {
  version: 1
  items: PendingTimeRecordRecoveryEntry[]
}

function nowIso() {
  return new Date().toISOString()
}

function readRecoveryStore(): PendingTimeRecordRecoveryStore {
  if (typeof window === 'undefined') {
    return { version: 1, items: [] }
  }
  try {
    const raw = window.localStorage.getItem(TIME_RECORD_RECOVERY_STORAGE_KEY)
    if (!raw) {
      return { version: 1, items: [] }
    }
    const parsed = JSON.parse(raw) as Partial<PendingTimeRecordRecoveryStore>
    const items = Array.isArray(parsed.items) ? parsed.items : []
    return {
      version: 1,
      items: items.filter(isPendingRecoveryEntry),
    }
  } catch {
    return { version: 1, items: [] }
  }
}

function isPendingRecoveryEntry(value: unknown): value is PendingTimeRecordRecoveryEntry {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PendingTimeRecordRecoveryEntry>
  return (
    typeof candidate.recordId === 'string' &&
    candidate.recordId.length > 0 &&
    typeof candidate.mutationId === 'string' &&
    candidate.mutationId.length > 0 &&
    Boolean(candidate.record) &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string' &&
    (candidate.status === 'pending' ||
      candidate.status === 'syncing' ||
      candidate.status === 'failed')
  )
}

function writeRecoveryStore(store: PendingTimeRecordRecoveryStore) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      TIME_RECORD_RECOVERY_STORAGE_KEY,
      JSON.stringify(store),
    )
  } catch {
    // Ignore localStorage failures in restricted environments.
  }
}

function dispatchRecoveryStoreChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(TIME_RECORD_RECOVERY_CHANGE_EVENT))
}

function updateRecoveryStore(
  updater: (store: PendingTimeRecordRecoveryStore) => PendingTimeRecordRecoveryStore,
) {
  const nextStore = updater(readRecoveryStore())
  writeRecoveryStore(nextStore)
  dispatchRecoveryStoreChanged()
}

export function buildTimeRecordRecoveryMutationId(recordId: string) {
  return `time-record-unload:${recordId}`
}

export function listPendingTimeRecordRecoveries() {
  return readRecoveryStore().items.sort(
    (left, right) =>
      Date.parse(right.record.startedAt) - Date.parse(left.record.startedAt),
  )
}

export function getPendingTimeRecordRecovery(recordId: string) {
  return readRecoveryStore().items.find((item) => item.recordId === recordId) ?? null
}

export function upsertPendingTimeRecordRecovery(
  record: TimeSessionRecord,
  options?: {
    mutationId?: string
    status?: PendingTimeRecordRecoveryStatus
    lastError?: string | null
  },
) {
  const timestamp = nowIso()
  const nextEntry: PendingTimeRecordRecoveryEntry = {
    recordId: record.id,
    mutationId: options?.mutationId ?? buildTimeRecordRecoveryMutationId(record.id),
    record,
    status: options?.status ?? 'pending',
    createdAt: timestamp,
    updatedAt: timestamp,
    lastError: options?.lastError ?? null,
  }

  updateRecoveryStore((store) => {
    const existing = store.items.find((item) => item.recordId === record.id) ?? null
    return {
      version: 1,
      items: [
        ...store.items.filter((item) => item.recordId !== record.id),
        existing
          ? {
              ...existing,
              ...nextEntry,
              createdAt: existing.createdAt,
              updatedAt: timestamp,
            }
          : nextEntry,
      ],
    }
  })

  return nextEntry
}

export function markPendingTimeRecordRecovery(
  recordId: string,
  patch: Partial<Pick<PendingTimeRecordRecoveryEntry, 'status' | 'lastError'>>,
) {
  updateRecoveryStore((store) => ({
    version: 1,
    items: store.items.map((item) =>
      item.recordId === recordId
        ? {
            ...item,
            ...patch,
            updatedAt: nowIso(),
          }
        : item,
    ),
  }))
}

export function removePendingTimeRecordRecovery(recordId: string) {
  updateRecoveryStore((store) => ({
    version: 1,
    items: store.items.filter((item) => item.recordId !== recordId),
  }))
}

export function clearPendingTimeRecordRecoveriesForTest() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(TIME_RECORD_RECOVERY_STORAGE_KEY)
  dispatchRecoveryStoreChanged()
}

export function subscribePendingTimeRecordRecoveries(listener: () => void) {
  if (typeof window === 'undefined') return () => {}
  const handleStorage = (event: StorageEvent) => {
    if (event.key === TIME_RECORD_RECOVERY_STORAGE_KEY) {
      listener()
    }
  }
  window.addEventListener(TIME_RECORD_RECOVERY_CHANGE_EVENT, listener)
  window.addEventListener('storage', handleStorage)
  return () => {
    window.removeEventListener(TIME_RECORD_RECOVERY_CHANGE_EVENT, listener)
    window.removeEventListener('storage', handleStorage)
  }
}

let replayPromise: Promise<void> | null = null

async function replayOnePendingTimeRecord(entry: PendingTimeRecordRecoveryEntry) {
  markPendingTimeRecordRecovery(entry.recordId, {
    status: 'syncing',
    lastError: null,
  })
  try {
    await createTimeRecordApi(entry.record, {
      mutationId: entry.mutationId,
      persistence: false,
    })
    removePendingTimeRecordRecovery(entry.recordId)
  } catch (error) {
    markPendingTimeRecordRecovery(entry.recordId, {
      status: 'failed',
      lastError: error instanceof Error ? error.message : '恢复时间记录失败',
    })
  }
}

export async function replayPendingTimeRecordRecoveries() {
  if (replayPromise) return replayPromise
  replayPromise = (async () => {
    const items = listPendingTimeRecordRecoveries()
    for (const item of items) {
      await replayOnePendingTimeRecord(item)
    }
  })().finally(() => {
    replayPromise = null
  })
  return replayPromise
}

export function usePendingTimeRecordRecoveryAutoSync() {
  React.useEffect(() => {
    const replay = () => {
      void replayPendingTimeRecordRecoveries()
    }
    replay()
    const interval = window.setInterval(replay, AUTO_RETRY_INTERVAL_MS)
    const handleOnline = () => replay()
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        replay()
      }
    }

    window.addEventListener('online', handleOnline)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('online', handleOnline)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])
}
