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

function apply(element: HTMLElement, clientX: number, clientY: number) {
  const point = resolveLightPoint(element.getBoundingClientRect(), clientX, clientY)
  element.style.setProperty('--lx', `${point.x.toFixed(1)}px`)
  element.style.setProperty('--ly', `${point.y.toFixed(1)}px`)
  element.style.setProperty('--tx', point.nx.toFixed(3))
  element.style.setProperty('--ty', point.ny.toFixed(3))
}

function release(element: HTMLElement | null) {
  if (!element) return
  element.removeAttribute('data-lit')
  element.removeAttribute('data-pressed')
  element.style.setProperty('--tx', '0')
  element.style.setProperty('--ty', '0')
}

/**
 * Desktop: a warm sheen follows the mouse over `.ma-lit` surfaces and `.ma-tilt`
 * cards lean towards it. Touch: the sheen blooms at the press point and the
 * surface sinks slightly towards it until release.
 */
export function installPointerLight() {
  if (typeof document === 'undefined') return () => undefined
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return () => undefined
  let hovered: HTMLElement | null = null
  let pressed: HTMLElement | null = null
  let pending: { element: HTMLElement; x: number; y: number } | null = null
  let frame = 0

  const flush = () => {
    frame = 0
    if (pending) apply(pending.element, pending.x, pending.y)
    pending = null
  }
  const schedule = (element: HTMLElement, x: number, y: number) => {
    pending = { element, x, y }
    if (!frame) frame = window.requestAnimationFrame(flush)
  }

  const onMove = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    const element = litTarget(event.target)
    if (element !== hovered) {
      release(hovered)
      hovered = element
      hovered?.setAttribute('data-lit', '')
    }
    if (element) schedule(element, event.clientX, event.clientY)
  }
  const onDown = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') return
    const element = litTarget(event.target)
    if (!element) return
    release(pressed)
    pressed = element
    apply(element, event.clientX, event.clientY)
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
    if (frame) window.cancelAnimationFrame(frame)
    release(hovered)
    release(pressed)
    document.removeEventListener('pointermove', onMove)
    document.removeEventListener('pointerdown', onDown)
    document.removeEventListener('pointerup', onUp)
    document.removeEventListener('pointercancel', onUp)
    document.documentElement.removeEventListener('pointerleave', onLeaveWindow)
  }
}
