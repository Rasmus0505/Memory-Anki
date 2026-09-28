import {
  getReviewFeedbackEffectiveVolume,
  readReviewFeedbackSettings,
  REVIEW_FEEDBACK_SETTINGS_UPDATED_EVENT,
  type ReviewFeedbackSettings,
} from '@/shared/feedback/reviewFeedbackSettings'
import { synthUiSound, type UiSound } from '@/shared/feedback/uiSoundSynth'

export type { UiSound }

const MIN_GAP_MS = 45
/** Surfaces with their own sound design never get the generic interface sounds. */
const SILENT_SCOPE = '[data-ui-sound="off"], .freestyle-stage, [data-freestyle-stage]'

let settings: ReviewFeedbackSettings | null = null
let lastPlayed = 0
let suppressed: () => boolean = () => false

function currentSettings() {
  settings ??= readReviewFeedbackSettings()
  return settings
}

export function uiSoundsAllowed(value: Pick<ReviewFeedbackSettings, 'soundEnabled' | 'uiSoundEnabled'>) {
  return value.soundEnabled && value.uiSoundEnabled !== false
}

export function playUiSound(sound: UiSound, now = performance.now()) {
  if (suppressed()) return false
  const active = currentSettings()
  if (!uiSoundsAllowed(active)) return false
  if (now - lastPlayed < MIN_GAP_MS) return false
  lastPlayed = now
  synthUiSound(sound, getReviewFeedbackEffectiveVolume(active) * 0.8)
  return true
}

/** Maps a pressed element to its interface sound; `null` stays silent. */
export function classifyUiSoundTarget(target: Element | null): UiSound | null {
  if (!target) return null
  const control = target.closest<HTMLElement>(
    '[data-ui-sound], [role="switch"], [role="tab"], [role="checkbox"], [role="radio"], [role="menuitem"], [role="option"], button, [data-feedback="button"]',
  )
  if (!control || control.closest(SILENT_SCOPE)) return null
  if (control.matches(':disabled, [aria-disabled="true"], [data-disabled]')) return null
  const explicit = control.dataset.uiSound
  if (explicit && explicit !== 'off') return explicit as UiSound
  const role = control.getAttribute('role')
  if (role === 'switch' || role === 'checkbox') {
    // Pressed before the state flips, so the sound describes the upcoming state.
    return control.getAttribute('aria-checked') === 'true' || control.dataset.state === 'checked' ? 'toggle-off' : 'toggle-on'
  }
  if (role === 'tab' || role === 'radio' || role === 'option' || role === 'menuitem') return 'wood-soft'
  return 'wood'
}

/** One delegated listener for the whole app; returns an uninstall function. */
export function installUiSounds(isSuppressed: () => boolean) {
  if (typeof document === 'undefined') return () => undefined
  suppressed = isSuppressed
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    const sound = classifyUiSoundTarget(event.target instanceof Element ? event.target : null)
    if (sound) playUiSound(sound)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return
    const sound = classifyUiSoundTarget(event.target instanceof Element ? event.target : null)
    if (sound) playUiSound(sound)
  }
  const onSettings = (event: Event) => {
    const detail = (event as CustomEvent<ReviewFeedbackSettings>).detail
    settings = detail ?? readReviewFeedbackSettings()
  }
  document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true })
  document.addEventListener('keydown', onKeyDown, { capture: true })
  window.addEventListener(REVIEW_FEEDBACK_SETTINGS_UPDATED_EVENT, onSettings)
  return () => {
    suppressed = () => false
    document.removeEventListener('pointerdown', onPointerDown, { capture: true })
    document.removeEventListener('keydown', onKeyDown, { capture: true })
    window.removeEventListener(REVIEW_FEEDBACK_SETTINGS_UPDATED_EVENT, onSettings)
  }
}

export function __resetUiSoundsForTests() {
  settings = null
  lastPlayed = 0
  suppressed = () => false
}
