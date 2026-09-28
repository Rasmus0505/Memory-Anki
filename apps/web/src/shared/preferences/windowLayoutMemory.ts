import {
  CLIENT_PREFERENCES_UPDATED_EVENT,
  getClientPreferenceCacheStatus,
  saveClientPreference,
} from '@/shared/preferences/clientPreferences'
import { onAppEvent } from '@/shared/events/appEvents'

/** Aggregate client preference. Legacy per-window keys fold into this document. */
export const WINDOW_LAYOUTS_STORAGE_KEY = 'memory-anki.window-layouts.v1'
export const LEGACY_PALACE_LOOKUP_LAYOUT_KEY = 'memory-anki-quiz-memory-lookup-layout'
export const LEGACY_FLOATING_DIALOG_PREFIX = 'memory-anki-floating-dialog:'
export const LEGACY_TIMER_OVERLAY_LAYOUT_KEY = 'memory-anki-timer-overlay-layout'
export const LEGACY_ENGLISH_LOOKUP_CARD_KEY = 'memory-anki.english-lookup.card-state'

const MAX_FLOATING_DIALOGS = 40
const REMOTE_PERSIST_DELAY_MS = 400

export interface PalaceLookupWindowMemory {
  xRatio: number
  yRatio: number
  widthRatio: number
  heightRatio: number
  collapsed: boolean
  pinned: boolean
  listCollapsed: boolean
}

export interface FloatingDialogWindowMemory {
  xRatio: number
  yRatio: number
  widthRatio: number
  heightRatio: number | null
  collapsed: boolean
  pinned: boolean
}

export interface TimerOverlayWindowMemory {
  xRatio: number
  yRatio: number
  widthRatio: number
  heightRatio: number
  collapsed: boolean
  hidden: boolean
}

export interface EnglishLookupWindowMemory {
  widthRatio: number | null
  heightRatio: number | null
  oxfordHeight: string
  bingHeight: string
  collinsHeight: string
}

export interface WindowLayoutsDocument {
  palaceMemoryLookup: PalaceLookupWindowMemory | null
  floatingDialogs: Record<string, FloatingDialogWindowMemory>
  timerOverlay: TimerOverlayWindowMemory | null
  englishLookup: EnglishLookupWindowMemory | null
}

export function emptyWindowLayoutsDocument(): WindowLayoutsDocument {
  return {
    palaceMemoryLookup: null,
    floatingDialogs: {},
    timerOverlay: null,
    englishLookup: null,
  }
}

export function viewportRatio(part: number, whole: number, minimum = -1.5, maximum = 1.5) {
  if (!Number.isFinite(part) || !(whole > 0)) return 0
  const ratio = Math.round((part / whole) * 10000) / 10000
  return Math.min(maximum, Math.max(minimum, ratio))
}

export function pixelsFromRatio(ratio: number, whole: number) {
  if (!Number.isFinite(ratio) || !(whole > 0)) return 0
  return Math.round(ratio * whole)
}

export function currentViewportSize() {
  if (typeof window === 'undefined') return { width: 1280, height: 900 }
  const width = window.innerWidth > 0 ? window.innerWidth : 1280
  const height = window.innerHeight > 0 ? window.innerHeight : 900
  return { width, height }
}

let latest: WindowLayoutsDocument | null = null
let bridgeReady = false
let remoteTimer: number | null = null
let remotePending: WindowLayoutsDocument | null = null

function remotePersistAllowedByDefault() {
  const vitest = import.meta.env.VITEST
  if (vitest === true || vitest === 'true') return false
  return import.meta.env.MODE !== 'test'
}

let remotePersistEnabled = remotePersistAllowedByDefault()

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function finiteNumber(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function sanitizePalace(value: unknown): PalaceLookupWindowMemory | null {
  if (!isRecord(value)) return null
  if (!Number.isFinite(Number(value.widthRatio)) || !Number.isFinite(Number(value.heightRatio))) return null
  return {
    xRatio: viewportRatio(finiteNumber(value.xRatio, 0), 1),
    yRatio: viewportRatio(finiteNumber(value.yRatio, 0), 1),
    widthRatio: viewportRatio(finiteNumber(value.widthRatio, 0.5), 1, 0.05, 1.5),
    heightRatio: viewportRatio(finiteNumber(value.heightRatio, 0.5), 1, 0.05, 1.5),
    collapsed: Boolean(value.collapsed),
    pinned: Boolean(value.pinned),
    listCollapsed: Boolean(value.listCollapsed),
  }
}

function sanitizeFloating(value: unknown): FloatingDialogWindowMemory | null {
  if (!isRecord(value) || !Number.isFinite(Number(value.widthRatio))) return null
  const heightRatio = value.heightRatio == null || value.heightRatio === ''
    ? null
    : viewportRatio(finiteNumber(value.heightRatio, 0.5), 1, 0.05, 1.5)
  return {
    xRatio: viewportRatio(finiteNumber(value.xRatio, 0), 1),
    yRatio: viewportRatio(finiteNumber(value.yRatio, 0), 1),
    widthRatio: viewportRatio(finiteNumber(value.widthRatio, 0.5), 1, 0.05, 1.5),
    heightRatio,
    collapsed: Boolean(value.collapsed),
    pinned: Boolean(value.pinned),
  }
}

function sanitizeTimer(value: unknown): TimerOverlayWindowMemory | null {
  if (!isRecord(value) || !Number.isFinite(Number(value.widthRatio))) return null
  return {
    xRatio: viewportRatio(finiteNumber(value.xRatio, 0), 1),
    yRatio: viewportRatio(finiteNumber(value.yRatio, 0), 1),
    widthRatio: viewportRatio(finiteNumber(value.widthRatio, 0.2), 1, 0.05, 1.5),
    heightRatio: viewportRatio(finiteNumber(value.heightRatio, 0.2), 1, 0.05, 1.5),
    collapsed: Boolean(value.collapsed),
    hidden: Boolean(value.hidden),
  }
}

function sanitizeEnglish(value: unknown): EnglishLookupWindowMemory | null {
  if (!isRecord(value)) return null
  const widthRatio = value.widthRatio == null ? null : viewportRatio(finiteNumber(value.widthRatio, 0.3), 1, 0.05, 1.5)
  const heightRatio = value.heightRatio == null ? null : viewportRatio(finiteNumber(value.heightRatio, 0.5), 1, 0.05, 1.5)
  return {
    widthRatio,
    heightRatio,
    oxfordHeight: typeof value.oxfordHeight === 'string' ? value.oxfordHeight : 'HALF',
    bingHeight: typeof value.bingHeight === 'string' ? value.bingHeight : 'HALF',
    collinsHeight: typeof value.collinsHeight === 'string' ? value.collinsHeight : 'HALF',
  }
}

export function sanitizeWindowLayoutsDocument(value: unknown): WindowLayoutsDocument {
  const raw = isRecord(value) ? value : {}
  const floatingRaw = isRecord(raw.floatingDialogs) ? raw.floatingDialogs : {}
  const floatingDialogs: Record<string, FloatingDialogWindowMemory> = {}
  for (const [id, entry] of Object.entries(floatingRaw)) {
    if (!id || id.length > 80) continue
    const sanitized = sanitizeFloating(entry)
    if (sanitized) floatingDialogs[id] = sanitized
  }
  const ids = Object.keys(floatingDialogs)
  if (ids.length > MAX_FLOATING_DIALOGS) {
    for (const id of ids.slice(0, ids.length - MAX_FLOATING_DIALOGS)) {
      delete floatingDialogs[id]
    }
  }
  return {
    palaceMemoryLookup: sanitizePalace(raw.palaceMemoryLookup),
    floatingDialogs,
    timerOverlay: sanitizeTimer(raw.timerOverlay),
    englishLookup: sanitizeEnglish(raw.englishLookup),
  }
}

function isWindowLayoutsDocument(value: unknown): value is WindowLayoutsDocument {
  return isRecord(value)
}

function readAggregateLocal(): WindowLayoutsDocument | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(WINDOW_LAYOUTS_STORAGE_KEY)
    if (!raw) return null
    return sanitizeWindowLayoutsDocument(JSON.parse(raw))
  } catch {
    return null
  }
}

function writeAggregateLocal(document: WindowLayoutsDocument) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(WINDOW_LAYOUTS_STORAGE_KEY, JSON.stringify(document))
  } catch {
    // Preference mirrors must not block the window interaction that produced them.
  }
}

function documentHasMemory(document: WindowLayoutsDocument) {
  return Boolean(
    document.palaceMemoryLookup
    || document.timerOverlay
    || document.englishLookup
    || Object.keys(document.floatingDialogs).length > 0,
  )
}

function ensureBridge() {
  if (bridgeReady || typeof window === 'undefined') return
  bridgeReady = true
  onAppEvent(CLIENT_PREFERENCES_UPDATED_EVENT, (detail) => {
    if (!detail || !Object.prototype.hasOwnProperty.call(detail, 'window_layouts')) return
    const incoming = detail.window_layouts
    if (!isWindowLayoutsDocument(incoming)) return
    latest = sanitizeWindowLayoutsDocument(incoming)
    writeAggregateLocal(latest)
  })
  if (remotePersistEnabled) {
    window.addEventListener('pagehide', () => {
      flushWindowLayoutRemotePersist()
    })
  }
}

export function readWindowLayoutsDocument(): WindowLayoutsDocument {
  ensureBridge()
  const local = readAggregateLocal()
  if (latest) {
    if (!local) latest = null
    else return latest
  }
  const cached = getClientPreferenceCacheStatus('window_layouts', isWindowLayoutsDocument)
  if (cached.value && documentHasMemory(sanitizeWindowLayoutsDocument(cached.value))) {
    return sanitizeWindowLayoutsDocument(cached.value)
  }
  if (local && documentHasMemory(local)) return local
  return emptyWindowLayoutsDocument()
}

export function updateWindowLayouts(
  recipe: (current: WindowLayoutsDocument) => WindowLayoutsDocument,
): WindowLayoutsDocument {
  ensureBridge()
  const next = sanitizeWindowLayoutsDocument(recipe(readWindowLayoutsDocument()))
  latest = next
  writeAggregateLocal(next)
  scheduleRemote(next)
  return next
}

function scheduleRemote(document: WindowLayoutsDocument) {
  if (!remotePersistEnabled || typeof window === 'undefined') return
  remotePending = document
  if (remoteTimer != null) window.clearTimeout(remoteTimer)
  remoteTimer = window.setTimeout(() => {
    remoteTimer = null
    const pending = remotePending
    remotePending = null
    if (pending) void saveClientPreference('window_layouts', pending)
  }, REMOTE_PERSIST_DELAY_MS)
}

export function flushWindowLayoutRemotePersist() {
  if (!remotePersistEnabled || typeof window === 'undefined') return
  if (remoteTimer != null) window.clearTimeout(remoteTimer)
  remoteTimer = null
  const pending = remotePending
  remotePending = null
  if (pending) void saveClientPreference('window_layouts', pending)
}

export function resetWindowLayoutMemoryForTest() {
  latest = null
  remotePending = null
  if (remoteTimer != null && typeof window !== 'undefined') window.clearTimeout(remoteTimer)
  remoteTimer = null
  bridgeReady = false
}

export function setWindowLayoutRemotePersistEnabledForTest(enabled: boolean) {
  remotePersistEnabled = enabled
}

function rememberFloatingId(floatingDialogs: Record<string, FloatingDialogWindowMemory>, id: string, memory: FloatingDialogWindowMemory) {
  const next = { ...floatingDialogs }
  delete next[id]
  next[id] = memory
  return next
}

export function readFloatingDialogMemory(id: string) {
  return readWindowLayoutsDocument().floatingDialogs[id] ?? null
}

export function writeFloatingDialogMemory(id: string, memory: FloatingDialogWindowMemory) {
  if (!id) return
  updateWindowLayouts((current) => ({
    ...current,
    floatingDialogs: rememberFloatingId(current.floatingDialogs, id, memory),
  }))
}

export function readPalaceLookupMemory() {
  return readWindowLayoutsDocument().palaceMemoryLookup
}

export function writePalaceLookupMemory(memory: PalaceLookupWindowMemory) {
  updateWindowLayouts((current) => ({ ...current, palaceMemoryLookup: memory }))
}

export function readTimerOverlayMemory() {
  return readWindowLayoutsDocument().timerOverlay
}

export function writeTimerOverlayMemory(memory: TimerOverlayWindowMemory) {
  updateWindowLayouts((current) => ({ ...current, timerOverlay: memory }))
}

export function readEnglishLookupMemory() {
  return readWindowLayoutsDocument().englishLookup
}

export function writeEnglishLookupMemory(memory: EnglishLookupWindowMemory) {
  updateWindowLayouts((current) => ({
    ...current,
    englishLookup: {
      widthRatio: memory.widthRatio,
      heightRatio: memory.heightRatio,
      oxfordHeight: memory.oxfordHeight,
      bingHeight: memory.bingHeight,
      collinsHeight: memory.collinsHeight,
    },
  }))
}

function legacyRatio(part: unknown, whole: number, minimum = 0.05) {
  const parsed = Number(part)
  if (!Number.isFinite(parsed)) return null
  return viewportRatio(parsed, whole, minimum, 1.5)
}

function foldLegacyPalace(document: WindowLayoutsDocument, viewport: { width: number; height: number }) {
  if (document.palaceMemoryLookup || typeof window === 'undefined') return document
  try {
    const raw = window.localStorage.getItem(LEGACY_PALACE_LOOKUP_LAYOUT_KEY)
    if (!raw) return document
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const widthRatio = legacyRatio(parsed.width, viewport.width)
    const heightRatio = legacyRatio(parsed.height, viewport.height)
    if (widthRatio == null || heightRatio == null) return document
    return {
      ...document,
      palaceMemoryLookup: sanitizePalace({
        xRatio: legacyRatio(parsed.x, viewport.width, -1.5),
        yRatio: legacyRatio(parsed.y, viewport.height, -1.5),
        widthRatio,
        heightRatio,
        collapsed: parsed.collapsed,
      }),
    }
  } catch {
    return document
  }
}

function foldLegacyTimer(document: WindowLayoutsDocument, viewport: { width: number; height: number }) {
  if (document.timerOverlay || typeof window === 'undefined') return document
  try {
    const raw = window.localStorage.getItem(LEGACY_TIMER_OVERLAY_LAYOUT_KEY)
    if (!raw) return document
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const widthRatio = legacyRatio(parsed.width, viewport.width)
    const heightRatio = legacyRatio(parsed.height, viewport.height)
    if (widthRatio == null || heightRatio == null) return document
    return {
      ...document,
      timerOverlay: sanitizeTimer({
        xRatio: legacyRatio(parsed.x, viewport.width, -1.5),
        yRatio: legacyRatio(parsed.y, viewport.height, -1.5),
        widthRatio,
        heightRatio,
        collapsed: parsed.collapsed,
        hidden: parsed.hidden,
      }),
    }
  } catch {
    return document
  }
}

function foldLegacyEnglish(document: WindowLayoutsDocument) {
  if (document.englishLookup || typeof window === 'undefined') return document
  try {
    const raw = window.localStorage.getItem(LEGACY_ENGLISH_LOOKUP_CARD_KEY)
    if (!raw) return document
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      ...document,
      englishLookup: sanitizeEnglish({
        widthRatio: null,
        heightRatio: null,
        oxfordHeight: parsed.oxfordHeight,
        bingHeight: parsed.bingHeight,
        collinsHeight: parsed.collinsHeight,
      }),
    }
  } catch {
    return document
  }
}

function foldLegacyFloatingDialogs(document: WindowLayoutsDocument, viewport: { width: number; height: number }) {
  if (typeof window === 'undefined') return document
  const floatingDialogs = { ...document.floatingDialogs }
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (!key?.startsWith(LEGACY_FLOATING_DIALOG_PREFIX)) continue
    const id = key.slice(LEGACY_FLOATING_DIALOG_PREFIX.length)
    if (!id || floatingDialogs[id]) continue
    try {
      const parsed = JSON.parse(window.localStorage.getItem(key) || '') as Record<string, unknown>
      const widthRatio = Number.isFinite(Number(parsed.widthRatio))
        ? Number(parsed.widthRatio)
        : legacyRatio(parsed.width, viewport.width)
      if (widthRatio == null) continue
      const heightRatio = parsed.height == null && parsed.heightRatio == null
        ? null
        : Number.isFinite(Number(parsed.heightRatio))
          ? Number(parsed.heightRatio)
          : legacyRatio(parsed.height, viewport.height)
      const memory = sanitizeFloating({
        xRatio: Number.isFinite(Number(parsed.xRatio)) ? Number(parsed.xRatio) : legacyRatio(parsed.x, viewport.width, -1.5),
        yRatio: Number.isFinite(Number(parsed.yRatio)) ? Number(parsed.yRatio) : legacyRatio(parsed.y, viewport.height, -1.5),
        widthRatio,
        heightRatio,
        collapsed: parsed.collapsed,
        pinned: parsed.pinned,
      })
      if (memory) floatingDialogs[id] = memory
    } catch {
      // Skip unreadable legacy dialog layouts.
    }
  }
  return { ...document, floatingDialogs }
}

function clearLegacyWindowLayoutKeys() {
  if (typeof window === 'undefined') return
  const keys: string[] = []
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (key?.startsWith(LEGACY_FLOATING_DIALOG_PREFIX)) keys.push(key)
  }
  keys.push(LEGACY_PALACE_LOOKUP_LAYOUT_KEY, LEGACY_TIMER_OVERLAY_LAYOUT_KEY, LEGACY_ENGLISH_LOOKUP_CARD_KEY)
  for (const key of keys) window.localStorage.removeItem(key)
}

export async function migrateLegacyWindowLayouts() {
  ensureBridge()
  const viewport = currentViewportSize()
  let folded = readWindowLayoutsDocument()
  folded = foldLegacyPalace(folded, viewport)
  folded = foldLegacyTimer(folded, viewport)
  folded = foldLegacyEnglish(folded)
  folded = foldLegacyFloatingDialogs(folded, viewport)
  if (!documentHasMemory(folded)) return folded
  latest = folded
  writeAggregateLocal(folded)
  if (!remotePersistEnabled) return folded
  const saved = await saveClientPreference('window_layouts', folded)
  if (saved.persisted) clearLegacyWindowLayoutKeys()
  return folded
}
