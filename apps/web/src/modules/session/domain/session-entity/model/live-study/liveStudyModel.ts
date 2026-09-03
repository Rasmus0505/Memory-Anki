import type { UnifiedTimerSnapshot } from '@/shared/components/session/desktopTimerBridge'

export const LIVE_STUDY_CLIENT_STORAGE_KEY = 'memory-anki.live-study.client-id'
export const LIVE_STUDY_SURFACES = [
  'idle',
  'freestyle',
  'palace_quiz',
  'mindmap_review',
  'english_course',
  'english_reading',
] as const

export type LiveStudySurface = (typeof LIVE_STUDY_SURFACES)[number]

export interface LiveStudyProjection {
  revision: number
  controllerClientId: string | null
  route: string
  surface: LiveStudySurface
  view: unknown
  timer: UnifiedTimerSnapshot | null
  updatedAt: string
}

export interface LiveStudyEnvelope {
  publisherClientId: string | null
  projection: LiveStudyProjection
}

export interface LiveStudyCommandInput {
  type?: 'publish' | 'hello'
  clientId: string
  operationId: string
  takeControl?: boolean
  route?: string | null
  surface?: LiveStudySurface
  view?: unknown
  timer?: UnifiedTimerSnapshot | null
}

export interface LiveStudyCommandResponse {
  accepted: boolean
  duplicate: boolean
  projection: LiveStudyProjection
}

const STUDY_FOLLOW_PREFIXES = ['/freestyle']
const STUDY_FOLLOW_PATTERNS = [
  /^\/palaces\/\d+$/,
  /^\/palaces\/\d+\/quiz$/,
  /^\/english\/listening\/courses\/\d+$/,
  /^\/english\/reading\/materials\/\d+$/,
]

export function emptyLiveStudyProjection(): LiveStudyProjection {
  return {
    revision: 0,
    controllerClientId: null,
    route: '',
    surface: 'idle',
    view: null,
    timer: null,
    updatedAt: '',
  }
}

export function isLiveStudySurface(value: unknown): value is LiveStudySurface {
  return typeof value === 'string' && (LIVE_STUDY_SURFACES as readonly string[]).includes(value)
}

export function liveStudySurfaceFromPath(pathname: string): LiveStudySurface | null {
  const path = pathname.split('?')[0] || '/'
  if (path === '/freestyle' || path.startsWith('/freestyle/')) return 'freestyle'
  if (/^\/palaces\/\d+\/quiz$/.test(path)) return 'palace_quiz'
  if (/^\/palaces\/\d+$/.test(path)) return 'mindmap_review'
  if (/^\/english\/listening\/courses\/\d+$/.test(path)) return 'english_course'
  if (/^\/english\/reading\/materials\/\d+$/.test(path)) return 'english_reading'
  return null
}

export function isFollowableStudyPath(pathname: string) {
  if (pathname === '/' || pathname === '') return true
  if (STUDY_FOLLOW_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return true
  }
  return STUDY_FOLLOW_PATTERNS.some((pattern) => pattern.test(pathname))
}

export function shouldFollowLiveRoute(input: {
  localPath: string
  isController: boolean
  surface: LiveStudySurface
  route: string
}) {
  if (input.isController) return false
  if (input.surface === 'idle' || !input.route) return false
  const localPathname = input.localPath.split('?')[0] || '/'
  const remotePathname = input.route.split('?')[0] || '/'
  if (!isFollowableStudyPath(localPathname) || !isFollowableStudyPath(remotePathname)) return false
  return input.localPath !== input.route
}

function readString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function readNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function decodeLiveStudyProjection(raw: unknown): LiveStudyProjection {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const surfaceRaw = record.surface
  return {
    revision: readNumber(record.revision),
    controllerClientId:
      typeof record.controller_client_id === 'string'
        ? record.controller_client_id
        : typeof record.controllerClientId === 'string'
          ? record.controllerClientId
          : null,
    route: readString(record.route),
    surface: isLiveStudySurface(surfaceRaw) ? surfaceRaw : 'idle',
    view: 'view' in record ? record.view : null,
    timer:
      record.timer && typeof record.timer === 'object'
        ? (record.timer as UnifiedTimerSnapshot)
        : null,
    updatedAt: readString(record.updated_at) || readString(record.updatedAt),
  }
}

export function decodeLiveStudyEnvelope(raw: unknown): LiveStudyEnvelope {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    publisherClientId:
      typeof record.publisher_client_id === 'string'
        ? record.publisher_client_id
        : typeof record.publisherClientId === 'string'
          ? record.publisherClientId
          : null,
    projection: decodeLiveStudyProjection(record.projection),
  }
}

export function encodeLiveStudyCommand(input: LiveStudyCommandInput) {
  const payload: Record<string, unknown> = {
    type: input.type ?? 'publish',
    client_id: input.clientId,
    operation_id: input.operationId,
  }
  if (input.takeControl != null) payload.take_control = input.takeControl
  if (input.route !== undefined) payload.route = input.route
  if (input.surface !== undefined) payload.surface = input.surface
  if (input.view !== undefined) payload.view = input.view
  if (input.timer !== undefined) payload.timer = input.timer
  return payload
}

export function interpolateTimerSeconds(timer: UnifiedTimerSnapshot, now = Date.now()) {
  const base = Math.max(0, Math.round(timer.effectiveSeconds ?? timer.displaySeconds ?? 0))
  const running = timer.status === 'running' || timer.semanticState === 'running'
  if (!running) return base
  const elapsed = Math.max(0, Math.round((now - timer.updatedAt) / 1000))
  return base + elapsed
}

export function createLiveStudyClientId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `live-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function readLiveStudyClientId() {
  if (typeof window === 'undefined') return createLiveStudyClientId()
  try {
    const existing = window.sessionStorage.getItem(LIVE_STUDY_CLIENT_STORAGE_KEY)
    if (existing) return existing
    const created = createLiveStudyClientId()
    window.sessionStorage.setItem(LIVE_STUDY_CLIENT_STORAGE_KEY, created)
    return created
  } catch {
    return createLiveStudyClientId()
  }
}
