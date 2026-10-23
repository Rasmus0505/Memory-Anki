import type { EnglishDictationLayout } from '@/modules/settings/public'

export interface MaskRect {
  x: number
  y: number
  w: number
  h: number
}

export const DEFAULT_MASK_RECT: MaskRect = { x: 4, y: 62, w: 92, h: 34 }
export const FULL_WIDTH_MASK_RECT: MaskRect = { x: 0, y: 62, w: 100, h: 34 }
export const MIN_MASK_SIZE = 8

export const LAYOUT_LABELS: Record<EnglishDictationLayout, string> = {
  theater: '影视全屏',
  classic: '经典双栏',
  immersive: '沉浸单栏',
}

export const LAYOUT_ORDER: EnglishDictationLayout[] = ['theater', 'classic', 'immersive']

export const PLAYBACK_SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const

export function nextDictationLayout(current: EnglishDictationLayout): EnglishDictationLayout {
  const index = LAYOUT_ORDER.indexOf(current)
  return LAYOUT_ORDER[(index + 1) % LAYOUT_ORDER.length] || 'theater'
}

export function clampMaskRect(value: Partial<MaskRect> | null | undefined): MaskRect {
  const x = clampNumber(value?.x, 0, 100, DEFAULT_MASK_RECT.x)
  const y = clampNumber(value?.y, 0, 100, DEFAULT_MASK_RECT.y)
  const w = clampNumber(value?.w, MIN_MASK_SIZE, 100, DEFAULT_MASK_RECT.w)
  const h = clampNumber(value?.h, MIN_MASK_SIZE, 100, DEFAULT_MASK_RECT.h)
  return {
    x: Math.min(x, 100 - w),
    y: Math.min(y, 100 - h),
    w,
    h,
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}


export type MaskDragMode = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export function applyMaskDrag(
  rect: MaskRect,
  mode: MaskDragMode,
  deltaXPercent: number,
  deltaYPercent: number,
): MaskRect {
  if (mode === 'move') {
    return clampMaskRect({
      x: Math.min(100 - rect.w, Math.max(0, rect.x + deltaXPercent)),
      y: Math.min(100 - rect.h, Math.max(0, rect.y + deltaYPercent)),
      w: rect.w,
      h: rect.h,
    })
  }
  let x = rect.x
  let y = rect.y
  let w = rect.w
  let h = rect.h
  if (mode.includes('e')) w += deltaXPercent
  if (mode.includes('s')) h += deltaYPercent
  if (mode.includes('w')) {
    x += deltaXPercent
    w -= deltaXPercent
  }
  if (mode.includes('n')) {
    y += deltaYPercent
    h -= deltaYPercent
  }
  if (w < MIN_MASK_SIZE) {
    if (mode.includes('w')) x -= MIN_MASK_SIZE - w
    w = MIN_MASK_SIZE
  }
  if (h < MIN_MASK_SIZE) {
    if (mode.includes('n')) y -= MIN_MASK_SIZE - h
    h = MIN_MASK_SIZE
  }
  if (x < 0) {
    w += x
    x = 0
  }
  if (y < 0) {
    h += y
    y = 0
  }
  if (x + w > 100) w = 100 - x
  if (y + h > 100) h = 100 - y
  return clampMaskRect({ x, y, w, h })
}

export function maskStorageKey(courseId: number) {
  return `memory-anki-english-mask:${courseId}`
}

export function readMaskRect(courseId: number): MaskRect {
  if (typeof window === 'undefined') return DEFAULT_MASK_RECT
  try {
    const raw = window.localStorage.getItem(maskStorageKey(courseId))
    if (!raw) return DEFAULT_MASK_RECT
    return clampMaskRect(JSON.parse(raw) as Partial<MaskRect>)
  } catch {
    return DEFAULT_MASK_RECT
  }
}

export function writeMaskRect(courseId: number, rect: MaskRect) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(maskStorageKey(courseId), JSON.stringify(clampMaskRect(rect)))
  } catch {
    // Browsers can refuse storage in private mode; the mask still works this session.
  }
}

export function maskEnabledStorageKey(courseId: number) {
  return `memory-anki-english-mask-enabled:${courseId}`
}

export function readMaskEnabled(courseId: number, fallback: boolean) {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(maskEnabledStorageKey(courseId))
    if (raw == null) return fallback
    return raw === '1'
  } catch {
    return fallback
  }
}

export function writeMaskEnabled(courseId: number, enabled: boolean) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(maskEnabledStorageKey(courseId), enabled ? '1' : '0')
  } catch {
    // See writeMaskRect.
  }
}

export function formatClock(ms: number) {
  const totalSeconds = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function formatStudyDuration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest > 0 ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`
}

export function isTouchPrimaryInput() {
  if (typeof window === 'undefined') return false
  try {
    return (
      window.matchMedia?.('(pointer: coarse)').matches === true ||
      (navigator.maxTouchPoints || 0) > 1
    )
  } catch {
    return false
  }
}
