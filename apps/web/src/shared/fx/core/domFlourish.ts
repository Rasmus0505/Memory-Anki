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
