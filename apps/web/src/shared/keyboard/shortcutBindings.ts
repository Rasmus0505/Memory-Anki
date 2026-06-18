export interface ShortcutBinding {
  code: string
  key: string
  shift: boolean
  ctrl: boolean
  alt: boolean
  meta: boolean
}

export interface ShortcutCaptureMessages {
  modifierOnly?: string
  escapeReserved?: string
  tabReserved?: string
  reservedKey?: (label: string) => string
  barePrintable?: (key: string) => string
  disallowed?: string
}

const RESERVED_SHORTCUT_KEYS = new Set(['escape', 'tab', 'backspace', 'delete'])
const MODIFIER_ONLY_KEYS = new Set(['shift', 'control', 'ctrl', 'meta', 'os', 'alt'])
const BARE_ALLOWED_SHORTCUT_KEYS = new Set([
  'space',
  'enter',
  'arrowleft',
  'arrowright',
  'arrowup',
  'arrowdown',
  'home',
  'end',
  'pageup',
  'pagedown',
])

const SHORTCUT_KEY_LABELS: Record<string, string> = {
  ' ': 'Space',
  space: 'Space',
  enter: 'Enter',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
}

const DEFAULT_CAPTURE_MESSAGES: Required<ShortcutCaptureMessages> = {
  modifierOnly: '请按一个完整快捷键，单独的修饰键不能保存。',
  escapeReserved: 'Esc 需要保留给关闭弹窗和退出当前操作。',
  tabReserved: 'Tab 需要保留给焦点切换。',
  reservedKey: () => '该按键会影响输入或删除操作，不建议设置为学习快捷键。',
  barePrintable: (key) => `「${key.toUpperCase()}」容易与输入冲突，请改用组合键。`,
  disallowed: '该按键组合不在允许范围内，请改用带修饰键的组合或功能键。',
}

export function normalizeShortcutKeyValue(value: unknown) {
  if (value == null) return ''
  if (value === ' ') return 'space'
  const normalized = String(value).trim().toLowerCase()
  if (!normalized) return ''
  if (normalized === 'spacebar') return 'space'
  return normalized
}

function normalizeShortcutCodeValue(value: unknown) {
  return String(value || '').trim()
}

function isPrintableShortcutKey(key: string) {
  return key.length === 1
}

function isFunctionShortcutKey(key: string) {
  return /^f\d{1,2}$/i.test(key)
}

function isAllowedBareShortcut(binding: ShortcutBinding) {
  const key = normalizeShortcutKeyValue(binding.key)
  return BARE_ALLOWED_SHORTCUT_KEYS.has(key) || isFunctionShortcutKey(key)
}

function inferShortcutCodeFromKey(key: string) {
  const normalizedKey = normalizeShortcutKeyValue(key)
  if (normalizedKey === 'space') return 'Space'
  if (normalizedKey === 'enter') return 'Enter'
  if (normalizedKey === 'arrowleft') return 'ArrowLeft'
  if (normalizedKey === 'arrowright') return 'ArrowRight'
  if (normalizedKey === 'arrowup') return 'ArrowUp'
  if (normalizedKey === 'arrowdown') return 'ArrowDown'
  if (normalizedKey === 'home') return 'Home'
  if (normalizedKey === 'end') return 'End'
  if (normalizedKey === 'pageup') return 'PageUp'
  if (normalizedKey === 'pagedown') return 'PageDown'
  if (isFunctionShortcutKey(normalizedKey)) return normalizedKey.toUpperCase()
  if (/^[a-z]$/.test(normalizedKey)) return `Key${normalizedKey.toUpperCase()}`
  if (/^\d$/.test(normalizedKey)) return `Digit${normalizedKey}`
  return SHORTCUT_KEY_LABELS[normalizedKey] || ''
}

export function cloneShortcutBinding(binding: ShortcutBinding): ShortcutBinding {
  return {
    code: binding.code,
    key: binding.key,
    shift: binding.shift,
    ctrl: binding.ctrl,
    alt: binding.alt,
    meta: binding.meta,
  }
}

export function normalizeShortcutBindingValue(value: unknown): ShortcutBinding | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<ShortcutBinding>
  const key = normalizeShortcutKeyValue(raw.key)
  const code = normalizeShortcutCodeValue(raw.code) || inferShortcutCodeFromKey(key)
  if (!key && !code) return null
  return {
    code,
    key,
    shift: Boolean(raw.shift),
    ctrl: Boolean(raw.ctrl),
    alt: Boolean(raw.alt),
    meta: Boolean(raw.meta),
  }
}

export function isShortcutBindingAllowed(bindingValue: unknown) {
  const binding = normalizeShortcutBindingValue(bindingValue)
  if (!binding) return false
  const key = normalizeShortcutKeyValue(binding.key)
  const hasModifier = Boolean(binding.shift || binding.ctrl || binding.alt || binding.meta)
  if (!key || MODIFIER_ONLY_KEYS.has(key) || RESERVED_SHORTCUT_KEYS.has(key)) return false
  if (!hasModifier && isPrintableShortcutKey(key)) return false
  if (!hasModifier && !isAllowedBareShortcut(binding)) return false
  return true
}

export function getShortcutSignature(bindingValue: unknown) {
  const binding = normalizeShortcutBindingValue(bindingValue)
  if (!binding) return ''
  return [
    binding.ctrl ? 'ctrl' : '',
    binding.alt ? 'alt' : '',
    binding.shift ? 'shift' : '',
    binding.meta ? 'meta' : '',
    binding.code || binding.key,
  ]
    .filter(Boolean)
    .join('+')
}

function getShortcutKeyLabel(binding: ShortcutBinding) {
  const normalizedCode = normalizeShortcutCodeValue(binding.code)
  const normalizedCodeKey = normalizedCode.toLowerCase()
  if (SHORTCUT_KEY_LABELS[normalizedCodeKey]) return SHORTCUT_KEY_LABELS[normalizedCodeKey]
  if (/^F\d{1,2}$/i.test(normalizedCode)) return normalizedCode.toUpperCase()
  if (/^Key[A-Z]$/.test(normalizedCode)) return normalizedCode.slice(3)
  if (/^Digit\d$/.test(normalizedCode)) return normalizedCode.slice(5)
  if (normalizedCode) return normalizedCode

  const normalizedKey = normalizeShortcutKeyValue(binding.key)
  if (SHORTCUT_KEY_LABELS[normalizedKey]) return SHORTCUT_KEY_LABELS[normalizedKey]
  if (isFunctionShortcutKey(normalizedKey)) return normalizedKey.toUpperCase()
  if (normalizedKey.length === 1) return normalizedKey.toUpperCase()
  return normalizedKey || '未设置'
}

export function getShortcutLabel(bindingValue: unknown) {
  const binding = normalizeShortcutBindingValue(bindingValue)
  if (!binding) return '未设置'
  const modifierLabels: string[] = []
  if (binding.ctrl) modifierLabels.push('Ctrl')
  if (binding.alt) modifierLabels.push('Alt')
  if (binding.shift) modifierLabels.push('Shift')
  if (binding.meta) modifierLabels.push('Meta')
  return [...modifierLabels, getShortcutKeyLabel(binding)].filter(Boolean).join('+') || '未设置'
}

export function isShortcutPressed(event: KeyboardEvent, shortcutValue: unknown) {
  const binding = normalizeShortcutBindingValue(shortcutValue)
  if (!binding) return false
  const eventCode = normalizeShortcutCodeValue(event.code)
  const eventKey = normalizeShortcutKeyValue(event.key)
  const matchesKey = binding.code ? binding.code === eventCode : binding.key === eventKey
  if (!matchesKey) return false
  return (
    binding.shift === Boolean(event.shiftKey) &&
    binding.ctrl === Boolean(event.ctrlKey) &&
    binding.alt === Boolean(event.altKey) &&
    binding.meta === Boolean(event.metaKey)
  )
}

export function captureShortcutFromKeyboardEvent(
  event: KeyboardEvent,
  messages: ShortcutCaptureMessages = {},
) {
  const resolvedMessages = { ...DEFAULT_CAPTURE_MESSAGES, ...messages }
  const key = normalizeShortcutKeyValue(event.key)
  const code = normalizeShortcutCodeValue(event.code) || inferShortcutCodeFromKey(key)
  const hasModifier = Boolean(event.shiftKey || event.ctrlKey || event.altKey || event.metaKey)

  if (MODIFIER_ONLY_KEYS.has(key)) {
    return { value: null, error: resolvedMessages.modifierOnly }
  }
  if (RESERVED_SHORTCUT_KEYS.has(key)) {
    if (key === 'escape') return { value: null, error: resolvedMessages.escapeReserved }
    if (key === 'tab') return { value: null, error: resolvedMessages.tabReserved }
    return {
      value: null,
      error: resolvedMessages.reservedKey(
        getShortcutLabel({ code, key, shift: false, ctrl: false, alt: false, meta: false }),
      ),
    }
  }
  if (!hasModifier && isPrintableShortcutKey(key)) {
    return { value: null, error: resolvedMessages.barePrintable(key) }
  }

  const candidate: ShortcutBinding = {
    code,
    key,
    shift: Boolean(event.shiftKey),
    ctrl: Boolean(event.ctrlKey),
    alt: Boolean(event.altKey),
    meta: Boolean(event.metaKey),
  }
  if (!isShortcutBindingAllowed(candidate)) {
    return { value: null, error: resolvedMessages.disallowed }
  }
  return { value: candidate, error: '' }
}
