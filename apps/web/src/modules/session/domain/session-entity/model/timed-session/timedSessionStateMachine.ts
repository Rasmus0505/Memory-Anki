import * as React from 'react'
import { fireAndQueueTimeRecordOnUnload } from '@/shared/hooks/timedSessionRecovery'
import {
  buildTimedSessionStorageKey,
  clearDwellLocalSnapshot,
  clearPersistedTimedSessionSnapshot,
  readDwellLocalSnapshot,
  writeDwellLocalSnapshot,
} from '@/shared/hooks/timedSessionStorage'
import {
  DWELL_LIVE_SESSION_KEY,
  DWELL_RESUME_WINDOW_MS,
  dwellKindToSessionKind,
  dwellSessionKeyForRecord,
  formatDwellRecordTitle,
  isDwellExcludedPath,
  isDwellSessionKey,
  pickDominantFragmentKind,
  segmentKindFromScene,
  shouldResumeDwell,
} from './dwellPolicy'
import {
  buildPersistedTimedSessionSnapshot,
  buildRecordFromExpiredSuspendedSnapshot,
  writePersistedTimedSessionSnapshot,
} from '@/shared/hooks/timedSessionSnapshot'
import {
  buildTimedSessionController,
  createStableRecordId,
  DEFAULT_TIMED_SESSION_FOCUS_ROUND,
  normalizeSnapshot,
  nowIso,
  type ActiveSceneSegmentSnapshot,
  type GlowState,
  type SessionSceneSegment,
  type SessionStatus,
  type TimedSessionFocusRoundState,
  type TimedSessionMeta,
  type TimedSessionOptions,
  type TimedSessionPauseReason,
} from '@/shared/hooks/timedSessionModel'
import {
  removePendingTimeRecordRecovery,
  type SessionCompletionMethod,
  type SessionEventRecord,
  type TimeSessionRecord,
} from '@/modules/session/domain/session-entity/model'
import { persistTimedSessionRecord } from './timedSessionRecordBuilder'
import { useStableTimedSessionController } from './useStableTimedSessionController'
import {
  isLiveForegroundClockSuppressed,
  subscribeLiveForegroundClock,
} from './liveClockOwnership'

interface TimerStoreSnapshot {
  sessionId: string
  sessionKey: string
  effectiveSeconds: number
  idleSeconds: number
  pauseCount: number
  status: SessionStatus
  pauseReason: TimedSessionPauseReason
  startedAt: string | null
  durationEdited: boolean
  glowState: GlowState
  focusRound: TimedSessionFocusRoundState
}

interface TimerAttachment {
  scene: string
  kind: TimedSessionOptions['kind']
  title: string
  active: boolean
  palaceId: number | null
  sourceKind: TimedSessionOptions['sourceKind']
  englishCourseId: number | null
  routePath?: string
}

interface TimerStore {
  key: string
  storageKey: string | null
  snapshot: TimerStoreSnapshot
  kind: TimedSessionOptions['kind']
  scene: string
  palaceId: number | null
  sourceKind: TimedSessionOptions['sourceKind']
  englishCourseId: number | null
  title: string
  persistCompletionRecord: boolean
  recordId: string | null
  startedAtMs: number | null
  runningSinceMs: number | null
  effectiveMs: number
  events: SessionEventRecord[]
  sceneSegments: SessionSceneSegment[]
  activeSegment: ActiveSceneSegmentSnapshot | null
  listeners: Set<() => void>
  attachments: Map<string, TimerAttachment>
  finalizeTimer: number | null
  tickTimer: number | null
  finalRecord: TimeSessionRecord | null
  finalPersist: Promise<TimeSessionRecord | null> | null
  unloadFinalized: boolean
  hiddenAtMs: number | null
  clientRevision: number
}

const stores = new Map<string, TimerStore>()
let browserListenersInstalled = false

function stableSessionKey(options: TimedSessionOptions) {
  const sessionKey = options.sessionKey.trim()
  if (!sessionKey) throw new Error('TimedSessionOptions.sessionKey must not be empty')
  return sessionKey
}

function readSnapshot(storageKey: string | null): Record<string, unknown> | null {
  if (!storageKey || typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(storageKey)
    if (!raw) return null
    const value = JSON.parse(raw)
    return value && typeof value === 'object' ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

function notify(store: TimerStore) {
  for (const listener of store.listeners) listener()
}

function currentEffectiveMs(store: TimerStore, currentMs = Date.now()) {
  if (store.runningSinceMs == null) return store.effectiveMs
  return store.effectiveMs + Math.max(0, currentMs - store.runningSinceMs)
}

function updateEffectiveSnapshot(store: TimerStore, currentMs = Date.now()) {
  const nextSeconds = Math.max(0, Math.floor(currentEffectiveMs(store, currentMs) / 1000))
  if (nextSeconds === store.snapshot.effectiveSeconds) return false
  store.snapshot = { ...store.snapshot, effectiveSeconds: nextSeconds }
  return true
}

function persistSnapshot(store: TimerStore, options?: { suspended?: boolean }) {
  if (!store.storageKey) return
  if (!store.snapshot.startedAt || store.snapshot.status === 'idle' || store.snapshot.status === 'completed') {
    clearPersistedTimedSessionSnapshot(store.storageKey)
    if (isDwellSessionKey(store.key)) clearDwellLocalSnapshot()
    return
  }
  updateEffectiveSnapshot(store)
  const hiddenAtMs = store.hiddenAtMs
  const resumeDeadlineAt = hiddenAtMs == null
    ? null
    : new Date(hiddenAtMs + DWELL_RESUME_WINDOW_MS).toISOString()
  const snapshot = buildPersistedTimedSessionSnapshot({
    recordId: store.recordId,
    sessionKey: isDwellSessionKey(store.key) && store.recordId
      ? dwellSessionKeyForRecord(store.recordId)
      : store.key,
    kind: store.kind,
    palaceId: store.palaceId,
    sourceKind: store.sourceKind,
    englishCourseId: store.englishCourseId,
    title: store.title,
    effectiveSeconds: store.snapshot.effectiveSeconds,
    pauseCount: store.snapshot.pauseCount,
    status: store.snapshot.status === 'running' ? 'running' : 'paused',
    startedAt: store.snapshot.startedAt,
    durationEdited: false,
    events: [...store.events],
    sceneSegments: [...store.sceneSegments],
    activeSceneSegment: store.activeSegment,
    focusRound: { ...DEFAULT_TIMED_SESSION_FOCUS_ROUND },
    lastActivityAtMs: hiddenAtMs,
    autoPauseDeadlineAtMs: null,
  }, {
    suspended: options?.suspended ?? store.snapshot.pauseReason === 'document_hidden',
    suspendedAt: hiddenAtMs == null ? null : new Date(hiddenAtMs).toISOString(),
    resumeDeadlineAt,
  })
  writePersistedTimedSessionSnapshot(store.storageKey, snapshot)
  if (isDwellSessionKey(store.key) && snapshot.suspended) writeDwellLocalSnapshot(snapshot)
}

function canRunForegroundClock() {
  if (isLiveForegroundClockSuppressed()) return false
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false
  return true
}

function settleRunning(store: TimerStore, currentMs = Date.now()) {
  if (store.runningSinceMs == null) return
  store.effectiveMs = currentEffectiveMs(store, currentMs)
  store.runningSinceMs = null
  updateEffectiveSnapshot(store, currentMs)
}

function stopTicker(store: TimerStore) {
  if (store.tickTimer != null && typeof window !== 'undefined') {
    window.clearInterval(store.tickTimer)
  }
  store.tickTimer = null
}

function startTicker(store: TimerStore) {
  stopTicker(store)
  if (typeof window === 'undefined') return
  store.tickTimer = window.setInterval(() => {
    if (store.snapshot.status !== 'running') return
    if (!activeAttachments(store).some((item) => item.active)) {
      // A route can be inactive while its component remains mounted. Freeze the
      // active interval without changing the public status so a same-target
      // page can continue it when it attaches again.
      settleRunning(store)
      persistSnapshot(store)
      stopTicker(store)
      notify(store)
      return
    }
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      pauseStore(store, 'document_hidden', { source: 'visibilitychange' })
      return
    }
    if (updateEffectiveSnapshot(store)) {
      // SessionStorage is the crash-safe checkpoint. The ticker only refreshes
      // this local snapshot once per displayed second; it never writes the API.
      persistSnapshot(store)
      notify(store)
    }
  }, 250)
}

function pushEvent(store: TimerStore, type: SessionEventRecord['type'], meta?: TimedSessionMeta) {
  store.events.push({ type, at: nowIso(), ...(meta ? { meta } : {}) })
}

function closeActiveSegment(store: TimerStore, endedAt = nowIso()) {
  const active = store.activeSegment
  if (!active) return
  const seconds = Math.max(0, store.snapshot.effectiveSeconds - active.startEffectiveSeconds)
  if (seconds > 0) {
    store.sceneSegments.push({
      scene: active.scene,
      kind: active.kind,
      palaceId: active.palaceId,
      sourceKind: active.sourceKind,
      englishCourseId: active.englishCourseId,
      title: active.title,
      startedAt: active.startedAt,
      endedAt,
      effectiveSeconds: seconds,
      routePath: active.routePath,
    })
  }
  store.activeSegment = null
}

function openSegment(store: TimerStore, attachment?: TimerAttachment) {
  if (attachment && attachmentIsExcluded(attachment)) return
  const scene = attachment?.scene ?? store.scene
  if (store.activeSegment?.scene === scene && store.activeSegment.routePath === (attachment?.routePath ?? store.activeSegment.routePath)) {
    store.activeSegment = {
      ...store.activeSegment,
      title: attachment?.title ?? store.activeSegment.title,
      palaceId: attachment?.palaceId ?? store.activeSegment.palaceId,
      sourceKind: attachment?.sourceKind ?? store.activeSegment.sourceKind,
      englishCourseId: attachment?.englishCourseId ?? store.activeSegment.englishCourseId,
    }
    return
  }
  closeActiveSegment(store)
  store.activeSegment = {
    scene: scene as SessionSceneSegment['scene'],
    kind: segmentKindFromScene(
      attachment?.scene ?? store.scene,
      (attachment?.kind ?? store.kind) as SessionSceneSegment['kind'],
    ),
    palaceId: attachment?.palaceId ?? store.palaceId,
    sourceKind: attachment?.sourceKind ?? store.sourceKind,
    englishCourseId: attachment?.englishCourseId ?? store.englishCourseId,
    title: attachment?.title ?? store.title,
    startedAt: nowIso(),
    startEffectiveSeconds: store.snapshot.effectiveSeconds,
    routePath: attachment?.routePath,
  }
}

/** Settle the current foreground interval before changing scene metadata. */
function switchSegment(store: TimerStore, attachment?: TimerAttachment) {
  const wasRunning = store.snapshot.status === 'running' && store.runningSinceMs != null
  if (wasRunning) settleRunning(store)
  openSegment(store, attachment)

  // A scene handoff is not a pause/resume transition. Continue the same
  // target-level interval after the new segment is opened.
  if (wasRunning) {
    store.runningSinceMs = Date.now()
  }
}

function activeAttachments(store: TimerStore) {
  return Array.from(store.attachments.values()).filter((item) => item.active)
}

function pauseStore(store: TimerStore, reason: Exclude<TimedSessionPauseReason, null>, meta?: TimedSessionMeta) {
  if (store.snapshot.status !== 'running') return
  settleRunning(store)
  stopTicker(store)
  store.snapshot = {
    ...store.snapshot,
    status: 'paused',
    pauseReason: reason,
    pauseCount: store.snapshot.pauseCount + 1,
    glowState: 'paused',
  }
  if (reason === 'excluded_route') {
    // Settings/backup freeze the clock but must not become a scene fragment
    // or start the 15-minute leave gap.
    closeActiveSegment(store)
  }
  pushEvent(store, 'pause', { reason, ...(meta ?? {}) })
  persistSnapshot(store)
  notify(store)
}

function attachmentIsExcluded(attachment: TimerAttachment) {
  return Boolean(attachment.routePath && isDwellExcludedPath(attachment.routePath))
}

function holdExcludedRoute(store: TimerStore, meta?: TimedSessionMeta) {
  if (store.snapshot.status === 'running') {
    pauseStore(store, 'excluded_route', { source: 'excluded_route', ...(meta ?? {}) })
    return
  }
  if (store.activeSegment) {
    closeActiveSegment(store)
    persistSnapshot(store)
    notify(store)
  }
}

function startStore(store: TimerStore, meta?: TimedSessionMeta) {
  if (store.snapshot.status !== 'idle') return
  if (!canRunForegroundClock()) return
  if (store.startedAtMs == null) {
    store.startedAtMs = Date.now()
    store.snapshot = { ...store.snapshot, startedAt: nowIso() }
  }
  if (!store.recordId) store.recordId = createStableRecordId()
  if (isDwellSessionKey(store.key) && store.startedAtMs != null) {
    store.title = formatDwellRecordTitle(new Date(store.startedAtMs))
  }
  store.runningSinceMs = Date.now()
  store.snapshot = {
    ...store.snapshot,
    status: 'running',
    pauseReason: null,
    glowState: 'running',
  }
  openSegment(store, Array.from(store.attachments.values()).find((item) => item.active))
  pushEvent(store, 'start', meta)
  startTicker(store)
  persistSnapshot(store)
  notify(store)
}

function resumeStore(store: TimerStore, meta?: TimedSessionMeta) {
  if (store.snapshot.status !== 'paused') return
  if (!canRunForegroundClock()) return
  if (!activeAttachments(store).some((item) => item.active)) return
  store.runningSinceMs = Date.now()
  store.snapshot = { ...store.snapshot, status: 'running', pauseReason: null, glowState: 'running' }
  openSegment(store, Array.from(store.attachments.values()).find((item) => item.active))
  pushEvent(store, 'resume', meta)
  startTicker(store)
  persistSnapshot(store)
  notify(store)
}

function nextClientRevision(store: TimerStore) {
  store.clientRevision += 1
  return store.clientRevision
}

function collectSegments(store: TimerStore, endedAt: string): SessionSceneSegment[] {
  const segments = [...store.sceneSegments]
  const active = store.activeSegment
  if (!active) return segments
  const seconds = Math.max(0, store.snapshot.effectiveSeconds - active.startEffectiveSeconds)
  if (seconds <= 0) return segments
  segments.push({
    scene: active.scene,
    kind: active.kind,
    palaceId: active.palaceId,
    sourceKind: active.sourceKind,
    englishCourseId: active.englishCourseId,
    title: active.title,
    startedAt: active.startedAt,
    endedAt,
    effectiveSeconds: seconds,
    routePath: active.routePath,
  })
  return segments
}

function buildRecord(store: TimerStore, method: SessionCompletionMethod, endedAt = nowIso()) {
  if (!store.snapshot.startedAt || !store.recordId) return null
  settleRunning(store)
  updateEffectiveSnapshot(store)
  closeActiveSegment(store, endedAt)
  const dominantKind = pickDominantFragmentKind(store.sceneSegments, store.kind)
  return {
    id: store.recordId,
    sessionKey: isDwellSessionKey(store.key)
      ? dwellSessionKeyForRecord(store.recordId)
      : store.key,
    clientRevision: nextClientRevision(store),
    operationId: `timer:${store.recordId}:${method}:${store.clientRevision}`,
    kind: dwellKindToSessionKind(dominantKind),
    palaceId: store.palaceId,
    sourceKind: store.sourceKind,
    englishCourseId: store.englishCourseId,
    title: isDwellSessionKey(store.key)
      ? formatDwellRecordTitle(new Date(store.startedAtMs ?? Date.now()))
      : store.title,
    startedAt: store.snapshot.startedAt,
    endedAt,
    effectiveSeconds: store.snapshot.effectiveSeconds,
    pauseCount: store.snapshot.pauseCount,
    completionMethod: method,
    durationEdited: false,
    activityTag: dominantKind,
    events: [...store.events],
    sceneSegments: [...store.sceneSegments],
  } satisfies TimeSessionRecord
}

function buildCheckpointRecord(store: TimerStore) {
  if (!store.snapshot.startedAt || !store.recordId) return null
  settleRunning(store)
  updateEffectiveSnapshot(store)
  const endedAt = nowIso()
  const dominantKind = pickDominantFragmentKind(
    collectSegments(store, endedAt),
    store.kind,
  )
  return {
    id: store.recordId,
    sessionKey: isDwellSessionKey(store.key)
      ? dwellSessionKeyForRecord(store.recordId)
      : store.key,
    clientRevision: nextClientRevision(store),
    operationId: `timer:${store.recordId}:saved:${store.clientRevision}`,
    kind: dwellKindToSessionKind(dominantKind),
    palaceId: store.palaceId,
    sourceKind: store.sourceKind,
    englishCourseId: store.englishCourseId,
    title: isDwellSessionKey(store.key)
      ? formatDwellRecordTitle(new Date(store.startedAtMs ?? Date.now()))
      : store.title,
    startedAt: store.snapshot.startedAt,
    endedAt,
    effectiveSeconds: store.snapshot.effectiveSeconds,
    pauseCount: store.snapshot.pauseCount,
    completionMethod: 'saved' as const,
    durationEdited: false,
    activityTag: dominantKind,
    events: [...store.events],
    sceneSegments: collectSegments(store, endedAt),
  } satisfies TimeSessionRecord
}

async function completeStore(
  store: TimerStore,
  method: SessionCompletionMethod,
  meta?: TimedSessionMeta,
  options?: { persistRecord?: boolean },
) {
  if (store.snapshot.status === 'completed') return store.finalRecord
  stopTicker(store)
  settleRunning(store)
  pushEvent(store, method === 'manual_complete' ? 'manual_complete' : method === 'auto_complete' ? 'auto_complete' : 'complete', meta)
  const record = buildRecord(store, method)
  store.finalRecord = record
  store.snapshot = { ...store.snapshot, status: 'completed', pauseReason: null, glowState: 'idle' }
  if (store.storageKey) clearPersistedTimedSessionSnapshot(store.storageKey)
  if (record) removePendingTimeRecordRecovery(record.id)
  notify(store)
  if (!record || !store.persistCompletionRecord || options?.persistRecord === false) {
    releaseStoreAfterCompletion(store)
    return record
  }
  if (!store.finalPersist) {
    store.finalPersist = persistTimedSessionRecord(record).then((persisted) => persisted ?? record)
  }
  if (isDwellSessionKey(store.key) && store.storageKey) {
    clearPersistedTimedSessionSnapshot(store.storageKey)
    clearDwellLocalSnapshot()
  }
  releaseStoreAfterCompletion(store)
  return store.finalPersist
}

function releaseStoreAfterCompletion(store: TimerStore) {
  if (typeof window === 'undefined') return
  window.setTimeout(() => {
    if (store.attachments.size > 0 && isDwellSessionKey(store.key)) {
      resetStore(store)
      return
    }
    if (store.attachments.size === 0 && stores.get(store.key) === store) {
      stores.delete(store.key)
    }
  }, 0)
}

function resetStore(store: TimerStore) {
  stopTicker(store)
  if (store.storageKey) clearPersistedTimedSessionSnapshot(store.storageKey)
  store.recordId = null
  store.startedAtMs = null
  store.runningSinceMs = null
  store.effectiveMs = 0
  store.events = []
  store.sceneSegments = []
  store.activeSegment = null
  store.finalRecord = null
  store.finalPersist = null
  store.unloadFinalized = false
  store.hiddenAtMs = null
  store.clientRevision = 0
  store.snapshot = {
    ...store.snapshot,
    effectiveSeconds: 0,
    idleSeconds: 0,
    pauseCount: 0,
    status: 'idle',
    pauseReason: null,
    startedAt: null,
    glowState: 'idle',
  }
  notify(store)
}

function scheduleFinalizeIfUnused(store: TimerStore) {
  if (isDwellSessionKey(store.key)) return
  if (store.finalizeTimer != null || typeof window === 'undefined') return
  store.finalizeTimer = window.setTimeout(() => {
    store.finalizeTimer = null
    const active = Array.from(store.attachments.values()).some((item) => item.active)
    if (!active && store.snapshot.status !== 'idle' && store.snapshot.status !== 'completed') {
      void completeStore(store, 'left_page', { source: 'scene_inactive' })
    }
  }, 0)
}

function syncAttachment(store: TimerStore, id: string, attachment: TimerAttachment) {
  const next = attachmentIsExcluded(attachment)
    ? { ...attachment, active: false }
    : attachment
  const previous = store.attachments.get(id)
  store.attachments.set(id, next)
  if (attachmentIsExcluded(next)) {
    holdExcludedRoute(store)
    return
  }
  if (!previous) return
  if (previous.active !== next.active) {
    setSceneActiveStore(store, id, next.active)
    return
  }
  if (!next.active) return
  if (store.snapshot.status === 'running') {
    switchSegment(store, next)
    persistSnapshot(store)
    notify(store)
  }
}

function attachStore(store: TimerStore, id: string, attachment: TimerAttachment) {
  if (store.finalizeTimer != null && typeof window !== 'undefined') {
    window.clearTimeout(store.finalizeTimer)
    store.finalizeTimer = null
  }
  const next = attachmentIsExcluded(attachment)
    ? { ...attachment, active: false }
    : attachment
  store.attachments.set(id, next)
  if (attachmentIsExcluded(next)) {
    holdExcludedRoute(store)
    notify(store)
    return
  }
  if (store.snapshot.status === 'running') {
    if (store.runningSinceMs == null && canRunForegroundClock()) {
      store.runningSinceMs = Date.now()
    }
    if (store.runningSinceMs != null) {
      switchSegment(store, next)
      if (store.tickTimer == null) startTicker(store)
    }
  }
  notify(store)
}

function detachStore(store: TimerStore, id: string) {
  store.attachments.delete(id)
  const active = activeAttachments(store)
  if (active.length === 0) {
    // Unmount can happen between timer ticks. Freeze the interval before
    // closing its segment so the final visible fraction is included.
    settleRunning(store)
    stopTicker(store)
    closeActiveSegment(store)
    persistSnapshot(store)
  } else if (
    store.activeSegment &&
    !active.some((item) => item.scene === store.activeSegment?.scene)
  ) {
    switchSegment(store, active[0])
    persistSnapshot(store)
  }
  scheduleFinalizeIfUnused(store)
  if (store.attachments.size === 0 && store.snapshot.status === 'idle') {
    stores.delete(store.key)
  }
}

function setSceneActiveStore(store: TimerStore, id: string, active: boolean, _meta?: TimedSessionMeta) {
  const attachment = store.attachments.get(id)
  if (!attachment || attachment.active === active) return
  attachment.active = active
  if (!active) {
    const remainingActive = activeAttachments(store)
    if (remainingActive.length === 0) {
      // Route changes stop the current active interval, but are not a system or
      // manual pause. This lets a same-target page attach and continue without
      // changing the public pause state or auto-resuming a paused session.
      settleRunning(store)
      stopTicker(store)
      closeActiveSegment(store)
      persistSnapshot(store)
      scheduleFinalizeIfUnused(store)
    } else if (
      store.activeSegment &&
      !remainingActive.some((item) => item.scene === store.activeSegment?.scene)
    ) {
      switchSegment(store, remainingActive[0])
      persistSnapshot(store)
      notify(store)
    }
  } else {
    // Scene activation is a route event, never a resume command. Only explicit
    // resume() or visibility/focus recovery can leave a paused state.
    if (
      store.snapshot.status === 'running' &&
      store.runningSinceMs == null &&
      canRunForegroundClock()
    ) {
      store.runningSinceMs = Date.now()
      switchSegment(store, attachment)
      if (store.tickTimer == null) startTicker(store)
    }
    notify(store)
  }
}

function resumeDeadlineExpired(snapshot: {
  resumeDeadlineAt: string | null
  lastActivityAtMs: number | null
  suspendedAt: string | null
  suspended: boolean
}) {
  if (snapshot.resumeDeadlineAt) {
    const deadline = Date.parse(snapshot.resumeDeadlineAt)
    return Number.isFinite(deadline) && Date.now() > deadline
  }
  if (snapshot.lastActivityAtMs != null) return !shouldResumeDwell(snapshot.lastActivityAtMs, Date.now())
  if (snapshot.suspended && snapshot.suspendedAt) {
    const hiddenAt = Date.parse(snapshot.suspendedAt)
    return Number.isFinite(hiddenAt) && !shouldResumeDwell(hiddenAt, Date.now())
  }
  return false
}

function hydrateStore(store: TimerStore) {
  const raw = readSnapshot(store.storageKey)
    ?? (isDwellSessionKey(store.key) ? readDwellLocalSnapshot() : null)
  const snapshot = normalizeSnapshot(raw)
  if (!snapshot || !snapshot.startedAt) return
  if (resumeDeadlineExpired(snapshot)) {
    const expired = buildRecordFromExpiredSuspendedSnapshot(snapshot)
    if (expired && store.persistCompletionRecord) {
      void persistTimedSessionRecord(expired)
    }
    if (store.storageKey) clearPersistedTimedSessionSnapshot(store.storageKey)
    if (isDwellSessionKey(store.key)) clearDwellLocalSnapshot()
    return
  }
  const seconds = Math.max(0, Math.round(snapshot.effectiveSeconds))
  // The first page owns the session metadata. On reload the snapshot must win
  // over whichever later scene happened to mount first.
  if (snapshot.kind) store.kind = snapshot.kind
  store.scene = snapshot.activeSceneSegment?.scene ?? snapshot.sceneSegments.at(-1)?.scene ?? store.scene
  store.palaceId = snapshot.palaceId
  store.sourceKind = snapshot.sourceKind
  store.englishCourseId = snapshot.englishCourseId
  if (snapshot.title) store.title = snapshot.title
  store.recordId = snapshot.recordId ?? createStableRecordId()
  store.startedAtMs = new Date(snapshot.startedAt).getTime()
  store.effectiveMs = seconds * 1000
  store.events = [...snapshot.events]
  store.sceneSegments = [...snapshot.sceneSegments]
  store.activeSegment = snapshot.activeSceneSegment
  store.hiddenAtMs = snapshot.lastActivityAtMs
  store.snapshot = {
    ...store.snapshot,
    effectiveSeconds: seconds,
    pauseCount: snapshot.pauseCount,
    status: 'paused',
    pauseReason: snapshot.suspended ? 'document_hidden' : 'restored',
    startedAt: snapshot.startedAt,
  }
}

function createStore(key: string, options: TimedSessionOptions): TimerStore {
  const store: TimerStore = {
    key,
    storageKey: buildTimedSessionStorageKey(key),
    snapshot: {
      sessionId: createStableRecordId(),
      sessionKey: key,
      effectiveSeconds: 0,
      idleSeconds: 0,
      pauseCount: 0,
      status: 'idle',
      pauseReason: null,
      startedAt: null,
      durationEdited: false,
      glowState: 'idle',
      focusRound: { ...DEFAULT_TIMED_SESSION_FOCUS_ROUND },
    },
    kind: options.kind,
    scene: options.automationScene ?? options.kind,
    palaceId: options.palaceId,
    sourceKind: options.sourceKind ?? null,
    englishCourseId: options.englishCourseId ?? null,
    title: options.title,
    persistCompletionRecord: options.persistCompletionRecord !== false,
    recordId: null,
    startedAtMs: null,
    runningSinceMs: null,
    effectiveMs: 0,
    events: [],
    sceneSegments: [],
    activeSegment: null,
    listeners: new Set(),
    attachments: new Map(),
    finalizeTimer: null,
    tickTimer: null,
    finalRecord: null,
    finalPersist: null,
    unloadFinalized: false,
    hiddenAtMs: null,
    clientRevision: 0,
  }
  hydrateStore(store)
  return store
}

function getStore(key: string, options: TimedSessionOptions) {
  const existing = stores.get(key)
  if (existing) return existing
  const store = createStore(key, options)
  stores.set(key, store)
  installBrowserListeners()
  return store
}

function systemResume(store: TimerStore, source: string) {
  if (store.snapshot.status !== 'paused') return
  if (store.snapshot.pauseReason !== 'document_hidden' && store.snapshot.pauseReason !== 'window_blur') return
  if (!Array.from(store.attachments.values()).some((item) => item.active)) return
  if (!canRunForegroundClock()) return
  resumeStore(store, { source })
}

function syncStoresToLiveClockGate() {
  const suppressed = isLiveForegroundClockSuppressed()
  for (const store of stores.values()) {
    if (suppressed) {
      if (store.runningSinceMs == null) continue
      settleRunning(store)
      stopTicker(store)
      persistSnapshot(store)
      notify(store)
      continue
    }
    if (
      store.snapshot.status === 'running' &&
      store.runningSinceMs == null &&
      canRunForegroundClock() &&
      activeAttachments(store).length > 0
    ) {
      store.runningSinceMs = Date.now()
      if (store.tickTimer == null) startTicker(store)
      persistSnapshot(store)
      notify(store)
    }
  }
}

export function adoptLiveTimerSnapshot(input: {
  sessionKey: string
  status: SessionStatus | string
  effectiveSeconds: number
}) {
  const store = stores.get(input.sessionKey)
    ?? (isDwellSessionKey(input.sessionKey) ? stores.get(DWELL_LIVE_SESSION_KEY) : undefined)
  if (!store) return
  const seconds = Math.max(0, Math.round(input.effectiveSeconds))
  settleRunning(store)
  store.effectiveMs = seconds * 1000
  const nextStatus: SessionStatus =
    input.status === 'running' || input.status === 'paused' || input.status === 'completed' || input.status === 'idle'
      ? input.status
      : store.snapshot.status
  store.snapshot = {
    ...store.snapshot,
    effectiveSeconds: seconds,
    status: nextStatus,
    pauseReason: nextStatus === 'paused' ? store.snapshot.pauseReason ?? 'manual' : null,
    glowState: nextStatus === 'running' ? 'running' : nextStatus === 'paused' ? 'paused' : 'idle',
  }
  if (nextStatus === 'running' && canRunForegroundClock() && activeAttachments(store).length > 0) {
    store.runningSinceMs = Date.now()
    if (store.tickTimer == null) startTicker(store)
  } else {
    stopTicker(store)
  }
  persistSnapshot(store)
  notify(store)
}

function markStoresHidden() {
  const hiddenAtMs = Date.now()
  for (const store of stores.values()) {
    if (store.snapshot.status === 'idle' || store.snapshot.status === 'completed') continue
    store.hiddenAtMs = hiddenAtMs
    if (store.snapshot.status === 'running') {
      pauseStore(store, 'document_hidden', { source: 'visibilitychange' })
    } else {
      persistSnapshot(store, { suspended: true })
    }
  }
}

function resolveStoresVisible() {
  const nowMs = Date.now()
  for (const store of stores.values()) {
    const hiddenAtMs = store.hiddenAtMs
    store.hiddenAtMs = null
    if (store.snapshot.status === 'idle' || store.snapshot.status === 'completed') continue
    if (!shouldResumeDwell(hiddenAtMs, nowMs)) {
      void completeStore(store, 'left_page', { source: 'resume_expired' })
      continue
    }
    systemResume(store, 'document_visible')
  }
}

function installBrowserListeners() {
  if (browserListenersInstalled || typeof window === 'undefined') return
  browserListenersInstalled = true
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      markStoresHidden()
      return
    }
    resolveStoresVisible()
  })
  const finalizeOnUnload = () => {
    for (const store of stores.values()) {
      if (
        store.unloadFinalized ||
        store.snapshot.status === 'idle' ||
        store.snapshot.status === 'completed'
      ) continue
      store.unloadFinalized = true
      stopTicker(store)
      settleRunning(store)
      store.hiddenAtMs = Date.now()
      persistSnapshot(store, { suspended: true })
      const record = isDwellSessionKey(store.key)
        ? buildCheckpointRecord(store)
        : buildRecord(store, 'left_page')
      store.finalRecord = record
      if (record && store.persistCompletionRecord) void fireAndQueueTimeRecordOnUnload(record)
      if (!isDwellSessionKey(store.key)) {
        if (store.storageKey) clearPersistedTimedSessionSnapshot(store.storageKey)
        store.snapshot = { ...store.snapshot, status: 'completed', pauseReason: null }
      }
    }
  }
  window.addEventListener('pagehide', finalizeOnUnload)
  window.addEventListener('beforeunload', finalizeOnUnload)
  subscribeLiveForegroundClock(syncStoresToLiveClockGate)
}

export function useTimedSession(options: TimedSessionOptions) {
  const sessionKey = stableSessionKey(options)
  const store = React.useMemo(() => getStore(sessionKey, options), [options, sessionKey])
  const attachmentIdRef = React.useRef<string>(createStableRecordId())
  const [, forceRender] = React.useState(0)
  const attachmentRef = React.useRef<TimerAttachment>({
    scene: options.automationScene ?? options.kind,
    kind: options.kind,
    title: options.title,
    active: true,
    palaceId: options.palaceId,
    sourceKind: options.sourceKind ?? null,
    englishCourseId: options.englishCourseId ?? null,
    routePath: options.routePath,
  })
  attachmentRef.current = {
    ...attachmentRef.current,
    scene: options.automationScene ?? options.kind,
    kind: options.kind,
    title: options.title,
    palaceId: options.palaceId,
    sourceKind: options.sourceKind ?? null,
    englishCourseId: options.englishCourseId ?? null,
    routePath: options.routePath,
  }

  React.useEffect(() => {
    const attachmentId = attachmentIdRef.current
    const listener = () => forceRender((value) => value + 1)
    store.listeners.add(listener)
    attachStore(store, attachmentId, {
      // The registry metadata above remains fixed to the first page; this
      // attachment carries only the current page's scene fragment.
      ...attachmentRef.current,
    })
    return () => {
      store.listeners.delete(listener)
      detachStore(store, attachmentId)
    }
  }, [store])

  React.useEffect(() => {
    syncAttachment(store, attachmentIdRef.current, attachmentRef.current)
  }, [
    options.automationScene,
    options.englishCourseId,
    options.kind,
    options.palaceId,
    options.routePath,
    options.sourceKind,
    options.title,
    store,
  ])

  const start = React.useCallback((meta?: TimedSessionMeta) => startStore(store, meta), [store])
  const pause = React.useCallback((meta?: TimedSessionMeta) => {
    const reason = meta?.reason === 'excluded_route' ? 'excluded_route' : 'manual'
    pauseStore(store, reason, meta)
  }, [store])
  const resume = React.useCallback((meta?: TimedSessionMeta) => resumeStore(store, meta), [store])
  const complete = React.useCallback((method: SessionCompletionMethod, meta?: TimedSessionMeta, options?: { persistRecord?: boolean }) => completeStore(store, method, meta, options), [store])
  const reset = React.useCallback(() => resetStore(store), [store])
  const setSceneActive = React.useCallback((active: boolean, meta?: TimedSessionMeta) => setSceneActiveStore(store, attachmentIdRef.current, active, meta), [store])
  const leaveScene = React.useCallback((meta?: TimedSessionMeta) => completeStore(store, 'left_page', meta), [store])
  const logEvent = React.useCallback((type: SessionEventRecord['type'], meta?: TimedSessionMeta) => {
    pushEvent(store, type, meta)
    persistSnapshot(store)
    notify(store)
  }, [store])
  const getEffectiveSeconds = React.useCallback(() => {
    updateEffectiveSnapshot(store)
    return store.snapshot.effectiveSeconds
  }, [store])

  return useStableTimedSessionController(buildTimedSessionController({
    sessionId: store.snapshot.sessionId,
    sessionKey: store.key,
    effectiveSeconds: store.snapshot.effectiveSeconds,
    pauseCount: store.snapshot.pauseCount,
    status: store.snapshot.status,
    pauseReason: store.snapshot.pauseReason,
    startedAt: store.snapshot.startedAt,
    glowState: store.snapshot.glowState,
    start,
    pause,
    resume,
    setSceneActive,
    leaveScene,
    logEvent,
    getEffectiveSeconds,
    complete,
    reset,
  }))
}

export function resetTimedSessionStoresForTests() {
  for (const store of stores.values()) {
    stopTicker(store)
    if (store.finalizeTimer != null && typeof window !== 'undefined') {
      window.clearTimeout(store.finalizeTimer)
    }
  }
  stores.clear()
}
