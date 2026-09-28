import {
  emitAmbientMote,
  emitPageDust,
  emitPaperPeel,
  particlesAllowed,
  rectCenter,
  type Point,
} from '@/shared/feedback/particles'
import { playWebAudioLandingChime } from '@/shared/feedback/mindmap-audio/webAudioFeedback'
import {
  getSceneEffectiveVolume,
  readReviewFeedbackSettings,
  resolveFeedbackChannels,
} from '@/shared/feedback/reviewFeedbackSettings'

/** Particles and DOM flourishes follow the global animation switch and OS reduced motion. */
export function freestyleMotionOn() {
  return particlesAllowed() && readReviewFeedbackSettings().animationEnabled
}

export function milestoneEffectsOn() {
  const settings = readReviewFeedbackSettings()
  const scene = settings.scenes.milestone
  return resolveFeedbackChannels(settings).milestoneEffects && scene.enabled && scene.animationEnabled
}

/** Landing chime rides the review scene like every other learning sound. */
export function playLandingChime(combo: number) {
  const settings = readReviewFeedbackSettings()
  if (!settings.soundEnabled || !resolveFeedbackChannels(settings).learningSounds) return
  if (!settings.scenes.review.enabled || !settings.scenes.review.soundEnabled) return
  playWebAudioLandingChime({ combo, volume: getSceneEffectiveVolume(settings, 'review') })
}

function canAnimate(element: Element | null | undefined): element is HTMLElement {
  return !!element && typeof (element as HTMLElement).animate === 'function'
}

/** The rail segment of the card being viewed; the whole rail before segments are laid out. */
export function viewingSegment(): Element | null {
  return document.querySelector('[data-testid="freestyle-progress-segment"][data-viewing="true"]')
    ?? document.querySelector('[data-testid="freestyle-progress-rail"]')
}

export function elementPoint(element: Element | null | undefined): Point | null {
  if (!element?.isConnected) return null
  const rect = element.getBoundingClientRect()
  return rect.width === 0 ? null : rectCenter(rect)
}

export function progressTargetPoint() {
  return elementPoint(viewingSegment())
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

/** The landing segment glows longer and brighter as the streak grows. */
export function chargeSegment(element: Element | null | undefined, combo: number) {
  if (!canAnimate(element)) return
  const level = Math.min(1, combo / 8)
  element.animate(
    [
      { filter: 'brightness(1)' },
      { filter: `brightness(${2 + level * 1.4}) saturate(${1.2 + level * 0.5})`, offset: 0.25 },
      { filter: 'brightness(1)' },
    ],
    { duration: 520 + level * 700, easing: 'ease-out' },
  )
}

export function stampOn(host: HTMLElement, text: string, variant: 'stage' | 'paper' | 'screen' = 'stage') {
  const stamp = document.createElement('div')
  stamp.className = variant === 'stage' ? 'freestyle-fx-stamp' : `freestyle-fx-stamp freestyle-fx-stamp-${variant}`
  stamp.setAttribute('aria-hidden', 'true')
  stamp.textContent = text
  host.appendChild(stamp)
  window.setTimeout(() => stamp.remove(), 1350)
}

export function flashVignette() {
  const vignette = document.createElement('div')
  vignette.className = 'freestyle-fx-vignette'
  vignette.setAttribute('aria-hidden', 'true')
  document.body.appendChild(vignette)
  window.setTimeout(() => vignette.remove(), 950)
}

export const PROGRESS_QUARTERS = [0.25, 0.5, 0.75] as const
const QUARTER_LABEL: Record<(typeof PROGRESS_QUARTERS)[number], string> = {
  0.25: '四分之一',
  0.5: '过半了',
  0.75: '最后四分之一',
}

/** The highest quarter mark passed going from `previous` to `next`, if any. */
export function crossedQuarter(previous: number, next: number) {
  let crossed: (typeof PROGRESS_QUARTERS)[number] | null = null
  for (const mark of PROGRESS_QUARTERS) {
    if (previous < mark && next >= mark) crossed = mark
  }
  return crossed == null ? null : { mark: crossed, label: QUARTER_LABEL[crossed] }
}

/** A paper ghost of the card tears off to the right and sheds scraps; the real card leaves at once. */
export function peelCard(card: HTMLElement | null) {
  if (!card || !freestyleMotionOn()) return
  const rect = card.getBoundingClientRect()
  if (rect.width === 0) return
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
  if (typeof ghost.animate === 'function') {
    ghost.animate(
      [
        { transform: 'none', opacity: 0.9 },
        { transform: 'translate(90px, -28px) rotate(12deg) scale(0.9)', opacity: 0 },
      ],
      { duration: 480, easing: 'cubic-bezier(0.5, 0, 0.8, 0.4)', fill: 'forwards' },
    ).finished.catch(() => undefined).then(() => ghost.remove())
  } else {
    ghost.remove()
  }
  emitPaperPeel(rect)
}

/** Paper dust off the bottom edge of the feed, where the outgoing card is pressed down. */
export function pageTurnDust() {
  if (!freestyleMotionOn()) return
  const pager = document.querySelector('[data-testid="freestyle-feed-pager"]')
  const rect = pager?.getBoundingClientRect()
  if (!rect || rect.width === 0) return
  const inset = rect.width * 0.12
  emitPageDust(rect.left + inset, rect.right - inset, rect.bottom - 18)
}

/** Slow motes of light drift off a 3-star key card while it is the card being read. */
export function startKeyCardMotes(card: HTMLElement) {
  const timer = window.setInterval(() => {
    if (document.hidden || !card.isConnected || !freestyleMotionOn()) return
    emitAmbientMote(card.getBoundingClientRect())
  }, 320)
  return () => window.clearInterval(timer)
}
