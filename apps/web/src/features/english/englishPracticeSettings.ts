import {
  getCachedClientPreference,
  setClientPreference,
} from '@/shared/preferences/clientPreferences'

export type ShortcutActionId =
  | 'replay_sentence'
  | 'previous_sentence'
  | 'next_sentence'
  | 'reveal_word'
  | 'reveal_letter'
  | 'toggle_single_loop'
  | 'toggle_auto_replay'
  | 'toggle_sound'

export interface ShortcutBinding {
  code: string
  key: string
  shift: boolean
  ctrl: boolean
  alt: boolean
  meta: boolean
}

export type EnglishPracticeShortcutMap = Record<ShortcutActionId, ShortcutBinding | null>

export interface EnglishPracticeSettings {
  shortcuts: EnglishPracticeShortcutMap
  sound: {
    enabled: boolean
  }
  flow: {
    autoAdvanceOnPass: boolean
  }
  replay: {
    autoReplayOnPass: boolean
    singleSentenceLoopEnabled: boolean
  }
}

export interface ShortcutActionDefinition {
  id: ShortcutActionId
  label: string
}

export const ENGLISH_PRACTICE_SETTINGS_STORAGE_KEY = 'memory-anki-english-practice-settings-v2'
export const ENGLISH_PRACTICE_SETTINGS_UPDATED_EVENT = 'memory-anki-english-practice-settings-change'

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

export const ENGLISH_SHORTCUT_ACTIONS: ShortcutActionDefinition[] = [
  { id: 'replay_sentence', label: '重播当前句' },
  { id: 'previous_sentence', label: '上一句' },
  { id: 'next_sentence', label: '下一句' },
  { id: 'reveal_word', label: '揭示当前词' },
  { id: 'reveal_letter', label: '揭示一个字母' },
  { id: 'toggle_single_loop', label: '开关单句循环' },
  { id: 'toggle_auto_replay', label: '开关答后重播' },
  { id: 'toggle_sound', label: '开关声音' },
]

export const DEFAULT_SHORTCUTS: EnglishPracticeShortcutMap = {
  replay_sentence: { code: 'Space', key: 'space', shift: true, ctrl: false, alt: false, meta: false },
  previous_sentence: { code: 'ArrowLeft', key: 'arrowleft', shift: true, ctrl: false, alt: false, meta: false },
  next_sentence: { code: 'ArrowRight', key: 'arrowright', shift: true, ctrl: false, alt: false, meta: false },
  reveal_word: { code: 'Enter', key: 'enter', shift: true, ctrl: false, alt: false, meta: false },
  reveal_letter: { code: 'ArrowUp', key: 'arrowup', shift: true, ctrl: false, alt: false, meta: false },
  toggle_single_loop: { code: 'KeyL', key: 'l', shift: true, ctrl: false, alt: false, meta: false },
  toggle_auto_replay: { code: 'KeyR', key: 'r', shift: true, ctrl: false, alt: false, meta: false },
  toggle_sound: { code: 'KeyM', key: 'm', shift: true, ctrl: false, alt: false, meta: false },
}

export const DEFAULT_ENGLISH_PRACTICE_SETTINGS: EnglishPracticeSettings = {
  shortcuts: DEFAULT_SHORTCUTS,
  sound: {
    enabled: true,
  },
  flow: {
    autoAdvanceOnPass: true,
  },
  replay: {
    autoReplayOnPass: true,
    singleSentenceLoopEnabled: false,
  },
}

function normalizeShortcutKeyValue(value: unknown) {
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

function cloneShortcutBinding(binding: ShortcutBinding): ShortcutBinding {
  return {
    code: binding.code,
    key: binding.key,
    shift: binding.shift,
    ctrl: binding.ctrl,
    alt: binding.alt,
    meta: binding.meta,
  }
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

function isShortcutBindingAllowed(bindingValue: unknown) {
  const binding = normalizeShortcutBindingValue(bindingValue)
  if (!binding) return false
  const key = normalizeShortcutKeyValue(binding.key)
  const hasModifier = Boolean(binding.shift || binding.ctrl || binding.alt || binding.meta)
  if (!key || MODIFIER_ONLY_KEYS.has(key) || RESERVED_SHORTCUT_KEYS.has(key)) {
    return false
  }
  if (!hasModifier && isPrintableShortcutKey(key)) {
    return false
  }
  if (!hasModifier && !isAllowedBareShortcut(binding)) {
    return false
  }
  return true
}

export function getShortcutSignature(bindingValue: unknown) {
  const binding = normalizeShortcutBindingValue(bindingValue)
  if (!binding) return ''
  const keyPart = binding.code || binding.key
  return [
    binding.ctrl ? 'ctrl' : '',
    binding.alt ? 'alt' : '',
    binding.shift ? 'shift' : '',
    binding.meta ? 'meta' : '',
    keyPart,
  ]
    .filter(Boolean)
    .join('+')
}

function getShortcutKeyLabel(binding: ShortcutBinding) {
  const normalizedCode = normalizeShortcutCodeValue(binding.code)
  if (normalizedCode === 'Space') return 'Space'
  if (normalizedCode === 'Enter') return 'Enter'
  if (normalizedCode === 'ArrowLeft') return 'ArrowLeft'
  if (normalizedCode === 'ArrowRight') return 'ArrowRight'
  if (normalizedCode === 'ArrowUp') return 'ArrowUp'
  if (normalizedCode === 'ArrowDown') return 'ArrowDown'
  if (normalizedCode === 'Home') return 'Home'
  if (normalizedCode === 'End') return 'End'
  if (normalizedCode === 'PageUp') return 'PageUp'
  if (normalizedCode === 'PageDown') return 'PageDown'
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
  const keyLabel = getShortcutKeyLabel(binding)
  return [...modifierLabels, keyLabel].filter(Boolean).join('+') || '未设置'
}

export function sanitizeShortcutMap(rawShortcutMap: unknown): EnglishPracticeShortcutMap {
  const raw =
    rawShortcutMap && typeof rawShortcutMap === 'object'
      ? (rawShortcutMap as Partial<Record<ShortcutActionId, unknown>>)
      : {}
  const occupied = new Set<string>()
  const nextShortcutMap = {} as EnglishPracticeShortcutMap

  for (const action of ENGLISH_SHORTCUT_ACTIONS) {
    const requested = normalizeShortcutBindingValue(raw[action.id] ?? DEFAULT_SHORTCUTS[action.id])
    if (!requested || !isShortcutBindingAllowed(requested)) {
      nextShortcutMap[action.id] = null
      continue
    }
    const signature = getShortcutSignature(requested)
    if (!signature || occupied.has(signature)) {
      nextShortcutMap[action.id] = null
      continue
    }
    occupied.add(signature)
    nextShortcutMap[action.id] = cloneShortcutBinding(requested)
  }

  return nextShortcutMap
}

function sanitizeBoolean(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value
  return fallback
}

export function sanitizeEnglishPracticeSettings(value: unknown): EnglishPracticeSettings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const rawSound = raw.sound && typeof raw.sound === 'object' ? (raw.sound as Record<string, unknown>) : {}
  const rawFlow = raw.flow && typeof raw.flow === 'object' ? (raw.flow as Record<string, unknown>) : {}
  const rawReplay = raw.replay && typeof raw.replay === 'object' ? (raw.replay as Record<string, unknown>) : {}
  return {
    shortcuts: sanitizeShortcutMap(raw.shortcuts),
    sound: {
      enabled: sanitizeBoolean(rawSound.enabled, DEFAULT_ENGLISH_PRACTICE_SETTINGS.sound.enabled),
    },
    flow: {
      autoAdvanceOnPass: sanitizeBoolean(
        rawFlow.autoAdvanceOnPass,
        DEFAULT_ENGLISH_PRACTICE_SETTINGS.flow.autoAdvanceOnPass,
      ),
    },
    replay: {
      autoReplayOnPass: sanitizeBoolean(
        rawReplay.autoReplayOnPass,
        DEFAULT_ENGLISH_PRACTICE_SETTINGS.replay.autoReplayOnPass,
      ),
      singleSentenceLoopEnabled: sanitizeBoolean(
        rawReplay.singleSentenceLoopEnabled,
        DEFAULT_ENGLISH_PRACTICE_SETTINGS.replay.singleSentenceLoopEnabled,
      ),
    },
  }
}

export function readEnglishPracticeSettings() {
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(ENGLISH_PRACTICE_SETTINGS_STORAGE_KEY)
      if (raw) {
        return sanitizeEnglishPracticeSettings(JSON.parse(raw))
      }
    } catch {
      return DEFAULT_ENGLISH_PRACTICE_SETTINGS
    }
  }

  const cached = getCachedClientPreference(
    'english_practice_settings',
    DEFAULT_ENGLISH_PRACTICE_SETTINGS,
    (value): value is EnglishPracticeSettings => Boolean(value && typeof value === 'object'),
  )
  if (cached !== DEFAULT_ENGLISH_PRACTICE_SETTINGS) {
    return sanitizeEnglishPracticeSettings(cached)
  }
  return DEFAULT_ENGLISH_PRACTICE_SETTINGS
}

export function writeEnglishPracticeSettings(settings: EnglishPracticeSettings) {
  const sanitized = sanitizeEnglishPracticeSettings(settings)
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(ENGLISH_PRACTICE_SETTINGS_STORAGE_KEY, JSON.stringify(sanitized))
    void setClientPreference('english_practice_settings', sanitized).then((saved) => {
      window.dispatchEvent(new CustomEvent(ENGLISH_PRACTICE_SETTINGS_UPDATED_EVENT, { detail: saved }))
    })
  }
  return sanitized
}

export function resetEnglishPracticeSettings() {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(ENGLISH_PRACTICE_SETTINGS_STORAGE_KEY)
    void setClientPreference('english_practice_settings', DEFAULT_ENGLISH_PRACTICE_SETTINGS).then((saved) => {
      window.dispatchEvent(
        new CustomEvent(ENGLISH_PRACTICE_SETTINGS_UPDATED_EVENT, {
          detail: saved,
        }),
      )
    })
  }
  return DEFAULT_ENGLISH_PRACTICE_SETTINGS
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

export function captureShortcutFromKeyboardEvent(event: KeyboardEvent) {
  const key = normalizeShortcutKeyValue(event.key)
  const code = normalizeShortcutCodeValue(event.code) || inferShortcutCodeFromKey(key)
  const hasModifier = Boolean(event.shiftKey || event.ctrlKey || event.altKey || event.metaKey)

  if (MODIFIER_ONLY_KEYS.has(key)) {
    return { value: null, error: '请按一个完整快捷键，单独的修饰键不能保存。' }
  }
  if (RESERVED_SHORTCUT_KEYS.has(key)) {
    if (key === 'escape') {
      return { value: null, error: 'Esc 需要保留给关闭弹窗和退出当前操作。' }
    }
    if (key === 'tab') {
      return { value: null, error: 'Tab 需要保留给焦点切换。' }
    }
    return {
      value: null,
      error: `${getShortcutLabel({ code, key, shift: false, ctrl: false, alt: false, meta: false })} 会影响输入，不建议设置为学习快捷键。`,
    }
  }
  if (!hasModifier && isPrintableShortcutKey(key)) {
    return {
      value: null,
      error: `「${key.toUpperCase()}」是答题输入键，容易误触。请改用 Shift、Ctrl、Alt 或 Meta 组合。`,
    }
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
    return {
      value: null,
      error: '该按键组合不在允许范围内，请改用带修饰键的组合或功能键。',
    }
  }

  return {
    value: candidate,
    error: '',
  }
}
