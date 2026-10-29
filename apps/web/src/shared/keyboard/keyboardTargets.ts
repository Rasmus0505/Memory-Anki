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

/**
 * Set by an open mind-map card editor (`NodeCard`). The caret can lose DOM focus
 * while the session is still editing — toolbar teardown, React Flow layout, a
 * click on the card padding — so "is the event target editable?" is not enough:
 * a stray Space / Enter / arrow would flip, rate or page the card underneath.
 */
export const MINDMAP_CARD_EDITOR_OPEN_SELECTOR = '[data-mindmap-editor-active="true"]'

/**
 * Modal quiz interactions and an open card editor must own keys before
 * page-level learning shortcuts.
 */
export function isKeyboardShortcutSuspended() {
  if (typeof document === 'undefined') return false
  return Boolean(
    document.querySelector(
      `[data-keyboard-shortcuts-suspended="true"], ${MINDMAP_CARD_EDITOR_OPEN_SELECTOR}`,
    ),
  )
}
