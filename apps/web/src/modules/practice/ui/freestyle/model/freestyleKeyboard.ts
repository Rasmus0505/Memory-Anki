import { isKeyboardShortcutSuspended } from '@/shared/keyboard/keyboardTargets'

const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

export type FreestyleQuestionDirection = 'previous' | 'next'

/**
 * True when some other owner must keep the key: a modal, a menu, a text field,
 * or an open card editor. The card editor check is page-level (`contentEditable`
 * focus can be lost while the edit session stays open), not target-level.
 */
export function isFreestyleShortcutBlocked(target: EventTarget | null) {
  if (isKeyboardShortcutSuspended()) return true
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || TEXT_ENTRY_TAGS.has(target.tagName)) return true
  return Boolean(target.closest('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]'))
}

/**
 * Vertical feed paging. PageUp/PageDown only: Space is deliberately unbound —
 * a card can be in inline edit, and a space bar that pages the feed while the
 * caret sits in a card was turning cards away from under the learner.
 * Callers must still skip this while a quiz dialog or a card editor owns keys.
 */
export function getFreestyleFeedPageDirection(key: string): FreestyleQuestionDirection | null {
  if (key === 'PageDown') return 'next'
  if (key === 'PageUp') return 'previous'
  return null
}

/**
 * True when a vertical page key is aimed at the feed while some overlay already
 * owns the keyboard. Cancel the browser default so the snap scroller cannot
 * turn the card. Keys inside the dialog or a text field stay untouched.
 */
export function shouldSwallowFreestyleFeedPageKey(
  target: EventTarget | null,
  feedRoot: EventTarget | null,
) {
  if (!(target instanceof Node) || !(feedRoot instanceof Node) || !feedRoot.contains(target)) {
    return false
  }
  if (!(target instanceof HTMLElement)) return true
  if (target.isContentEditable || TEXT_ENTRY_TAGS.has(target.tagName)) return false
  if (target.closest('[role="dialog"], [role="menu"], [data-keyboard-shortcuts-suspended="true"]')) {
    return false
  }
  return true
}

export function getFreestyleChoiceIndex(key: string): number | null {
  const normalized = key.toLowerCase()
  if (/^[1-4]$/.test(normalized)) return Number(normalized) - 1
  const letterIndex = 'abcd'.indexOf(normalized)
  return letterIndex >= 0 ? letterIndex : null
}

/**
 * True while a modal owns the screen (linked-question window, config, history…)
 * or a card editor is open. Auto-advance must not turn the feed underneath one:
 * the learner would close the dialog / finish the edit onto a different card than
 * the one they were working on.
 */
export function isFreestyleOverlayOpen() {
  return isKeyboardShortcutSuspended() || Boolean(
    typeof document !== 'undefined' && document.querySelector('[role="dialog"]'),
  )
}
