import {
  currentViewportSize,
  pixelsFromRatio,
  readFloatingDialogMemory,
  viewportRatio,
  writeFloatingDialogMemory,
  type FloatingDialogWindowMemory,
} from '@/shared/preferences/windowLayoutMemory'

export interface FloatingDialogLayout {
  x: number
  y: number
  width: number
  height: number | null
  collapsed: boolean
  pinned: boolean
}

export interface FloatingDialogRemember {
  size?: boolean
  position?: boolean
}

export const FLOATING_DIALOG_STORAGE_PREFIX = 'memory-anki-floating-dialog:'
export const FLOATING_DIALOG_MIN_WIDTH = 320
export const FLOATING_DIALOG_MIN_HEIGHT = 180
export const FLOATING_DIALOG_VIEWPORT_PADDING = 16
export const FLOATING_DIALOG_LEGACY_DEFAULT_WIDTH = 820
const FLOATING_DIALOG_AUTO_HEIGHT_FALLBACK = 400

/** The widest box the floating panel can ever express: the viewport minus both gutters. */
export function floatingDialogMaxWidth(viewportWidth: number) {
  return Math.max(FLOATING_DIALOG_MIN_WIDTH, viewportWidth - FLOATING_DIALOG_VIEWPORT_PADDING * 2)
}

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

/**
 * `w-[min(92vw,1440px)]` / `max-w-[94vw]` / `w-[min(68rem,calc(100vw-2rem))]` — a width the
 * floating panel cannot honor, because it is placed at absolute pixels with a
 * viewport-minus-padding cap.
 */
function hasViewportRelativeWidthToken(className: string) {
  const tokens = className.split(/\s+/)
  return tokens.some((token) => {
    if (token === 'max-w-none') return false
    if (!/^(w|max-w|min-w)-\[/.test(token)) return false
    // Only width-bearing relative units count; a `min-h-[...]`-style token can
    // never reach here, and `calc(100% - 2rem)` still resolves against the
    // floating box, so it is left to the clamp.
    return /vw|dvw|calc\(|100%/.test(token)
  })
}

/**
 * Whether a dialog must fall back to the centered layout instead of the floating
 * panel.
 *
 * `requestedWidth` is an *explicit* request only (`defaultWidth` prop or a
 * recognized `max-w-*` token) — pass `null` when the dialog simply inherited the
 * 820px default, because the floating panel handles that case by clamping, and
 * deferring would strand ordinary dialogs on narrow viewports.
 *
 * Clamping only ever reaches `viewport - 32px`, so the realistic trigger is not an
 * absurd number — it is a panel that asks for nearly the whole viewport. At
 * 1825px wide, `w-[min(68rem,…)]` is "only" 1088px (under the 1793px cap) and
 * still floated correctly; but `max-w-[min(92vw,1180px)]` resolves near the cap,
 * and `min(92vw,1440px)` overshoots it outright. The panel then renders narrower
 * than its own content, and worse, it is placed at the remembered pixel position,
 * which strands it off-center. The centered layout honors the class exactly and
 * is centered by construction.
 *
 * Only an explicit `floating` prop overrides this.
 */
export function shouldDeferDialogToCenteredLayout({
  className,
  requestedWidth,
}: {
  className?: string
  requestedWidth?: number | null
}): boolean {
  if (className && hasViewportRelativeWidthToken(className)) return true
  if (requestedWidth == null) return false
  return requestedWidth > floatingDialogMaxWidth(getViewportSize().width)
}

function getViewportSize() {
  return currentViewportSize()
}

function floatingDialogId(storageKey: string) {
  return storageKey.startsWith(FLOATING_DIALOG_STORAGE_PREFIX)
    ? storageKey.slice(FLOATING_DIALOG_STORAGE_PREFIX.length)
    : storageKey
}

function memoryFromLegacyLocal(storageKey: string): FloatingDialogWindowMemory | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<FloatingDialogLayout & FloatingDialogWindowMemory>
    const viewport = getViewportSize()
    const widthRatio = typeof parsed.widthRatio === 'number'
      ? parsed.widthRatio
      : typeof parsed.width === 'number'
        ? viewportRatio(parsed.width, viewport.width, 0.05, 1.5)
        : null
    if (widthRatio == null) return null
    const heightRatio = parsed.heightRatio === null || parsed.height == null
      ? (typeof parsed.heightRatio === 'number' ? parsed.heightRatio : null)
      : typeof parsed.heightRatio === 'number'
        ? parsed.heightRatio
        : viewportRatio(parsed.height, viewport.height, 0.05, 1.5)
    return {
      xRatio: typeof parsed.xRatio === 'number' ? parsed.xRatio : viewportRatio(parsed.x ?? 0, viewport.width, -1.5, 1.5),
      yRatio: typeof parsed.yRatio === 'number' ? parsed.yRatio : viewportRatio(parsed.y ?? 0, viewport.height, -1.5, 1.5),
      widthRatio,
      heightRatio,
      collapsed: Boolean(parsed.collapsed),
      pinned: Boolean(parsed.pinned),
    }
  } catch {
    return null
  }
}

function rememberedFloatingMemory(storageKey: string) {
  return readFloatingDialogMemory(floatingDialogId(storageKey)) ?? memoryFromLegacyLocal(storageKey)
}

export function clampLayout(layout: FloatingDialogLayout): FloatingDialogLayout {
  return clampLayoutWithMeasure(layout)
}

function clampLayoutWithMeasure(
  layout: FloatingDialogLayout,
  measuredHeight?: number,
): FloatingDialogLayout {
  const viewport = getViewportSize()
  const maxWidth = floatingDialogMaxWidth(viewport.width)
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
    floatingDialogMaxWidth(viewport.width),
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
 * Width and height come from the remembered viewport ratios.
 */
export function readStoredFloatingLayout(
  storageKey: string,
  defaultWidth = FLOATING_DIALOG_LEGACY_DEFAULT_WIDTH,
): FloatingDialogLayout {
  if (typeof window === 'undefined') return createDefaultFloatingLayout(defaultWidth)
  const remembered = rememberedFloatingMemory(storageKey)
  if (!remembered) return createDefaultFloatingLayout(defaultWidth)
  const viewport = getViewportSize()
  const width = pixelsFromRatio(remembered.widthRatio, viewport.width)
  const storedWidth = width === FLOATING_DIALOG_LEGACY_DEFAULT_WIDTH && defaultWidth !== FLOATING_DIALOG_LEGACY_DEFAULT_WIDTH
    ? defaultWidth
    : width
  return createCenteredFloatingLayout({
    width: storedWidth,
    height: remembered.heightRatio == null ? null : pixelsFromRatio(remembered.heightRatio, viewport.height),
    collapsed: remembered.collapsed,
    pinned: remembered.pinned,
  })
}

export function hasRememberedFloatingSize(storageKey: string) {
  return rememberedFloatingMemory(storageKey) != null
}

/** Reapply the remembered size ratios after the viewport changes without rewriting them. */
export function applyRememberedFloatingSize(storageKey: string, layout: FloatingDialogLayout) {
  const remembered = rememberedFloatingMemory(storageKey)
  if (!remembered) return clampLayout(layout)
  const viewport = getViewportSize()
  return clampLayout({
    ...layout,
    width: pixelsFromRatio(remembered.widthRatio, viewport.width),
    height: remembered.heightRatio == null ? layout.height : pixelsFromRatio(remembered.heightRatio, viewport.height),
  })
}

export function writeStoredFloatingLayout(
  storageKey: string,
  layout: FloatingDialogLayout,
  remember: FloatingDialogRemember = {},
) {
  if (typeof window === 'undefined') return
  const id = floatingDialogId(storageKey)
  const previous = rememberedFloatingMemory(storageKey)
  const viewport = getViewportSize()
  const rememberSize = remember.size === true
  const rememberPosition = remember.position === true
  const seeded = !previous
  const next: FloatingDialogWindowMemory = {
    xRatio: rememberPosition || seeded
      ? viewportRatio(layout.x, viewport.width, -1.5, 1.5)
      : previous.xRatio,
    yRatio: rememberPosition || seeded
      ? viewportRatio(layout.y, viewport.height, -1.5, 1.5)
      : previous.yRatio,
    widthRatio: rememberSize || seeded
      ? viewportRatio(layout.width, viewport.width, 0.05, 1.5)
      : previous.widthRatio,
    heightRatio: layout.height == null
      ? (rememberSize || seeded ? null : previous.heightRatio)
      : (rememberSize || seeded || previous.heightRatio == null
        ? viewportRatio(layout.height, viewport.height, 0.05, 1.5)
        : previous.heightRatio),
    collapsed: layout.collapsed,
    pinned: layout.pinned,
  }
  writeFloatingDialogMemory(id, next)
  try {
    window.localStorage.setItem(storageKey, JSON.stringify({ ...layout, ...next }))
  } catch {
    // 本地偏好写入失败不应影响弹窗使用。
  }
}
