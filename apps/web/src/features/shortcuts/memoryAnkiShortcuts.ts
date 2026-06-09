import { useEffect, useMemo, useState } from 'react'
import {
  getCachedClientPreference,
  setClientPreference,
} from '@/shared/preferences/clientPreferences'

export type ShortcutScene = 'edit' | 'practice' | 'review'
export type MemoryAnkiShortcutActionId =
  | 'toggle_focus_node'
  | 'hide_child_cards_practice'
  | 'hide_child_cards_review'

export interface ShortcutBinding {
  code: string
  key: string
  shift: boolean
  ctrl: boolean
  alt: boolean
  meta: boolean
}

export interface MemoryAnkiShortcutActionDefinition {
  id: MemoryAnkiShortcutActionId
  scene: ShortcutScene
  label: string
  description: string
  defaultBinding: ShortcutBinding | null
}

export type MemoryAnkiShortcutMap = Record<MemoryAnkiShortcutActionId, ShortcutBinding | null>
export type MemoryAnkiShortcutHandlers = Partial<Record<MemoryAnkiShortcutActionId, () => void>>

export const MEMORY_ANKI_SHORTCUTS_STORAGE_KEY = 'memory_anki_shortcuts'
export const MEMORY_ANKI_SHORTCUTS_UPDATED_EVENT = 'memory-anki-shortcuts-change'

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

export const MEMORY_ANKI_SHORTCUT_ACTIONS: MemoryAnkiShortcutActionDefinition[] = [
  {
    id: 'toggle_focus_node',
    scene: 'edit',
    label: '标记/取消专项卡',
    description: '对当前选中节点切换专项卡标记。',
    defaultBinding: { code: 'KeyF', key: 'f', shift: true, ctrl: false, alt: false, meta: false },
  },
  {
    id: 'hide_child_cards_practice',
    scene: 'practice',
    label: '隐藏/取消子级卡片显示',
    description: '在练习模式对当前选中节点执行右键同款隐藏子级操作。',
    defaultBinding: { code: 'KeyH', key: 'h', shift: true, ctrl: false, alt: false, meta: false },
  },
  {
    id: 'hide_child_cards_review',
    scene: 'review',
    label: '隐藏/取消子级卡片显示',
    description: '在复习模式对当前选中节点执行右键同款隐藏子级操作。',
    defaultBinding: { code: 'KeyH', key: 'h', shift: true, ctrl: false, alt: false, meta: false },
  },
]

export const DEFAULT_MEMORY_ANKI_SHORTCUTS: MemoryAnkiShortcutMap = MEMORY_ANKI_SHORTCUT_ACTIONS.reduce(
  (acc, action) => {
    acc[action.id] = action.defaultBinding
    return acc
  },
  {} as MemoryAnkiShortcutMap,
)

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

export function sanitizeMemoryAnkiShortcutMap(rawShortcutMap: unknown): MemoryAnkiShortcutMap {
  const raw =
    rawShortcutMap && typeof rawShortcutMap === 'object'
      ? (rawShortcutMap as Partial<Record<MemoryAnkiShortcutActionId, unknown>>)
      : {}
  const occupiedByScene = new Map<ShortcutScene, Set<string>>()
  const nextShortcutMap = {} as MemoryAnkiShortcutMap

  for (const action of MEMORY_ANKI_SHORTCUT_ACTIONS) {
    const requested = normalizeShortcutBindingValue(raw[action.id] ?? DEFAULT_MEMORY_ANKI_SHORTCUTS[action.id])
    if (!requested || !isShortcutBindingAllowed(requested)) {
      nextShortcutMap[action.id] = null
      continue
    }
    const signature = getShortcutSignature(requested)
    const occupied = occupiedByScene.get(action.scene) ?? new Set<string>()
    occupiedByScene.set(action.scene, occupied)
    if (!signature || occupied.has(signature)) {
      nextShortcutMap[action.id] = null
      continue
    }
    occupied.add(signature)
    nextShortcutMap[action.id] = cloneShortcutBinding(requested)
  }

  return nextShortcutMap
}

export function readMemoryAnkiShortcuts() {
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(MEMORY_ANKI_SHORTCUTS_STORAGE_KEY)
      if (raw) {
        return sanitizeMemoryAnkiShortcutMap(JSON.parse(raw))
      }
    } catch {
      return DEFAULT_MEMORY_ANKI_SHORTCUTS
    }
  }

  const cached = getCachedClientPreference(
    'memory_anki_shortcuts',
    DEFAULT_MEMORY_ANKI_SHORTCUTS,
    (value): value is MemoryAnkiShortcutMap => Boolean(value && typeof value === 'object'),
  )
  if (cached !== DEFAULT_MEMORY_ANKI_SHORTCUTS) {
    return sanitizeMemoryAnkiShortcutMap(cached)
  }
  return DEFAULT_MEMORY_ANKI_SHORTCUTS
}

export function writeMemoryAnkiShortcuts(shortcuts: MemoryAnkiShortcutMap) {
  const sanitized = sanitizeMemoryAnkiShortcutMap(shortcuts)
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(MEMORY_ANKI_SHORTCUTS_STORAGE_KEY, JSON.stringify(sanitized))
    void setClientPreference('memory_anki_shortcuts', sanitized).then((saved) => {
      window.dispatchEvent(new CustomEvent(MEMORY_ANKI_SHORTCUTS_UPDATED_EVENT, { detail: saved }))
    })
  }
  return sanitized
}

export function resetMemoryAnkiShortcuts() {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(MEMORY_ANKI_SHORTCUTS_STORAGE_KEY)
    void setClientPreference('memory_anki_shortcuts', DEFAULT_MEMORY_ANKI_SHORTCUTS).then((saved) => {
      window.dispatchEvent(
        new CustomEvent(MEMORY_ANKI_SHORTCUTS_UPDATED_EVENT, {
          detail: saved,
        }),
      )
    })
  }
  return DEFAULT_MEMORY_ANKI_SHORTCUTS
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
    if (key === 'escape') return { value: null, error: 'Esc 需要保留给关闭弹窗和退出当前操作。' }
    if (key === 'tab') return { value: null, error: 'Tab 需要保留给焦点切换。' }
    return { value: null, error: '该按键会影响输入或删除操作，不建议设置为学习快捷键。' }
  }
  if (!hasModifier && isPrintableShortcutKey(key)) {
    return { value: null, error: `「${key.toUpperCase()}」容易与输入冲突，请改用组合键。` }
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
    return { value: null, error: '该按键组合不在允许范围内，请改用带修饰键的组合或功能键。' }
  }
  return { value: candidate, error: '' }
}

function isEditableTarget(target: EventTarget | null) {
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

export function useMemoryAnkiShortcuts(
  scene: ShortcutScene,
  handlers: MemoryAnkiShortcutHandlers,
  enabled = true,
) {
  const [shortcuts, setShortcuts] = useState<MemoryAnkiShortcutMap>(() => readMemoryAnkiShortcuts())

  useEffect(() => {
    const handleUpdate = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null
      setShortcuts(sanitizeMemoryAnkiShortcutMap(detail ?? readMemoryAnkiShortcuts()))
    }
    window.addEventListener(MEMORY_ANKI_SHORTCUTS_UPDATED_EVENT, handleUpdate)
    window.addEventListener('storage', handleUpdate)
    return () => {
      window.removeEventListener(MEMORY_ANKI_SHORTCUTS_UPDATED_EVENT, handleUpdate)
      window.removeEventListener('storage', handleUpdate)
    }
  }, [])

  const sceneActions = useMemo(
    () => MEMORY_ANKI_SHORTCUT_ACTIONS.filter((action) => action.scene === scene),
    [scene],
  )

  useEffect(() => {
    if (!enabled) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) return
      const matchedAction = sceneActions.find((action) => isShortcutPressed(event, shortcuts[action.id]))
      if (!matchedAction) return
      const handler = handlers[matchedAction.id]
      if (!handler) return
      event.preventDefault()
      event.stopPropagation()
      handler()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [enabled, handlers, sceneActions, shortcuts])

  return shortcuts
}
