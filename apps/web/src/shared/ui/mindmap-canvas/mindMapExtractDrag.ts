export type ExtractDropMode = 'before' | 'inside' | 'after'
export type ExtractDropTarget = { targetId: string; mode: ExtractDropMode }

export const EXTRACT_DRAG_THRESHOLD_PX = 4

export function getExtractPortalHost(): Element | null {
  if (typeof document === 'undefined') return null
  return document.fullscreenElement ?? document.body
}

function modeFromNodeRect(clientY: number, rect: DOMRect): ExtractDropMode {
  const relativeY = clientY - rect.top
  if (relativeY < rect.height * 0.28) return 'before'
  if (relativeY > rect.height * 0.72) return 'after'
  return 'inside'
}

export function resolveExtractDropTarget(clientX: number, clientY: number): ExtractDropTarget | null {
  const pointInRect = (rect: DOMRect) =>
    clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom

  const fromElement = (element: Element | null): ExtractDropTarget | null => {
    if (!(element instanceof HTMLElement)) return null
    if (element.closest('[data-extract-ghost="true"]')) return null
    if (element.closest('[data-extract-handle="true"]')) return null
    const shell = element.closest('[data-mindmap-node-id]') as HTMLElement | null
    if (!shell) return null
    const targetId = shell.getAttribute('data-mindmap-node-id')
    if (!targetId) return null
    const rect = shell.getBoundingClientRect()
    return { targetId, mode: modeFromNodeRect(clientY, rect) }
  }

  if (typeof document.elementsFromPoint === 'function') {
    const stack = document.elementsFromPoint(clientX, clientY)
    for (const element of stack) {
      const hit = fromElement(element)
      if (hit) return hit
    }
  }

  // Fallback when elementsFromPoint is unavailable or blocked by overlays.
  const shells = document.querySelectorAll<HTMLElement>('[data-mindmap-node-id]')
  let best: { target: ExtractDropTarget; area: number } | null = null
  for (const shell of Array.from(shells)) {
    const rect = shell.getBoundingClientRect()
    if (!pointInRect(rect)) continue
    const targetId = shell.getAttribute('data-mindmap-node-id')
    if (!targetId) continue
    const area = rect.width * rect.height
    if (!best || area < best.area) {
      best = { target: { targetId, mode: modeFromNodeRect(clientY, rect) }, area }
    }
  }
  return best?.target ?? null
}
