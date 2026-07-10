import {
  PAGE_HISTORY_MAX_DEVICE_SNAPSHOTS,
  PAGE_HISTORY_TTL_MS,
  PAGE_HISTORY_VERSION,
  type PageHistorySectionKey,
  type PageHistorySnapshot,
} from './pageHistoryTypes'

export const PAGE_HISTORY_DEVICE_STORAGE_KEY = 'memory-anki.page-history.device.v1'
export const PAGE_HISTORY_SESSION_STORAGE_KEY = 'memory-anki.page-history.session.v1'

interface DeviceHistoryState {
  version: typeof PAGE_HISTORY_VERSION
  snapshots: PageHistorySnapshot[]
  sectionLastUrls: Partial<Record<PageHistorySectionKey, string>>
  lastWorkspacePath: string | null
}

interface SessionHistoryState {
  version: typeof PAGE_HISTORY_VERSION
  snapshots: Record<string, PageHistorySnapshot>
}

const emptyDeviceState = (): DeviceHistoryState => ({
  version: PAGE_HISTORY_VERSION,
  snapshots: [],
  sectionLastUrls: {},
  lastWorkspacePath: null,
})

const emptySessionState = (): SessionHistoryState => ({
  version: PAGE_HISTORY_VERSION,
  snapshots: {},
})

function isSnapshot(value: unknown): value is PageHistorySnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Partial<PageHistorySnapshot>
  return snapshot.version === PAGE_HISTORY_VERSION &&
    typeof snapshot.pageKey === 'string' &&
    typeof snapshot.fullPath === 'string' &&
    typeof snapshot.locationKey === 'string' &&
    typeof snapshot.savedAt === 'number' &&
    typeof snapshot.expiresAt === 'number'
}

function sanitizeSnapshots(values: unknown, now = Date.now()) {
  if (!Array.isArray(values)) return []
  return values.filter(isSnapshot).filter((snapshot) => snapshot.expiresAt > now)
}

function readDeviceState(): DeviceHistoryState {
  try {
    const raw = window.localStorage.getItem(PAGE_HISTORY_DEVICE_STORAGE_KEY)
    if (!raw) return emptyDeviceState()
    const parsed = JSON.parse(raw) as Partial<DeviceHistoryState>
    if (parsed.version !== PAGE_HISTORY_VERSION) return emptyDeviceState()
    return {
      version: PAGE_HISTORY_VERSION,
      snapshots: sanitizeSnapshots(parsed.snapshots),
      sectionLastUrls: parsed.sectionLastUrls && typeof parsed.sectionLastUrls === 'object'
        ? parsed.sectionLastUrls
        : {},
      lastWorkspacePath: typeof parsed.lastWorkspacePath === 'string' ? parsed.lastWorkspacePath : null,
    }
  } catch {
    return emptyDeviceState()
  }
}

function writeDeviceState(state: DeviceHistoryState) {
  try {
    window.localStorage.setItem(PAGE_HISTORY_DEVICE_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Storage can be unavailable or full.
  }
}

function readSessionState(): SessionHistoryState {
  try {
    const raw = window.sessionStorage.getItem(PAGE_HISTORY_SESSION_STORAGE_KEY)
    if (!raw) return emptySessionState()
    const parsed = JSON.parse(raw) as Partial<SessionHistoryState>
    if (
      parsed.version !== PAGE_HISTORY_VERSION ||
      !parsed.snapshots ||
      typeof parsed.snapshots !== 'object'
    ) return emptySessionState()
    return {
      version: PAGE_HISTORY_VERSION,
      snapshots: Object.fromEntries(
        Object.entries(parsed.snapshots).filter(
          ([, snapshot]) => isSnapshot(snapshot) && snapshot.expiresAt > Date.now(),
        ),
      ),
    }
  } catch {
    return emptySessionState()
  }
}

function writeSessionState(state: SessionHistoryState) {
  try {
    window.sessionStorage.setItem(PAGE_HISTORY_SESSION_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Storage can be unavailable or full.
  }
}

export function createPageHistorySnapshot(
  input: Omit<PageHistorySnapshot, 'version' | 'savedAt' | 'expiresAt'>,
  now = Date.now(),
): PageHistorySnapshot {
  return { ...input, version: PAGE_HISTORY_VERSION, savedAt: now, expiresAt: now + PAGE_HISTORY_TTL_MS }
}

export function savePageHistorySnapshot(snapshot: PageHistorySnapshot) {
  const session = readSessionState()
  const existingSession = session.snapshots[snapshot.locationKey]
  const mergedSnapshot = existingSession && existingSession.pageKey === snapshot.pageKey
    ? {
        ...existingSession,
        ...snapshot,
        scrollPositions: { ...existingSession.scrollPositions, ...snapshot.scrollPositions },
        uiState: { ...existingSession.uiState, ...snapshot.uiState },
        entityRevisions: { ...existingSession.entityRevisions, ...snapshot.entityRevisions },
        completionState: snapshot.completionState ?? existingSession.completionState,
      }
    : snapshot
  session.snapshots[snapshot.locationKey] = mergedSnapshot
  writeSessionState(session)

  const device = readDeviceState()
  const existingDevice = device.snapshots.find((item) => item.pageKey === snapshot.pageKey)
  const mergedDeviceSnapshot = existingDevice
    ? {
        ...existingDevice,
        ...mergedSnapshot,
        scrollPositions: { ...existingDevice.scrollPositions, ...mergedSnapshot.scrollPositions },
        uiState: { ...existingDevice.uiState, ...mergedSnapshot.uiState },
        entityRevisions: { ...existingDevice.entityRevisions, ...mergedSnapshot.entityRevisions },
        completionState: mergedSnapshot.completionState ?? existingDevice.completionState,
      }
    : mergedSnapshot
  device.snapshots = [mergedDeviceSnapshot, ...device.snapshots.filter((item) => item.pageKey !== snapshot.pageKey)]
    .filter((item) => item.expiresAt > Date.now())
    .slice(0, PAGE_HISTORY_MAX_DEVICE_SNAPSHOTS)
  device.lastWorkspacePath = mergedDeviceSnapshot.fullPath
  if (mergedDeviceSnapshot.sectionKey !== 'other') {
    device.sectionLastUrls[mergedDeviceSnapshot.sectionKey] = mergedDeviceSnapshot.fullPath
  }
  writeDeviceState(device)
}

export function readPageHistorySnapshot(locationKey: string, pageKey: string) {
  const sessionSnapshot = readSessionState().snapshots[locationKey]
  if (sessionSnapshot?.expiresAt > Date.now()) return sessionSnapshot
  return readDeviceState().snapshots.find((snapshot) => snapshot.pageKey === pageKey) ?? null
}

export function clearPageHistorySnapshot(pageKey: string) {
  const session = readSessionState()
  session.snapshots = Object.fromEntries(
    Object.entries(session.snapshots).filter(([, snapshot]) => snapshot.pageKey !== pageKey),
  )
  writeSessionState(session)
  const device = readDeviceState()
  device.snapshots = device.snapshots.filter((snapshot) => snapshot.pageKey !== pageKey)
  writeDeviceState(device)
}

export function recordPageHistorySectionVisit(sectionKey: PageHistorySectionKey, fullPath: string) {
  if (sectionKey === 'other') return
  const state = readDeviceState()
  state.sectionLastUrls[sectionKey] = fullPath
  state.lastWorkspacePath = fullPath
  writeDeviceState(state)
}

export function readPageHistorySectionUrl(sectionKey: PageHistorySectionKey) {
  return readDeviceState().sectionLastUrls[sectionKey] ?? null
}

export function readLastPageHistoryWorkspacePath() {
  return readDeviceState().lastWorkspacePath
}

export function resetPageHistoryStoreForTest() {
  window.localStorage.removeItem(PAGE_HISTORY_DEVICE_STORAGE_KEY)
  window.sessionStorage.removeItem(PAGE_HISTORY_SESSION_STORAGE_KEY)
}
