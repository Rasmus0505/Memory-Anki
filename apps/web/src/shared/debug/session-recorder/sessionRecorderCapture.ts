const SENSITIVE_PATTERN = /password|secret|token|apikey|api-key|api_key|密钥|密码/

export const SESSION_RECORDER_UI_ATTR = 'data-session-recorder'

export function isSessionRecorderUi(target: EventTarget | null) {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest(`[${SESSION_RECORDER_UI_ATTR}]`))
}

function blobOf(element: HTMLElement) {
  return [
    element.getAttribute('name'),
    element.id,
    element.getAttribute('autocomplete'),
    element.getAttribute('aria-label'),
    element.getAttribute('placeholder'),
    element.getAttribute('type'),
  ]
    .filter(Boolean)
    .join('|')
    .toLowerCase()
}

export function isSensitiveRecorderField(element: HTMLElement) {
  if (element instanceof HTMLInputElement && element.type === 'password') return true
  return SENSITIVE_PATTERN.test(blobOf(element))
}

function interactiveTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return null
  return target.closest('button, a, [role="button"], [role="menuitem"], input, textarea, select, label')
}

export function describeClickForRecorder(event: Event) {
  if (isSessionRecorderUi(event.target)) return null
  const interactive = interactiveTarget(event.target)
  if (!(interactive instanceof HTMLElement)) return null
  if (isSensitiveRecorderField(interactive)) {
    return { action: '输入敏感字段', detail: '已输入' }
  }
  if (interactive instanceof HTMLInputElement || interactive instanceof HTMLTextAreaElement) {
    return { action: '点击输入框', detail: '' }
  }
  if (interactive instanceof HTMLSelectElement) return { action: '选择控件', detail: '' }
  if (interactive.getAttribute('role') === 'menuitem') return { action: '点击菜单项', detail: '' }
  return { action: '点击按钮', detail: '' }
}
