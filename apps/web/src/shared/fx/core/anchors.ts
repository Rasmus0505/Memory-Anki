import type { Point } from '../particles/particleModel'

/**
 * Named landing spots for effects. Elements opt in with `data-fx-anchor`, so effect
 * code never depends on test ids or component internals. Resolution happens every
 * frame for homing particles, so a target that moves or unmounts is handled.
 */
export const FX_ANCHORS = {
  /** The whole round progress rail. */
  progressRail: 'progress-rail',
  /** The rail segment of the card being viewed. */
  progressViewing: 'progress-viewing',
  /** Per-card flip counter (x/y). */
  flipBadge: 'flip-badge',
  /** Round-end exam/growth summary block. */
  roundSummary: 'round-summary',
  /** Round-end XP bar. */
  xpBar: 'xp-bar',
  /** HUD level ring. */
  levelRing: 'level-ring',
  /** Feed pager (page-turn dust). */
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

/** A live target for homing particles: re-resolved every call. */
export function anchorTarget(names: FxAnchorName | readonly FxAnchorName[], scope?: ParentNode | null) {
  return () => elementCenter(findAnchor(names, scope))
}

/** Where round progress lands: the viewing segment, else the whole rail. */
export const PROGRESS_TARGET = [FX_ANCHORS.progressViewing, FX_ANCHORS.progressRail] as const
