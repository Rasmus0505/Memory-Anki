import {
  captureShortcutFromKeyboardEvent as captureKeyboardShortcut,
  cloneShortcutBinding,
  getShortcutLabel,
  getShortcutSignature,
  isShortcutBindingAllowed,
  isShortcutPressed,
  normalizeShortcutBindingValue,
  type ShortcutBinding,
} from '@/shared/keyboard/shortcutBindings'
import { isEditableKeyboardTarget } from '@/shared/keyboard/keyboardTargets'
import { createPersistentPreferenceStore } from '@/shared/preferences/persistentPreferenceStore'
import { useEffect, useMemo, useState } from 'react'

export type { ShortcutBinding }
export { getShortcutLabel, getShortcutSignature, isShortcutPressed, normalizeShortcutBindingValue }

export type ShortcutScene = 'edit' | 'practice' | 'review'
export type MemoryAnkiShortcutActionId =
  | 'toggle_focus_node'
  | 'hide_child_cards_practice'
  | 'hide_child_cards_review'

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

export const MEMORY_ANKI_SHORTCUT_ACTIONS: MemoryAnkiShortcutActionDefinition[] = [
  {
    id: 'toggle_focus_node',
    scene: 'edit',
    label: '标记/取消专项知识点',
    description: '对当前选中知识点切换专项标记。',
    defaultBinding: { code: 'KeyF', key: 'f', shift: true, ctrl: false, alt: false, meta: false },
  },
  {
    id: 'hide_child_cards_practice',
    scene: 'practice',
    label: '隐藏/取消子级知识点显示',
    description: '在回忆模式对当前选中知识点执行右键同款隐藏子级操作。',
    defaultBinding: { code: 'KeyH', key: 'h', shift: true, ctrl: false, alt: false, meta: false },
  },
  {
    id: 'hide_child_cards_review',
    scene: 'review',
    label: '隐藏/取消子级知识点显示',
    description: '在复习模式对当前选中知识点执行右键同款隐藏子级操作。',
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

export function captureShortcutFromKeyboardEvent(event: KeyboardEvent) {
  return captureKeyboardShortcut(event, {
    escapeReserved: 'Esc 需要保留给关闭弹窗和退出当前操作。',
    tabReserved: 'Tab 需要保留给焦点切换。',
    reservedKey: () => '该按键会影响输入或删除操作，不建议设置为学习快捷键。',
    barePrintable: (key) => `「${key.toUpperCase()}」容易与输入冲突，请改用组合键。`,
  })
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

const store = createPersistentPreferenceStore<MemoryAnkiShortcutMap>({
  cacheKey: 'memory_anki_shortcuts',
  defaultValue: DEFAULT_MEMORY_ANKI_SHORTCUTS,
  localStorageKey: MEMORY_ANKI_SHORTCUTS_STORAGE_KEY,
  sanitize: sanitizeMemoryAnkiShortcutMap,
  updatedEvent: MEMORY_ANKI_SHORTCUTS_UPDATED_EVENT,
  isValidCache: (value): value is MemoryAnkiShortcutMap => Boolean(value && typeof value === 'object'),
})

export const readMemoryAnkiShortcuts = store.read
export const writeMemoryAnkiShortcuts = store.write
export const resetMemoryAnkiShortcuts = store.reset

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
      if (event.defaultPrevented || isEditableKeyboardTarget(event.target)) return
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
