import { LOOKUP_PANEL_WIDTH } from './types'

const MARGIN = 8

export function clampPanelLeft(left: number, width = LOOKUP_PANEL_WIDTH): number {
  const max = Math.max(MARGIN, window.innerWidth - width - MARGIN)
  return Math.min(max, Math.max(MARGIN, left))
}

export function clampPanelTop(top: number): number {
  const max = Math.max(MARGIN, window.innerHeight - 120)
  return Math.min(max, Math.max(MARGIN, top))
}

export function panelMaxHeight(top: number): number {
  return Math.max(200, Math.floor(window.innerHeight * 0.7) - Math.max(0, top - MARGIN))
}

/** Prefer bottom-right of anchor rect; flip when near edges. */
export function positionNearRect(rect: DOMRect): {
  left: number
  top: number
  maxHeight: number
} {
  const width = LOOKUP_PANEL_WIDTH
  let left = rect.right + 4
  let top = rect.bottom + 4
  if (left + width > window.innerWidth - MARGIN) {
    left = rect.left - width - 4
  }
  if (left < MARGIN) left = MARGIN
  if (top + 280 > window.innerHeight - MARGIN) {
    top = rect.top - 12
  }
  top = clampPanelTop(top)
  left = clampPanelLeft(left, width)
  return { left, top, maxHeight: panelMaxHeight(top) }
}

export function positionNearPoint(clientX: number, clientY: number) {
  return positionNearRect(
    new DOMRect(clientX, clientY, 0, 0),
  )
}

export function positionAnchorNearSelection(range: Range): { left: number; top: number } {
  const rect = range.getBoundingClientRect()
  const left = clampPanelLeft(rect.right + 4, 40)
  const top = clampPanelTop(rect.bottom + 4)
  return { left, top }
}
