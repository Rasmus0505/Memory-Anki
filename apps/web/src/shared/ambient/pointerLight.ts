import { prefersReducedMotion } from '@/shared/lib/prefersReducedMotion'

const LIT_SELECTOR = '.ma-lit, .ma-tilt'
const SKIP_SCOPE = '.freestyle-stage, [data-ui-sound="off"]'

export interface LightPoint {
  /** Pointer position inside the element, px. */
  x: number
  y: number
  /** Normalised -1..1 from the element centre, for tilt. */
  nx: number
  ny: number
}

export function resolveLightPoint(rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>, clientX: number, clientY: number): LightPoint {
  const x = clientX - rect.left
  const y = clientY - rect.top
  const clamp = (value: number) => Math.max(-1, Math.min(1, value))
  return {
    x,
    y,
    nx: rect.width ? clamp((x / rect.width) * 2 - 1) : 0,
    ny: rect.height ? clamp((y / rect.height) * 2 - 1) : 0,
  }
}

function litTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return null
  const element = target.closest<HTMLElement>(LIT_SELECTOR)
  if (!element || element.closest(SKIP_SCOPE)) return null
  return element
}

function release(element: HTMLElement | null) {
  if (!element) return
  element.removeAttribute('data-lit')
  element.removeAttribute('data-pressed')
}

/**
 * Marks the `.ma-lit` / `.ma-tilt` surface under the pointer: `data-lit` while the
 * mouse is over it (hover lift), `data-pressed` while a finger holds it (press sink).
 */
export function installPointerLight() {
  if (typeof document === 'undefined') return () => undefined
  if (prefersReducedMotion()) return () => undefined
  let hovered: HTMLElement | null = null
  let pressed: HTMLElement | null = null

  const onMove = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    const element = litTarget(event.target)
    if (element === hovered) return
    release(hovered)
    hovered = element
    hovered?.setAttribute('data-lit', '')
  }
  const onDown = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') return
    const element = litTarget(event.target)
    if (!element) return
    release(pressed)
    pressed = element
    element.setAttribute('data-lit', '')
    element.setAttribute('data-pressed', '')
  }
  const onUp = () => {
    release(pressed)
    pressed = null
  }
  const onLeaveWindow = () => {
    release(hovered)
    hovered = null
  }

  document.addEventListener('pointermove', onMove, { passive: true })
  document.addEventListener('pointerdown', onDown, { passive: true })
  document.addEventListener('pointerup', onUp, { passive: true })
  document.addEventListener('pointercancel', onUp, { passive: true })
  document.documentElement.addEventListener('pointerleave', onLeaveWindow)
  return () => {
    release(hovered)
    release(pressed)
    document.removeEventListener('pointermove', onMove)
    document.removeEventListener('pointerdown', onDown)
    document.removeEventListener('pointerup', onUp)
    document.removeEventListener('pointercancel', onUp)
    document.documentElement.removeEventListener('pointerleave', onLeaveWindow)
  }
}
