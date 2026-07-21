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
import { useEffect, useMemo, useRef, useState } from 'react'

export type { ShortcutBinding }
export { getShortcutLabel, getShortcutSignature, isShortcutPressed, normalizeShortcutBindingValue }

export type ShortcutScene = 'edit' | 'practice' | 'review'
export type MemoryAnkiShortcutActionId =
  | 'hide_child_cards_practice'
  | 'hide_child_cards_review'
  | 'flip_subtree_cards_practice'
  | 'flip_subtree_cards_review'
  | 'flip_direct_child_cards_practice'
  | 'flip_direct_child_cards_review'

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

const BARE_KEY_A: ShortcutBinding = {
  code: 'KeyA',
  key: 'a',
  shift: false,
  ctrl: false,
  alt: false,
  meta: false,
}
const BARE_KEY_S: ShortcutBinding = {
  code: 'KeyS',
  key: 's',
  shift: false,
  ctrl: false,
  alt: false,
  meta: false,
}

export const MEMORY_ANKI_SHORTCUT_ACTIONS: MemoryAnkiShortcutActionDefinition[] = [
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
  {
    id: 'flip_subtree_cards_practice',
    scene: 'practice',
    label: '翻开下方全部子卡',
    description: '悬停卡片上：第一次翻出全部后代占位符，再按一次翻出内容。无悬停时用当前选中卡片。',
    defaultBinding: BARE_KEY_A,
  },
  {
    id: 'flip_subtree_cards_review',
    scene: 'review',
    label: '翻开下方全部子卡',
    description: '悬停卡片上：第一次翻出全部后代占位符，再按一次翻出内容。无悬停时用当前选中卡片。',
    defaultBinding: BARE_KEY_A,
  },
  {
    id: 'flip_direct_child_cards_practice',
    scene: 'practice',
    label: '翻开下方一级子卡',
    description: '悬停卡片上：第一次翻出一级子卡占位符，再按一次翻出内容。无悬停时用当前选中卡片。',
    defaultBinding: BARE_KEY_S,
  },
  {
    id: 'flip_direct_child_cards_review',
    scene: 'review',
    label: '翻开下方一级子卡',
    description: '悬停卡片上：第一次翻出一级子卡占位符，再按一次翻出内容。无悬停时用当前选中卡片。',
    defaultBinding: BARE_KEY_S,
  },
]

/** Flip-card bulk actions shown in the toolbar overflow shortcut dialog. */
export const FLIP_CARD_SHORTCUT_ACTION_IDS: MemoryAnkiShortcutActionId[] = [
  'flip_subtree_cards_practice',
  'flip_subtree_cards_review',
  'flip_direct_child_cards_practice',
  'flip_direct_child_cards_review',
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
  // Always invoke the latest handlers without tearing down the capture listener.
  // Rebinding on every handlers identity change missed keydowns during React commits
  // and made bare A/S flip feel intermittent under heavy re-renders.
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const shortcutsRef = useRef(shortcuts)
  shortcutsRef.current = shortcuts

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
      const matchedAction = sceneActions.find((action) =>
        isShortcutPressed(event, shortcutsRef.current[action.id]),
      )
      if (!matchedAction) return
      const handler = handlersRef.current[matchedAction.id]
      if (!handler) return
      event.preventDefault()
      event.stopPropagation()
      handler()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [enabled, sceneActions])

  return shortcuts
}
