import { beforeEach, describe, expect, it } from 'vitest'
import {
  createPageHistorySnapshot,
  PAGE_HISTORY_DEVICE_STORAGE_KEY,
  readPageHistorySectionUrl,
  readPageHistorySnapshot,
  resetPageHistoryStoreForTest,
  savePageHistorySnapshot,
} from './pageHistoryStore'
import {
  PAGE_HISTORY_MAX_DEVICE_SNAPSHOTS,
  PAGE_HISTORY_TTL_MS,
} from './pageHistoryTypes'

function snapshot(pageKey: string, locationKey: string, savedAt: number, fullPath = `/${pageKey}`) {
  return createPageHistorySnapshot({
    pageKey,
    sectionKey: 'palaces',
    fullPath,
    locationKey,
    workspaceId: 'workspace-a',
    scrollPositions: { window: savedAt },
    uiState: { marker: locationKey },
    entityRevisions: {},
    completionState: null,
  }, savedAt)
}

describe('pageHistoryStore', () => {
  const baseTime = Date.now()
  beforeEach(() => resetPageHistoryStoreForTest())

  it('prefers the exact navigation entry before the device page snapshot', () => {
    savePageHistorySnapshot(snapshot('palace:view:1', 'entry-a', baseTime, '/palaces/1?tab=a'))
    savePageHistorySnapshot(snapshot('palace:view:1', 'entry-b', baseTime + 1, '/palaces/1?tab=b'))

    expect(readPageHistorySnapshot('entry-a', 'palace:view:1')?.fullPath).toBe('/palaces/1?tab=a')
    expect(readPageHistorySnapshot('missing', 'palace:view:1')?.fullPath).toBe('/palaces/1?tab=b')
    expect(readPageHistorySectionUrl('palaces')).toBe('/palaces/1?tab=b')
  })

  it('merges page-specific UI state with later generic scroll snapshots', () => {
    savePageHistorySnapshot(snapshot('freestyle', 'entry-a', baseTime, '/freestyle'))
    savePageHistorySnapshot({
      ...snapshot('freestyle', 'entry-a', baseTime + 1, '/freestyle'),
      scrollPositions: { 'freestyle-cards': 900 },
      uiState: {},
    })

    expect(readPageHistorySnapshot('entry-a', 'freestyle')).toMatchObject({
      scrollPositions: { window: baseTime, 'freestyle-cards': 900 },
      uiState: { marker: 'entry-a' },
    })
  })

  it('keeps only the twenty most recent device page snapshots', () => {
    for (let index = 0; index < PAGE_HISTORY_MAX_DEVICE_SNAPSHOTS + 5; index += 1) {
      savePageHistorySnapshot(snapshot(`palace:view:${index}`, `entry-${index}`, baseTime + index))
    }
    const stored = JSON.parse(window.localStorage.getItem(PAGE_HISTORY_DEVICE_STORAGE_KEY) || '{}')
    expect(stored.snapshots).toHaveLength(PAGE_HISTORY_MAX_DEVICE_SNAPSHOTS)
    expect(stored.snapshots[0].pageKey).toBe('palace:view:24')
    expect(stored.snapshots.some((item: { pageKey: string }) => item.pageKey === 'palace:view:0')).toBe(false)
  })

  it('ignores expired snapshots', () => {
    const expiredAt = Date.now() - PAGE_HISTORY_TTL_MS - 1
    savePageHistorySnapshot(snapshot('palace:view:expired', 'expired-entry', expiredAt))
    expect(readPageHistorySnapshot('expired-entry', 'palace:view:expired')).toBeNull()
  })
})
