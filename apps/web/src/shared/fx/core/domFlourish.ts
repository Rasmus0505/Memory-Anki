import type { FxPlayback } from './owner'

function canAnimate(element: Element | null | undefined): element is HTMLElement {
  return !!element && typeof (element as HTMLElement).animate === 'function'
}

export function flashElement(element: Element | null | undefined, peak = 2.2) {
  if (!canAnimate(element)) return
  element.animate(
    [{ filter: 'brightness(1)' }, { filter: `brightness(${peak}) saturate(1.3)`, offset: 0.3 }, { filter: 'brightness(1)' }],
    { duration: 420, easing: 'ease-out' },
  )
}

/** Standalone `scale`, so it composes with whatever transform positions the element. */
export function bumpElement(element: Element | null | undefined, peak = 1.18) {
  if (!canAnimate(element)) return
  element.animate(
    [{ scale: '1' }, { scale: String(peak) }, { scale: '1' }],
    { duration: 380, easing: 'cubic-bezier(0.2, 1.5, 0.4, 1)' },
  )
}

/** Glows longer and brighter as `level` (0..1) grows. */
export function chargeElement(element: Element | null | undefined, level: number) {
  if (!canAnimate(element)) return
  const clamped = Math.max(0, Math.min(1, level))
  element.animate(
    [
      { filter: 'brightness(1)' },
      { filter: `brightness(${2 + clamped * 1.4}) saturate(${1.2 + clamped * 0.5})`, offset: 0.25 },
      { filter: 'brightness(1)' },
    ],
    { duration: 520 + clamped * 700, easing: 'ease-out' },
  )
}

function mountTransient(host: HTMLElement, className: string, lifeMs: number, playback?: FxPlayback, text?: string) {
  const node = document.createElement('div')
  node.className = className
  node.setAttribute('aria-hidden', 'true')
  if (text) node.textContent = text
  host.appendChild(node)
  const remove = () => node.remove()
  const id = window.setTimeout(remove, lifeMs)
  playback?.onCancel(() => {
    window.clearTimeout(id)
    remove()
  })
  return node
}

export type StampVariant = 'stage' | 'paper' | 'screen' | 'corner'

export function stampOn(host: HTMLElement, text: string, variant: StampVariant = 'stage', playback?: FxPlayback) {
  const className = variant === 'stage' ? 'freestyle-fx-stamp' : `freestyle-fx-stamp freestyle-fx-stamp-${variant}`
  return mountTransient(host, className, variant === 'corner' ? 2600 : 1350, playback, text)
}

export function flashVignette(playback?: FxPlayback) {
  mountTransient(document.body, 'freestyle-fx-vignette', 950, playback)
}

/**
 * One judgment freeze. A second call inside the window is ignored so a parent
 * stamp and a unit clear in the same moment do not stack.
 */
let hitStopUntil = 0
export function hitStop(ms = 60) {
  if (ms <= 0 || typeof document === 'undefined' || typeof document.getAnimations !== 'function') return
  const now = performance.now()
  if (now < hitStopUntil) return
  hitStopUntil = now + ms
  const paused = document.getAnimations().filter((animation) => animation.playState === 'running')
  paused.forEach((animation) => animation.pause())
  window.setTimeout(() => {
    paused.forEach((animation) => {
      if (animation.playState === 'paused') animation.play()
    })
  }, ms)
}

/** Rail catch. Scales the bar, not the card glyphs. */
export function absorbElement(element: Element | null | undefined, kind: 'dull' | 'clean' | 'jackpot') {
  if (!canAnimate(element)) return
  const peak = kind === 'jackpot' ? '1 1.18' : kind === 'clean' ? '1 1.08' : '1 1.03'
  const settle = kind === 'dull' ? '1 1' : '1 0.98'
  element.animate(
    [{ scale: '1 1' }, { scale: peak, offset: 0.42 }, { scale: settle, offset: 0.72 }, { scale: '1 1' }],
    { duration: kind === 'dull' ? 220 : 380, easing: 'cubic-bezier(0.2, 1.4, 0.4, 1)' },
  )
}

/** Expanding ring at the card's center. Does not transform the glyphs. */
export function shockwaveElement(element: Element | null | undefined) {
  if (!canAnimate(element)) return
  const ring = document.createElement('span')
  ring.className = 'mindmap-shockwave'
  ring.setAttribute('aria-hidden', 'true')
  element.appendChild(ring)
  ring.addEventListener('animationend', () => ring.remove(), { once: true })
  window.setTimeout(() => ring.remove(), 700)
}

/** Jelly parent catch. Ends at identity so the title is sharp again. */
export function squashElement(element: Element | null | undefined) {
  if (!canAnimate(element)) return
  element.animate(
    [
      { transform: 'scale(1, 1)' },
      { transform: 'scale(1.22, 0.84)', offset: 0.25 },
      { transform: 'scale(0.92, 1.12)', offset: 0.55 },
      { transform: 'scale(1.04, 0.98)', offset: 0.8 },
      { transform: 'none' },
    ],
    { duration: 380, easing: 'cubic-bezier(0.175, 0.885, 0.32, 1.4)' },
  )
}

/** Halo only. Never scales the card, so revealed text stays crisp. */
export function pulseHalo(element: Element | null | undefined, strong = false) {
  if (!canAnimate(element)) return
  const spread = strong ? 10 : 6
  element.animate(
    [
      { boxShadow: '0 0 0 0 transparent' },
      { boxShadow: `0 0 0 ${spread}px hsl(32 90% 56% / 0.34)`, offset: 0.4 },
      { boxShadow: '0 0 0 0 transparent' },
    ],
    { duration: strong ? 460 : 320, easing: 'cubic-bezier(0.2, 1.4, 0.4, 1)' },
  )
}

/** Micro screen shake for intense tactile impact on ratings. */
export function shakeScreen(intensity = 1.0) {
  if (intensity <= 0) return
  const host = document.getElementById('root') || document.body
  if (!host || typeof host.animate !== 'function') return
  const s = intensity * 4.5
  host.animate(
    [
      { transform: 'translate(0, 0)' },
      { transform: `translate(${-s * 0.8}px, ${s * 0.6}px) rotate(${-s * 0.08}deg)`, offset: 0.2 },
      { transform: `translate(${s * 0.7}px, ${-s * 0.5}px) rotate(${s * 0.06}deg)`, offset: 0.5 },
      { transform: `translate(${-s * 0.3}px, ${s * 0.2}px)`, offset: 0.8 },
      { transform: 'translate(0, 0)' },
    ],
    { duration: 140, easing: 'ease-out' },
  )
}

/** A paper ghost of `card` tears off to the right; the real card leaves at once. */
export function peelGhost(rect: DOMRect) {
  const ghost = document.createElement('div')
  ghost.className = 'freestyle-fx-peel'
  ghost.setAttribute('aria-hidden', 'true')
  Object.assign(ghost.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  })
  document.body.appendChild(ghost)
  if (typeof ghost.animate !== 'function') {
    ghost.remove()
    return
  }
  ghost.animate(
    [
      { transform: 'none', opacity: 0.9 },
      { transform: 'translate(90px, -28px) rotate(12deg) scale(0.9)', opacity: 0 },
    ],
    { duration: 480, easing: 'cubic-bezier(0.5, 0, 0.8, 0.4)', fill: 'forwards' },
  ).finished.catch(() => undefined).then(() => ghost.remove())
}
