import { readAppLogs, subscribeAppLogs, type AppLogEntry } from '@/shared/logs/model/appLogs'
import { describeClickForRecorder } from './sessionRecorderCapture'
import { summarizeEditorDocChange } from './sessionRecorderDocDiff'
import { buildSessionRecorderCopyText, formatSessionRecorderReport } from './sessionRecorderFormat'
import {
  SESSION_RECORDER_HISTORY_KEY,
  SESSION_RECORDER_MAX_EVENTS,
  SESSION_RECORDER_MAX_HISTORY,
  type SessionRecorderEvent,
  type SessionRecorderEventKind,
  type SessionRecorderSession,
  type SessionRecorderState,
} from './sessionRecorderTypes'

type Listener = () => void

const listeners = new Set<Listener>()

let clickBound = false
let logsUnsub: (() => void) | null = null
let seenLogIds = new Set<string>()
let truncated = false

let state: SessionRecorderState = {
  recording: false,
  current: null,
  history: loadHistory(),
  dialogOpen: false,
  selectedId: null,
}

function nowIso() {
  return new Date().toISOString()
}

function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function currentRoute() {
  if (typeof window === 'undefined') return ''
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

function isSession(value: unknown): value is SessionRecorderSession {
  if (!value || typeof value !== 'object') return false
  const session = value as Partial<SessionRecorderSession>
  return (
    typeof session.id === 'string' &&
    typeof session.startedAt === 'string' &&
    Array.isArray(session.events) &&
    Array.isArray(session.routes) &&
    typeof session.notes === 'string' &&
    typeof session.reportText === 'string'
  )
}

function loadHistory(): SessionRecorderSession[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(SESSION_RECORDER_HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isSession).slice(0, SESSION_RECORDER_MAX_HISTORY)
  } catch {
    return []
  }
}

function persistHistory(history: SessionRecorderSession[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SESSION_RECORDER_HISTORY_KEY, JSON.stringify(history))
  } catch {
    // Ignore quota failures.
  }
}

function notify() {
  listeners.forEach((listener) => listener())
}

function setState(patch: Partial<SessionRecorderState>) {
  state = { ...state, ...patch }
  notify()
}

function updateHistory(history: SessionRecorderSession[]) {
  persistHistory(history)
  setState({ history })
}

function mergeRepeatedDetail(previous: string, next: string) {
  const previousBase = previous.replace(/ ×\d+$/, '')
  const nextBase = next.replace(/ ×\d+$/, '')
  if (!nextBase || previousBase !== nextBase) return null
  const match = previous.match(/ ×(\d+)$/)
  const count = (match ? Number(match[1]) : 1) + 1
  return `${nextBase} ×${count}`
}

function appendEvent(kind: SessionRecorderEventKind, action: string, detail = '') {
  if (!state.recording || !state.current) return
  const last = state.current.events.at(-1)
  if (last && last.kind === kind && last.action === action) {
    const merged = mergeRepeatedDetail(last.detail, detail)
    if (merged) {
      const events = state.current.events.slice(0, -1)
      events.push({ ...last, at: nowIso(), detail: merged })
      state = {
        ...state,
        current: { ...state.current, events },
      }
      notify()
      return
    }
  }
  if (state.current.events.length >= SESSION_RECORDER_MAX_EVENTS) {
    if (!truncated) {
      truncated = true
      state = {
        ...state,
        current: {
          ...state.current,
          events: [
            ...state.current.events,
            {
              at: nowIso(),
              kind: 'session',
              action: '事件过多',
              detail: `已截断到 ${SESSION_RECORDER_MAX_EVENTS} 条`,
            },
          ],
        },
      }
      notify()
    }
    return
  }
  state = {
    ...state,
    current: {
      ...state.current,
      events: [...state.current.events, { at: nowIso(), kind, action, detail }],
    },
  }
  notify()
}

function onWindowClick(event: Event) {
  const described = describeClickForRecorder(event)
  if (!described) return
  appendEvent('click', described.action, described.detail)
}

function ingestLog(entry: AppLogEntry) {
  if (seenLogIds.has(entry.id)) return
  seenLogIds.add(entry.id)
  if (!state.recording || !state.current) return
  if (Date.parse(entry.createdAt) < Date.parse(state.current.startedAt)) return
  if (entry.kind === 'app_error') {
    appendEvent('error', entry.feature || '错误', entry.errorMessage)
    return
  }
  appendEvent(
    'ai',
    entry.feature || 'AI',
    [entry.stage, entry.responseSummary || entry.errorMessage].filter(Boolean).join(' '),
  )
}

function installCapture() {
  uninstallCapture()
  truncated = false
  seenLogIds = new Set(readAppLogs().map((entry) => entry.id))
  if (typeof window !== 'undefined') {
    window.addEventListener('click', onWindowClick, true)
    clickBound = true
  }
  logsUnsub = subscribeAppLogs(() => {
    readAppLogs().forEach(ingestLog)
  })
}

function uninstallCapture() {
  if (clickBound && typeof window !== 'undefined') {
    window.removeEventListener('click', onWindowClick, true)
    clickBound = false
  }
  logsUnsub?.()
  logsUnsub = null
}

export function getSessionRecorderState() {
  return state
}

export function subscribeSessionRecorder(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function openSessionRecorderDialog(selectedId?: string | null) {
  const nextSelected = selectedId ?? state.selectedId ?? state.history[0]?.id ?? null
  setState({ dialogOpen: true, selectedId: nextSelected })
}

export function closeSessionRecorderDialog() {
  setState({ dialogOpen: false })
}

export function selectSessionRecorderHistory(id: string) {
  setState({ selectedId: id || null })
}

export function startSessionRecording() {
  if (state.recording) return
  const startedAt = nowIso()
  const route = currentRoute()
  const current: SessionRecorderSession = {
    id: generateId(),
    startedAt,
    endedAt: null,
    routes: route ? [route] : [],
    events: [
      {
        at: startedAt,
        kind: 'session',
        action: '开始录制',
        detail: route ? `页面 ${route}` : '',
      },
    ],
    notes: '',
    reportText: '',
  }
  setState({
    recording: true,
    current,
    dialogOpen: false,
    selectedId: null,
  })
  installCapture()
}

export function stopSessionRecording() {
  if (!state.recording || !state.current) {
    openSessionRecorderDialog()
    return
  }
  uninstallCapture()
  const endedAt = nowIso()
  const current = {
    ...state.current,
    endedAt,
    events: [
      ...state.current.events,
      { at: endedAt, kind: 'session' as const, action: '停止录制', detail: '' },
    ],
  }
  const finished: SessionRecorderSession = {
    ...current,
    reportText: formatSessionRecorderReport({
      startedAt: current.startedAt,
      endedAt,
      routes: current.routes,
      events: current.events,
    }),
  }
  const history = [finished, ...state.history].slice(0, SESSION_RECORDER_MAX_HISTORY)
  persistHistory(history)
  state = {
    recording: false,
    current: null,
    history,
    dialogOpen: true,
    selectedId: finished.id,
  }
  notify()
}

export function recordSessionRecorderRoute(path: string) {
  if (!state.recording || !state.current || !path) return
  const last = state.current.routes.at(-1)
  if (last === path) return
  state.current = {
    ...state.current,
    routes: [...state.current.routes, path],
  }
  appendEvent('route', '路由', last ? `${last} → ${path}` : path)
}

export function recordSessionRecorderUiAction(kind: SessionRecorderEventKind, action: string, detail = '') {
  appendEvent(kind, action, detail)
}

export function recordMindMapDocumentChange(action: string, previous: unknown, next: unknown) {
  if (!state.recording) return
  appendEvent('doc', `文档变更(${action})`, summarizeEditorDocChange(previous, next))
}

export function updateSelectedSessionRecorderNotes(notes: string) {
  const selectedId = state.selectedId
  if (!selectedId) return
  const history = state.history.map((session) =>
    session.id === selectedId ? { ...session, notes } : session,
  )
  updateHistory(history)
}

export function updateSelectedSessionRecorderReport(reportText: string) {
  const selectedId = state.selectedId
  if (!selectedId) return
  const history = state.history.map((session) =>
    session.id === selectedId ? { ...session, reportText } : session,
  )
  updateHistory(history)
}

export function deleteSelectedSessionRecorderHistory() {
  const selectedId = state.selectedId
  if (!selectedId) return
  const history = state.history.filter((session) => session.id !== selectedId)
  persistHistory(history)
  setState({
    history,
    selectedId: history[0]?.id ?? null,
  })
}

export function getSelectedSessionRecorder() {
  if (!state.selectedId) return null
  return state.history.find((session) => session.id === state.selectedId) ?? null
}

export function getSessionRecorderCopyText(session = getSelectedSessionRecorder()) {
  if (!session) return ''
  return buildSessionRecorderCopyText(session.reportText, session.notes)
}

export function resetSessionRecorderForTest() {
  uninstallCapture()
  truncated = false
  seenLogIds = new Set()
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(SESSION_RECORDER_HISTORY_KEY)
  }
  state = {
    recording: false,
    current: null,
    history: [],
    dialogOpen: false,
    selectedId: null,
  }
  notify()
}

export type { SessionRecorderEvent, SessionRecorderSession, SessionRecorderState }
