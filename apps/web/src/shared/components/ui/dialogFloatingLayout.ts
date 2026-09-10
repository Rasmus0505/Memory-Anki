export interface FloatingDialogLayout {
  x: number
  y: number
  width: number
  height: number | null
  collapsed: boolean
  pinned: boolean
}

export const FLOATING_DIALOG_STORAGE_PREFIX = 'memory-anki-floating-dialog:'
export const FLOATING_DIALOG_MIN_WIDTH = 320
export const FLOATING_DIALOG_MIN_HEIGHT = 180
export const FLOATING_DIALOG_VIEWPORT_PADDING = 16
export const FLOATING_DIALOG_LEGACY_DEFAULT_WIDTH = 820
const FLOATING_DIALOG_AUTO_HEIGHT_FALLBACK = 400

const TAILWIND_MAX_WIDTHS: Array<[string, number]> = [
  ['max-w-7xl', 1280],
  ['max-w-6xl', 1152],
  ['max-w-5xl', 1024],
  ['max-w-4xl', 896],
  ['max-w-3xl', 768],
  ['max-w-2xl', 672],
  ['max-w-xl', 576],
  ['max-w-lg', 512],
  ['max-w-md', 448],
  ['max-w-sm', 384],
  ['max-w-xs', 320],
]

export function inferWidthFromClassName(className?: string): number | null {
  if (!className) return null
  const tokens = new Set(className.split(/\s+/))
  for (const [token, width] of TAILWIND_MAX_WIDTHS) {
    if (tokens.has(token)) return width
  }
  return null
}

function getViewportSize() {
  if (typeof window === 'undefined') {
    return { width: 1024, height: 768 }
  }
  return { width: window.innerWidth, height: window.innerHeight }
}

export function clampLayout(layout: FloatingDialogLayout): FloatingDialogLayout {
  return clampLayoutWithMeasure(layout)
}

function clampLayoutWithMeasure(
  layout: FloatingDialogLayout,
  measuredHeight?: number,
): FloatingDialogLayout {
  const viewport = getViewportSize()
  const maxWidth = Math.max(FLOATING_DIALOG_MIN_WIDTH, viewport.width - FLOATING_DIALOG_VIEWPORT_PADDING * 2)
  const maxHeight = Math.max(FLOATING_DIALOG_MIN_HEIGHT, viewport.height - FLOATING_DIALOG_VIEWPORT_PADDING * 2)
  const width = Math.min(Math.max(layout.width, FLOATING_DIALOG_MIN_WIDTH), maxWidth)
  const height = layout.height == null ? null : Math.min(Math.max(layout.height, FLOATING_DIALOG_MIN_HEIGHT), maxHeight)
  const measured = measuredHeight && measuredHeight >= 80 ? measuredHeight : null
  const effectiveHeight = height ?? measured ?? Math.min(FLOATING_DIALOG_AUTO_HEIGHT_FALLBACK, maxHeight)

  return {
    ...layout,
    width,
    height,
    x: Math.min(Math.max(layout.x, FLOATING_DIALOG_VIEWPORT_PADDING), viewport.width - width - FLOATING_DIALOG_VIEWPORT_PADDING),
    y: Math.min(Math.max(layout.y, FLOATING_DIALOG_VIEWPORT_PADDING), viewport.height - effectiveHeight - FLOATING_DIALOG_VIEWPORT_PADDING),
  }
}

export function createCenteredFloatingLayout(
  partial?: Partial<Pick<FloatingDialogLayout, 'width' | 'height' | 'collapsed' | 'pinned'>> & {
    measuredHeight?: number
  },
): FloatingDialogLayout {
  const viewport = getViewportSize()
  const width = Math.min(
    partial?.width ?? FLOATING_DIALOG_LEGACY_DEFAULT_WIDTH,
    Math.max(FLOATING_DIALOG_MIN_WIDTH, viewport.width - FLOATING_DIALOG_VIEWPORT_PADDING * 2),
  )
  const height = partial?.height ?? null
  const measuredHeight = partial?.measuredHeight
  const effectiveHeight = height
    ?? (measuredHeight && measuredHeight >= 80 ? measuredHeight : null)
    ?? Math.min(FLOATING_DIALOG_AUTO_HEIGHT_FALLBACK, viewport.height - FLOATING_DIALOG_VIEWPORT_PADDING * 2)
  return clampLayoutWithMeasure({
    x: Math.max(FLOATING_DIALOG_VIEWPORT_PADDING, Math.round((viewport.width - width) / 2)),
    y: Math.max(
      FLOATING_DIALOG_VIEWPORT_PADDING,
      Math.round((viewport.height - effectiveHeight) / 2),
    ),
    width,
    height,
    collapsed: Boolean(partial?.collapsed),
    pinned: Boolean(partial?.pinned),
  }, measuredHeight)
}

function createDefaultFloatingLayout(defaultWidth = FLOATING_DIALOG_LEGACY_DEFAULT_WIDTH): FloatingDialogLayout {
  return createCenteredFloatingLayout({ width: defaultWidth })
}

/**
 * Restore size/pin/collapsed from storage, but always re-center x/y on open
 * so dialogs do not reappear skewed from a previous drag.
 */
export function readStoredFloatingLayout(
  storageKey: string,
  defaultWidth = FLOATING_DIALOG_LEGACY_DEFAULT_WIDTH,
): FloatingDialogLayout {
  if (typeof window === 'undefined') return createDefaultFloatingLayout(defaultWidth)
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return createDefaultFloatingLayout(defaultWidth)
    const parsed = JSON.parse(raw) as Partial<FloatingDialogLayout>
    if (typeof parsed.width !== 'number') {
      return createDefaultFloatingLayout(defaultWidth)
    }
    const storedWidth = parsed.width === FLOATING_DIALOG_LEGACY_DEFAULT_WIDTH && defaultWidth !== FLOATING_DIALOG_LEGACY_DEFAULT_WIDTH
      ? defaultWidth
      : parsed.width
    return createCenteredFloatingLayout({
      width: storedWidth,
      height: typeof parsed.height === 'number' ? parsed.height : null,
      collapsed: Boolean(parsed.collapsed),
      pinned: Boolean(parsed.pinned),
    })
  } catch {
    return createDefaultFloatingLayout(defaultWidth)
  }
}

export function writeStoredFloatingLayout(storageKey: string, layout: FloatingDialogLayout) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(layout))
  } catch {
    // 本地偏好写入失败不应影响弹窗使用。
  }
}
