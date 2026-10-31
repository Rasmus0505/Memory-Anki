import './microBubble.css'
import { resolveOverlayPortalContainer } from '@/shared/lib/overlayPortal'

export type MicroBubbleTone = 'fast' | 'good' | 'warn' | 'error' | 'neutral'

export type MicroBubblePlacement = 'above' | 'below' | 'left-top' | 'right-top'

export interface MicroBubblePart {
  text: string
  /** Tabular monospace, for durations and interval jumps. */
  strong?: boolean
  /** Lower-contrast connector or label text. */
  muted?: boolean
}

export interface MicroBubbleOptions {
  parts: readonly MicroBubblePart[]
  /** Emoji or short glyph shown before the text. */
  icon?: string
  tone?: MicroBubbleTone
  placement?: MicroBubblePlacement
  /**
   * Same-zone exclusivity. A new bubble in the same zone retires the previous
   * one in 180ms, so rapid taps never stack pills on top of each other.
   */
  zone?: string
  offset?: number
  duration?: number
}

const DEFAULT_DURATION_MS = 1050
const EDGE_GAP_PX = 8
const MAX_LIVE_BUBBLES = 8
const ANIMATION_NAMES = new Set([
  'ma-micro-bubble-float',
  'ma-micro-bubble-retire',
  'ma-micro-bubble-quiet',
])

let layer: HTMLDivElement | null = null
let autoZone = 0
const zones = new Map<string, HTMLElement>()

/**
 * One fixed layer for every transient pill, mounted on document.body (or the
 * native-fullscreen host). Cards, dialogs and the rating dock all create their
 * own stacking contexts; a bubble rendered inside any of them is clipped or
 * painted under the question. Keeping them here also means a card can unmount
 * while its bubble finishes its 1s float.
 */
function ensureLayer(): HTMLDivElement {
  if (!layer || !layer.isConnected) {
    layer = document.createElement('div')
    layer.className = 'ma-micro-bubble-layer'
  }
  const host = resolveOverlayPortalContainer() ?? document.body
  if (layer.parentElement !== host) host.appendChild(layer)
  return layer
}

function retire(bubble: HTMLElement) {
  if (!bubble.isConnected) return
  bubble.classList.add('is-retiring')
}

function positionBubble(
  bubble: HTMLElement,
  rect: DOMRect,
  placement: MicroBubblePlacement,
  offset: number,
) {
  const width = bubble.offsetWidth
  const height = bubble.offsetHeight
  let centerX: number
  let top: number

  if (placement === 'below') {
    centerX = rect.left + rect.width / 2
    // The pill always floats upward; keep enough room below the anchor that it
    // ends near it instead of drifting back over the element.
    top = rect.bottom + 26
  } else if (placement === 'left-top' && window.innerWidth >= 720) {
    centerX = rect.left - offset - width / 2
    top = rect.top + 6
  } else if (placement === 'right-top' && window.innerWidth >= 720) {
    centerX = rect.right + offset + width / 2
    top = rect.top + 6
  } else {
    centerX = rect.left + rect.width / 2
    top = rect.top - offset - height
  }

  centerX = Math.max(
    width / 2 + EDGE_GAP_PX,
    Math.min(window.innerWidth - width / 2 - EDGE_GAP_PX, centerX),
  )
  top = Math.max(
    EDGE_GAP_PX,
    Math.min(window.innerHeight - height - EDGE_GAP_PX, top),
  )

  bubble.style.left = `${centerX}px`
  bubble.style.top = `${top}px`
}

/**
 * Show one short-lived micro-feedback pill next to the element the learner
 * acted on. Never blocks clicks: pointer-events stay off, and the pill lives on
 * the top layer until its animation ends.
 */
export function showMicroBubble(
  anchor: Element | null,
  options: MicroBubbleOptions,
): HTMLElement | null {
  if (typeof document === 'undefined') return null
  if (!anchor || !anchor.isConnected) return null
  if (options.parts.length === 0) return null

  const rect = anchor.getBoundingClientRect()
  if (rect.width <= 0 && rect.height <= 0) return null

  const {
    parts,
    icon,
    tone = 'good',
    placement = 'above',
    offset = 10,
    duration = DEFAULT_DURATION_MS,
  } = options

  const zone = options.zone ?? `auto-${autoZone++}`
  const host = ensureLayer()

  const bubble = document.createElement('div')
  bubble.className = `ma-micro-bubble ma-micro-bubble--${tone}`
  bubble.setAttribute('aria-hidden', 'true')
  bubble.style.setProperty('--ma-bubble-duration', `${duration}ms`)
  bubble.style.visibility = 'hidden'
  bubble.style.animationPlayState = 'paused'

  if (icon) {
    const iconEl = document.createElement('span')
    iconEl.className = 'ma-micro-bubble__icon'
    iconEl.textContent = icon
    bubble.appendChild(iconEl)
  }

  const text = document.createElement('span')
  text.className = 'ma-micro-bubble__text'
  for (const part of parts) {
    const span = document.createElement('span')
    if (part.strong) span.classList.add('is-strong')
    if (part.muted) span.classList.add('is-muted')
    span.textContent = part.text
    text.appendChild(span)
  }
  bubble.appendChild(text)

  const previous = zones.get(zone)
  if (previous && previous !== bubble && previous.isConnected) retire(previous)

  host.appendChild(bubble)
  positionBubble(bubble, rect, placement, offset)
  bubble.style.visibility = ''
  bubble.style.animationPlayState = ''
  zones.set(zone, bubble)

  let removed = false
  const cleanup = () => {
    if (removed) return
    removed = true
    window.clearTimeout(failSafe)
    if (zones.get(zone) === bubble) zones.delete(zone)
    bubble.remove()
  }

  // A throttled background tab can suppress animationend; never leave a pill
  // glued to the screen when the learner comes back.
  const failSafe = window.setTimeout(cleanup, duration + 600)

  bubble.addEventListener('animationend', (event) => {
    if (!ANIMATION_NAMES.has(event.animationName)) return
    cleanup()
  })

  while (host.children.length > MAX_LIVE_BUBBLES) {
    host.firstElementChild?.remove()
  }

  return bubble
}

/** Cancel every live bubble (tests and owner teardown). */
export function clearMicroBubbles() {
  zones.clear()
  if (layer) layer.replaceChildren()
}
