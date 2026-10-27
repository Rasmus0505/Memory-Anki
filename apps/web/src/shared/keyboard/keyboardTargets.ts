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

/**
 * A key pressed inside an open dialog/menu (including the shortcut recorder)
 * belongs to that overlay, never to the learning surface behind it. A dialog
 * that itself hosts flip shortcuts passes `allowDialog: true` at its own hook
 * call; menus and poppers inside it still own their keys.
 */
export function isKeyboardOverlayTarget(
  target: EventTarget | null,
  options: { allowDialog?: boolean } = {},
) {
  const element = target instanceof Element ? target : null
  if (!element) return false
  if (
    element.closest(
      '[role="menu"], [data-radix-popper-content-wrapper], [data-keyboard-shortcuts-suspended="true"]',
    )
  ) {
    return true
  }
  if (options.allowDialog) return false
  return Boolean(element.closest('[role="dialog"]'))
}

/** Modal quiz interactions must own keys before page-level learning shortcuts. */
export function isKeyboardShortcutSuspended() {
  return typeof document !== 'undefined'
    ? Boolean(document.querySelector('[data-keyboard-shortcuts-suspended="true"]'))
    : false
}
