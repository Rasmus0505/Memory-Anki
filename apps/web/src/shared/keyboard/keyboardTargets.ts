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
