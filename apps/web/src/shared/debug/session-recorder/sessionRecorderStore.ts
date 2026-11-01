import { subscribeRequestOutcomes, type RequestOutcome } from '@/shared/api/requestOutcome'
import { generateLocalId } from '@/shared/lib/ids'
import { readAppLogs, subscribeAppLogs, type AppLogEntry } from '@/shared/logs/model/appLogs'
import { describeClickForRecorder } from './sessionRecorderCapture'
import { summarizeEditorDocChange } from './sessionRecorderDocDiff'
import {
  buildDiagnosisBrief,
  buildLastClickFocusBrief,
  DIAGNOSIS_DEFAULT_WINDOW_MINUTES,
  describeRequestStep,
  diagnosisWindowMs,
  filterRecentEvents,
  readClickedRecorderFocus,
  readRecorderFocus,
  describeRecorderPage,
  type RecorderFocus,
} from './sessionRecorderBrief'
import { buildSessionRecorderCopyText, formatSessionRecorderReport } from './sessionRecorderFormat'
import {
  LIVE_BRIEF_ID,
  SESSION_RECORDER_HISTORY_KEY,
  SESSION_RECORDER_LEGACY_HISTORY_KEY,
  SESSION_RECORDER_PRIVACY_MIGRATION_KEY,
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
let outcomeUnsub: (() => void) | null = null
let captureInstalled = false
let seenLogIds = new Set<string>()
let recentEvents: SessionRecorderEvent[] = []
// Snapshot taken at the last interactive click, so the copy reflects what the user was looking at then, not now.
let lastClick: { at: string; clickText: string; pageLabel: string; focus: RecorderFocus | null } | null = null

let state: SessionRecorderState = {
  recording: false,
  current: null,
  history: loadHistory(),
  dialogOpen: false,
  selectedId: null,
  viewingLive: false,
  liveReport: '',
  liveNotes: '',
}

function nowIso() {
  return new Date().toISOString()
}

function generateId() {
  return generateLocalId()
}

function currentRoute() {
  if (typeof window === 'undefined') return ''
  return describeRecorderPage(window.location.pathname)
}

function migrateRecorderStorage() {
  if (typeof window === 'undefined') return
  try {
    if (window.localStorage.getItem(SESSION_RECORDER_PRIVACY_MIGRATION_KEY) === 'v2') return
    window.localStorage.removeItem(SESSION_RECORDER_LEGACY_HISTORY_KEY)
    window.localStorage.setItem(SESSION_RECORDER_PRIVACY_MIGRATION_KEY, 'v2')
  } catch {
    // 存储不可用时保持内存空状态；下次加载会再次尝试清理旧记录。
  }
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
  migrateRecorderStorage()
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

function safeAction(kind: SessionRecorderEventKind, action: string) {
  const value = action.trim()
  if (kind === 'view' && value.startsWith('自动切到')) return '自动切换卡片'
  if (kind === 'route') return '路由变化'
  if (kind === 'click') return value === '输入敏感字段' ? value : value === '点击输入框' ? value : '点击控件'
  if (kind === 'menu') return value === '菜单' ? value : '菜单操作'
  if (kind === 'mindmap') return ['右键节点', '点击画布空白', '单击节点', '拖拽结束', '翻卡', '进入编辑', '返回学习'].includes(value) ? value : '导图操作'
  if (kind === 'doc') return '导图编辑'
  if (kind === 'error') return '应用错误'
  if (kind === 'ai') return 'AI操作'
  return value || '状态变化'
}

function safeDetail(kind: SessionRecorderEventKind, detail: string) {
  const value = detail.trim()
  if (!value) return ''
  if (kind === 'route') return describeRecorderPage(value)
  if (kind === 'doc' && /^(新增节点|删除节点|移动节点|修改节点) \d+$/.test(value)) return value
  if (kind === 'mindmap' && /^(翻开|收起) \d+ 项$/.test(value)) return value
  if (kind === 'step' && /^(成功|没有成功：|稍后会自动重试)/.test(value)) return value.slice(0, 100)
  if (kind === 'session' && /^只保留最近 \d+ 条$/.test(value)) return value
  return ''
}

function normalizeEvent(kind: SessionRecorderEventKind, action: string, detail = ''): Pick<SessionRecorderEvent, 'kind' | 'action' | 'detail'> {
  return { kind, action: safeAction(kind, action), detail: safeDetail(kind, detail) }
}

function remember(kind: SessionRecorderEventKind, action: string, detail = '') {
  const normalized = normalizeEvent(kind, action, detail)
  recentEvents = filterRecentEvents([
    ...recentEvents,
    { at: nowIso(), ...normalized },
  ])
}

function currentLiveReport(windowMs = diagnosisWindowMs(DIAGNOSIS_DEFAULT_WINDOW_MINUTES)) {
  const path = typeof window === 'undefined' ? '' : window.location.pathname
  return buildDiagnosisBrief({
    events: recentEvents,
    pageLabel: describeRecorderPage(path),
    focus: typeof document === 'undefined' ? null : readRecorderFocus(document),
    windowMs,
  })
}

function appendToCurrentSession(kind: SessionRecorderEventKind, action: string, detail = '') {
  if (!state.recording || !state.current) return
  const normalized = normalizeEvent(kind, action, detail)
  const last = state.current.events.at(-1)
  if (last && last.kind === normalized.kind && last.action === normalized.action) {
    const merged = mergeRepeatedDetail(last.detail, normalized.detail)
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
  state = {
    ...state,
    current: {
      ...state.current,
      events: capRecorderEvents([...state.current.events, { at: nowIso(), ...normalized }]),
    },
  }
  notify()
}

const OMITTED_EVENTS_ACTION = '较早的动作已省略'

/**
 * Keep the newest events. A long session loses its oldest actions behind one
 * marker; it must not lose the settlement or rating the learner just made.
 */
function capRecorderEvents(events: SessionRecorderEvent[]) {
  if (events.length <= SESSION_RECORDER_MAX_EVENTS) return events
  const hasMarker = events[0]?.kind === 'session' && events[0]?.action === OMITTED_EVENTS_ACTION
  const body = hasMarker ? events.slice(1) : events
  const marker: SessionRecorderEvent = hasMarker
    ? events[0]
    : {
      at: body[0]?.at ?? nowIso(),
      kind: 'session',
      action: OMITTED_EVENTS_ACTION,
      detail: `只保留最近 ${SESSION_RECORDER_MAX_EVENTS} 条`,
    }
  return [marker, ...body.slice(-(SESSION_RECORDER_MAX_EVENTS - 1))]
}

function appendEvent(kind: SessionRecorderEventKind, action: string, detail = '') {
  remember(kind, action, detail)
  appendToCurrentSession(kind, action, detail)
}

function onOutcome(outcome: RequestOutcome) {
  const step = describeRequestStep(outcome)
  appendEvent('step', step.action, step.detail)
}

function onWindowClick(event: Event) {
  const described = describeClickForRecorder(event)
  if (!described) return
  lastClick = {
    at: nowIso(),
    clickText: safeAction('click', described.action),
    pageLabel: describeRecorderPage(typeof window === 'undefined' ? '' : window.location.pathname),
    focus: readClickedRecorderFocus(event.target) ?? (typeof document === 'undefined' ? null : readRecorderFocus(document)),
  }
  appendEvent('click', described.action)
}

function ingestLog(entry: AppLogEntry) {
  if (seenLogIds.has(entry.id)) return
  seenLogIds.add(entry.id)
  if (entry.kind === 'app_error' && entry.feature === 'API 请求') return
  if (entry.kind === 'app_error') {
    appendEvent('error', '应用错误', entry.stage || '')
    return
  }
  appendEvent('ai', 'AI操作', entry.stage || '')
}

export function ensureSessionRecorderCapture() {
  if (captureInstalled) return
  captureInstalled = true
  seenLogIds = new Set(readAppLogs().map((entry) => entry.id))
  if (typeof window !== 'undefined') {
    window.addEventListener('click', onWindowClick, true)
    clickBound = true
  }
  logsUnsub = subscribeAppLogs(() => {
    readAppLogs().forEach(ingestLog)
  })
  outcomeUnsub = subscribeRequestOutcomes(onOutcome)
}

function uninstallCapture() {
  captureInstalled = false
  if (clickBound && typeof window !== 'undefined') {
    window.removeEventListener('click', onWindowClick, true)
    clickBound = false
  }
  logsUnsub?.()
  logsUnsub = null
  outcomeUnsub?.()
  outcomeUnsub = null
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
  if (selectedId) {
    setState({ dialogOpen: true, selectedId, viewingLive: false })
    return
  }
  setState({
    dialogOpen: true,
    selectedId: null,
    viewingLive: true,
    liveReport: currentLiveReport(),
  })
}

export async function copyRecentBriefToClipboard(windowMinutes: number = DIAGNOSIS_DEFAULT_WINDOW_MINUTES) {
  const text = buildSessionRecorderCopyText(currentLiveReport(diagnosisWindowMs(windowMinutes)), state.liveNotes)
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export async function copyLastClickFocusToClipboard() {
  const text = buildLastClickFocusBrief(lastClick)
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function closeSessionRecorderDialog() {
  setState({ dialogOpen: false })
}

export function selectSessionRecorderHistory(id: string) {
  if (!id || id === LIVE_BRIEF_ID) {
    setState({ selectedId: null, viewingLive: true, liveReport: currentLiveReport() })
    return
  }
  setState({ selectedId: id, viewingLive: false })
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
        detail: '',
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
    viewingLive: false,
  })
  ensureSessionRecorderCapture()
}

export function stopSessionRecording() {
  if (!state.recording || !state.current) {
    openSessionRecorderDialog()
    return
  }
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
    viewingLive: false,
    liveReport: state.liveReport,
    liveNotes: state.liveNotes,
  }
  notify()
}

export function recordSessionRecorderRoute(path: string) {
  const route = describeRecorderPage(path)
  if (!route) return
  const lastRoute = [...recentEvents].reverse().find((event) => event.kind === 'route')
  if (lastRoute?.detail !== route) remember('route', '路由变化', route)
  if (!state.recording || !state.current) return
  const last = state.current.routes.at(-1)
  if (last === route) return
  state.current = {
    ...state.current,
    routes: [...state.current.routes, route],
  }
  appendToCurrentSession('route', '路由变化', route)
}

export function recordSessionRecorderUiAction(kind: SessionRecorderEventKind, action: string, detail = '') {
  appendEvent(kind, action, detail)
}

/**
 * A change of what the user is looking at that the app made itself (feed
 * snapped to another card, settlement page opened or closed). `action` reads
 * as a sentence: 「自动切到第 3 张」.
 */
export function recordSessionRecorderView(action: string) {
  appendEvent('view', action)
}

export function recordMindMapDocumentChange(action: string, previous: unknown, next: unknown) {
  appendEvent('doc', `文档变更(${action})`, summarizeEditorDocChange(previous, next))
}

export function updateSelectedSessionRecorderNotes(notes: string) {
  if (state.viewingLive || !state.selectedId) {
    setState({ liveNotes: notes })
    return
  }
  const history = state.history.map((session) =>
    session.id === state.selectedId ? { ...session, notes } : session,
  )
  updateHistory(history)
}

export function updateSelectedSessionRecorderReport(reportText: string) {
  if (state.viewingLive || !state.selectedId) {
    setState({ liveReport: reportText })
    return
  }
  const history = state.history.map((session) =>
    session.id === state.selectedId ? { ...session, reportText } : session,
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
    viewingLive: history.length === 0,
    liveReport: history.length === 0 ? currentLiveReport() : state.liveReport,
  })
}

export function getSelectedSessionRecorder() {
  if (!state.selectedId) return null
  return state.history.find((session) => session.id === state.selectedId) ?? null
}

export function getSessionRecorderCopyText(session = getSelectedSessionRecorder()) {
  if (state.viewingLive || !session) {
    return buildSessionRecorderCopyText(state.liveReport, state.liveNotes)
  }
  return buildSessionRecorderCopyText(session.reportText, session.notes)
}

export function pinLiveBriefToHistory() {
  if (!state.viewingLive && state.selectedId) return state.selectedId
  const now = nowIso()
  const session: SessionRecorderSession = {
    id: generateId(),
    startedAt: now,
    endedAt: now,
    routes: [],
    events: [...recentEvents],
    notes: state.liveNotes,
    reportText: state.liveReport || currentLiveReport(),
  }
  const history = [session, ...state.history].slice(0, SESSION_RECORDER_MAX_HISTORY)
  persistHistory(history)
  state = {
    ...state,
    history,
    viewingLive: true,
    selectedId: null,
  }
  notify()
  return session.id
}

export function resetSessionRecorderForTest() {
  uninstallCapture()
  seenLogIds = new Set()
  recentEvents = []
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(SESSION_RECORDER_HISTORY_KEY)
    window.localStorage.removeItem(SESSION_RECORDER_LEGACY_HISTORY_KEY)
    window.localStorage.removeItem(SESSION_RECORDER_PRIVACY_MIGRATION_KEY)
  }
  state = {
    recording: false,
    current: null,
    history: [],
    dialogOpen: false,
    selectedId: null,
    viewingLive: false,
    liveReport: '',
    liveNotes: '',
  }
  notify()
}

export type { SessionRecorderEvent, SessionRecorderSession, SessionRecorderState }
