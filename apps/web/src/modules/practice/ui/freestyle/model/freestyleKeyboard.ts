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

export function getFreestyleChoiceIndex(key: string): number | null {
  const normalized = key.toLowerCase()
  if (/^[1-4]$/.test(normalized)) return Number(normalized) - 1
  const letterIndex = 'abcd'.indexOf(normalized)
  return letterIndex >= 0 ? letterIndex : null
}
