const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

export type FreestyleQuestionDirection = 'previous' | 'next'

export function isFreestyleShortcutBlocked(target: EventTarget | null) {
  if (
    typeof document !== 'undefined' &&
    document.querySelector('[data-keyboard-shortcuts-suspended="true"]')
  ) {
    return true
  }
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || TEXT_ENTRY_TAGS.has(target.tagName)) return true
  return Boolean(target.closest('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]'))
}

export function getFreestyleQuestionDirection(key: string): FreestyleQuestionDirection | null {
  if (key === 'ArrowLeft') return 'previous'
  if (key === 'ArrowRight') return 'next'
  return null
}

/** Vertical feed paging. Callers must skip this while a quiz dialog owns the keyboard. */
export function getFreestyleFeedPageDirection(key: string): FreestyleQuestionDirection | null {
  if (key === 'ArrowDown' || key === 'PageDown' || key === ' ') return 'next'
  if (key === 'ArrowUp' || key === 'PageUp') return 'previous'
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
 * True while a modal owns the screen (linked-question window, config, history…).
 * Auto-advance must not turn the feed underneath one: the learner would close the
 * dialog onto a different card than the one they were working on.
 */
export function isFreestyleOverlayOpen() {
  if (typeof document === 'undefined') return false
  return Boolean(
    document.querySelector('[data-keyboard-shortcuts-suspended="true"], [role="dialog"]'),
  )
}
