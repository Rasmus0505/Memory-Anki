interface Point {
  x: number
  y: number
}

/**
 * Named feedback targets. Elements opt in with `data-fx-anchor`, so effect code never
 * depends on test ids or component internals.
 */
export const FX_ANCHORS = {
  /** The whole round progress rail. */
  progressRail: 'progress-rail',
  /** The rail segment of the card being viewed. */
  progressViewing: 'progress-viewing',
  /** Per-card flip counter (x/y). */
  flipBadge: 'flip-badge',
  /** Round-end summary block. */
  roundSummary: 'round-summary',
  /** Feed pager (page-turn feedback). */
  feedPager: 'feed-pager',
} as const

export type FxAnchorName = (typeof FX_ANCHORS)[keyof typeof FX_ANCHORS]

export function fxAnchor(name: FxAnchorName) {
  return { 'data-fx-anchor': name } as const
}

function selector(name: string) {
  return `[data-fx-anchor="${name}"]`
}

function visible(element: Element | null | undefined): element is Element {
  if (!element?.isConnected) return false
  const rect = element.getBoundingClientRect()
  return rect.width > 0 || rect.height > 0
}

/** First visible anchor among `names`, searched inside `scope` when given. */
export function findAnchor(names: FxAnchorName | readonly FxAnchorName[], scope?: ParentNode | null): Element | null {
  if (typeof document === 'undefined') return null
  const list = typeof names === 'string' ? [names] : names
  const root = scope ?? document
  for (const name of list) {
    const found = Array.from(root.querySelectorAll(selector(name))).find(visible)
    if (found) return found
  }
  return null
}

export function elementCenter(element: Element | null | undefined): Point | null {
  if (!visible(element)) return null
  const rect = element.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

/** Where round progress lands: the viewing segment, else the whole rail. */
export const PROGRESS_TARGET = [FX_ANCHORS.progressViewing, FX_ANCHORS.progressRail] as const
