import { isMacOs } from '@xyflow/system'

/**
 * Same speed React Flow uses for panOnScroll (default 0.5).
 * Edit cards and the empty pane must move the same distance per notch,
 * or the wheel feels like it sticks every time it crosses a card.
 */
export const MINDMAP_PAN_ON_SCROLL_SPEED = 0.5

/**
 * Edit cards keep `nopan` so a drag starts on the shell, not the text.
 * React Flow also treats `nopan` / `nowheel` as "ignore this wheel", which
 * makes edit mode feel stuck or stepped compared with readonly review.
 * A wheel on those elements is still a request to move the map.
 */
export function elementBlocksMindMapWheelPan(target: EventTarget | null): boolean {
  const element = target instanceof Element
    ? target
    : target instanceof Node
      ? target.parentElement
      : null
  return Boolean(element?.closest('.nopan, .nowheel'))
}

export function mindMapWheelPanDelta(
  event: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode' | 'shiftKey'>,
  options?: { mac?: boolean },
): { x: number; y: number } {
  const scale = event.deltaMode === 1 ? 20 : 1
  let deltaX = event.deltaX * scale
  let deltaY = event.deltaY * scale
  // Windows shift+wheel is horizontal, matching React Flow's panOnScroll.
  const mac = options?.mac ?? isMacOs()
  if (!mac && event.shiftKey) {
    deltaX = event.deltaY * scale
    deltaY = 0
  }
  const x = -deltaX * MINDMAP_PAN_ON_SCROLL_SPEED
  const y = -deltaY * MINDMAP_PAN_ON_SCROLL_SPEED
  return {
    x: x === 0 ? 0 : x,
    y: y === 0 ? 0 : y,
  }
}
