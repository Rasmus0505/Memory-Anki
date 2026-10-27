import {
  captureShortcutFromKeyboardEvent as captureKeyboardShortcut,
  cloneShortcutBinding,
  getShortcutLabel,
  getShortcutSignature,
  isShortcutBindingAllowed,
  isShortcutPressed,
  normalizeShortcutBindingValue,
  type ShortcutAllowOptions,
  type ShortcutBinding,
} from '@/shared/keyboard/shortcutBindings'
import {
  isEditableKeyboardTarget,
  isKeyboardOverlayTarget,
  isKeyboardShortcutSuspended,
} from '@/shared/keyboard/keyboardTargets'
import { createPersistentPreferenceStore } from '@/shared/preferences/persistentPreferenceStore'
import { useEffect, useMemo, useRef, useState } from 'react'

export type { ShortcutBinding }
export { getShortcutLabel, getShortcutSignature, isShortcutPressed, normalizeShortcutBindingValue }

/**
 * Flip-card keyboard map. One scene covers every flip surface (随心页 and formal
 * 复习/练习), so a learner configures Enter/Backspace/A/S once instead of per mode.
 */
export type ShortcutScene = 'flip'
export type MemoryAnkiShortcutActionId =
  | 'flip_current_card'
  | 'retract_current_card'
  | 'page_previous_card'
  | 'page_next_card'
  | 'flip_subtree_cards'
  | 'flip_direct_child_cards'
  | 'hide_child_cards'

export interface MemoryAnkiShortcutActionDefinition {
  id: MemoryAnkiShortcutActionId
  scene: ShortcutScene
  label: string
  description: string
  defaultBinding: ShortcutBinding | null
}

export type MemoryAnkiShortcutMap = Record<MemoryAnkiShortcutActionId, ShortcutBinding | null>
/**
 * Return `false` to skip preventDefault (handler chose not to run, e.g. a focused
 * button must receive Enter). Other returns swallow the key.
 */
export type MemoryAnkiShortcutHandlers = Partial<
  Record<MemoryAnkiShortcutActionId, (event: KeyboardEvent) => boolean | void>
>

export const MEMORY_ANKI_SHORTCUTS_STORAGE_KEY = 'memory_anki_shortcuts'
export const MEMORY_ANKI_SHORTCUTS_UPDATED_EVENT = 'memory-anki-shortcuts-change'

/**
 * Backspace is 收卡, so bare Backspace/Delete must be allowed here. Input fields
 * still never reach the map (`isEditableKeyboardTarget`), and dialogs suspend it.
 */
export const MEMORY_ANKI_SHORTCUT_ALLOW_OPTIONS: ShortcutAllowOptions = {
  allowBareLetters: true,
  allowBareDeleteKeys: true,
}

function binding(
  code: string,
  key: string,
  modifiers: Partial<Pick<ShortcutBinding, 'shift' | 'ctrl' | 'alt' | 'meta'>> = {},
): ShortcutBinding {
  return {
    code,
    key,
    shift: false,
    ctrl: false,
    alt: false,
    meta: false,
    ...modifiers,
  }
}

const BARE_KEY_A = binding('KeyA', 'a')
const BARE_KEY_S = binding('KeyS', 's')

export const MEMORY_ANKI_SHORTCUT_ACTIONS: MemoryAnkiShortcutActionDefinition[] = [
  {
    id: 'flip_current_card',
    scene: 'flip',
    label: '翻卡',
    description: '翻开当前正在学习的卡：先出待回忆占位，再按一次出内容。',
    defaultBinding: binding('Enter', 'enter'),
  },
  {
    id: 'retract_current_card',
    scene: 'flip',
    label: '收卡',
    description: '把当前卡收回成待回忆，并折起它下面翻开的子卡；可以再按翻卡重新来。',
    defaultBinding: binding('Backspace', 'backspace'),
  },
  {
    id: 'page_previous_card',
    scene: 'flip',
    label: '上一张',
    description: '随心页翻到上一张卡。← 也是固定翻页键；PageUp / 空格同样可用。',
    defaultBinding: binding('ArrowUp', 'arrowup'),
  },
  {
    id: 'page_next_card',
    scene: 'flip',
    label: '下一张',
    description: '随心页翻到下一张卡。→ 也是固定翻页键；PageDown / 空格同样可用。',
    defaultBinding: binding('ArrowDown', 'arrowdown'),
  },
  {
    id: 'flip_subtree_cards',
    scene: 'flip',
    label: '翻开下方全部子卡',
    description: '悬停卡片上：第一次翻出全部后代占位符，再按一次翻出内容。无悬停时用当前卡。',
    defaultBinding: BARE_KEY_A,
  },
  {
    id: 'flip_direct_child_cards',
    scene: 'flip',
    label: '翻开下方一级子卡',
    description: '悬停卡片上：第一次翻出一级子卡占位符，再按一次翻出内容。无悬停时用当前卡。',
    defaultBinding: BARE_KEY_S,
  },
  {
    id: 'hide_child_cards',
    scene: 'flip',
    label: '隐藏/取消子级知识点显示',
    description: '对当前选中的知识点执行右键同款隐藏子级操作。',
    defaultBinding: binding('KeyH', 'h', { shift: true }),
  },
]

/**
 * Keys the 随心 feed always owns. A flip action must never capture them: the
 * page-turn contract is fixed even when the configurable map is rebound.
 */
export const RESERVED_FLIP_SHORTCUT_CODES = [
  'Space',
  'PageUp',
  'PageDown',
  'ArrowLeft',
  'ArrowRight',
] as const
const RESERVED_FLIP_SHORTCUT_CODE_SET = new Set<string>(RESERVED_FLIP_SHORTCUT_CODES)

export const DEFAULT_MEMORY_ANKI_SHORTCUTS: MemoryAnkiShortcutMap = MEMORY_ANKI_SHORTCUT_ACTIONS.reduce(
  (acc, action) => {
    acc[action.id] = action.defaultBinding
    return acc
  },
  {} as MemoryAnkiShortcutMap,
)

export function captureShortcutFromKeyboardEvent(event: KeyboardEvent) {
  return captureKeyboardShortcut(
    event,
    {
      escapeReserved: 'Esc 需要保留给关闭弹窗和退出当前操作。',
      tabReserved: 'Tab 需要保留给焦点切换。',
      reservedKey: () => '该按键会影响输入或删除操作，不建议设置为学习快捷键。',
      barePrintable: (key) => `「${key.toUpperCase()}」容易与输入冲突，请改用组合键。`,
    },
    MEMORY_ANKI_SHORTCUT_ALLOW_OPTIONS,
  )
}

export function sanitizeMemoryAnkiShortcutMap(rawShortcutMap: unknown): MemoryAnkiShortcutMap {
  const raw =
    rawShortcutMap && typeof rawShortcutMap === 'object'
      ? (rawShortcutMap as Partial<Record<MemoryAnkiShortcutActionId, unknown>>)
      : {}
  const occupiedByScene = new Map<ShortcutScene, Set<string>>()
  const nextShortcutMap = {} as MemoryAnkiShortcutMap

  for (const action of MEMORY_ANKI_SHORTCUT_ACTIONS) {
    // An explicit null is the learner clearing that action; a missing key is a
    // new action that should inherit its default. `??` would collapse both.
    const rawBinding = Object.prototype.hasOwnProperty.call(raw, action.id)
      ? raw[action.id]
      : DEFAULT_MEMORY_ANKI_SHORTCUTS[action.id]
    const requested = normalizeShortcutBindingValue(rawBinding)
    if (!requested || !isShortcutBindingAllowed(requested, MEMORY_ANKI_SHORTCUT_ALLOW_OPTIONS)) {
      nextShortcutMap[action.id] = null
      continue
    }
    const pageAction = action.id === 'page_previous_card' || action.id === 'page_next_card'
    if (!pageAction && RESERVED_FLIP_SHORTCUT_CODE_SET.has(requested.code)) {
      // A stored map from an older build (or hand-edited storage) must not let
      // 翻卡 steal Space / PageUp / PageDown / ← / → from the feed.
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

/** Subscribe to the persisted map without owning any key listener. */
export function useMemoryAnkiShortcutMap() {
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

  return shortcuts
}

/**
 * Page direction for the 随心 feed: the configured 上一张/下一张 binding first,
 * then the fixed ←/→ keys. PageUp/PageDown/Space stay with the feed itself.
 */
export function resolveFlipCardPageDirection(
  event: KeyboardEvent,
  shortcuts: MemoryAnkiShortcutMap,
): 'previous' | 'next' | null {
  if (isShortcutPressed(event, shortcuts.page_previous_card)) return 'previous'
  if (isShortcutPressed(event, shortcuts.page_next_card)) return 'next'
  if (event.key === 'ArrowLeft') return 'previous'
  if (event.key === 'ArrowRight') return 'next'
  return null
}

export interface MemoryAnkiShortcutHookOptions {
  /**
   * The hook owner itself lives inside a dialog/menu (the palace preview
   * reader). Its keys belong to it; every other hook still treats the overlay
   * as closed to page-level shortcuts.
   */
  allowOverlayTarget?: boolean
}

export function useMemoryAnkiShortcuts(
  scene: ShortcutScene,
  handlers: MemoryAnkiShortcutHandlers,
  enabled = true,
  options: MemoryAnkiShortcutHookOptions = {},
) {
  const allowOverlayTarget = options.allowOverlayTarget === true
  const shortcuts = useMemoryAnkiShortcutMap()
  // Always invoke the latest handlers without tearing down the capture listener.
  // Rebinding on every handlers identity change missed keydowns during React commits
  // and made bare A/S flip feel intermittent under heavy re-renders.
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const shortcutsRef = useRef(shortcuts)
  shortcutsRef.current = shortcuts

  const sceneActions = useMemo(
    () => MEMORY_ANKI_SHORTCUT_ACTIONS.filter((action) => action.scene === scene),
    [scene],
  )

  useEffect(() => {
    if (!enabled) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        isEditableKeyboardTarget(event.target) ||
        isKeyboardOverlayTarget(event.target, { allowDialog: allowOverlayTarget }) ||
        isKeyboardShortcutSuspended()
      ) return
      // Bare letter shortcuts must not fire while IME is composing.
      if (event.isComposing || event.key === 'Process') return
      const matchedAction = sceneActions.find((action) =>
        isShortcutPressed(event, shortcutsRef.current[action.id]),
      )
      if (!matchedAction) return
      const handler = handlersRef.current[matchedAction.id]
      if (!handler) return
      // Only swallow the key when the handler actually ran (not false).
      const handled = handler(event)
      if (handled === false) return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [allowOverlayTarget, enabled, sceneActions])

  return shortcuts
}
