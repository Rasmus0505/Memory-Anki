export function isEditableKeyboardTarget(target: EventTarget | null) {
  const element = target instanceof Element ? target : null
  if (!element) return false
  const tagName = element.tagName.toLowerCase()
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    Boolean(element.closest('[contenteditable="true"]'))
  )
}

/** Modal quiz interactions must own keys before page-level learning shortcuts. */
export function isKeyboardShortcutSuspended() {
  return typeof document !== 'undefined'
    ? Boolean(document.querySelector('[data-keyboard-shortcuts-suspended="true"]'))
    : false
}
