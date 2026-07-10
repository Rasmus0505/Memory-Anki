export const PAGE_HISTORY_VERSION = 1
export const PAGE_HISTORY_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const PAGE_HISTORY_MAX_DEVICE_SNAPSHOTS = 20

export type PageHistorySectionKey =
  | 'dashboard'
  | 'freestyle'
  | 'palaces'
  | 'english'
  | 'englishReading'
  | 'knowledge'
  | 'review'
  | 'profile'
  | 'other'

export interface PageHistorySnapshot {
  version: typeof PAGE_HISTORY_VERSION
  pageKey: string
  sectionKey: PageHistorySectionKey
  fullPath: string
  locationKey: string
  workspaceId: string
  savedAt: number
  expiresAt: number
  scrollPositions: Record<string, number>
  uiState: Record<string, unknown>
  entityRevisions: Record<string, string | number | null>
  completionState: Record<string, unknown> | null
}

export interface PageHistoryCapture {
  scrollPositions?: Record<string, number>
  uiState?: Record<string, unknown>
  entityRevisions?: Record<string, string | number | null>
  completionState?: Record<string, unknown> | null
}
