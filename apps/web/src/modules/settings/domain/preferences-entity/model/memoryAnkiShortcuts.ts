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
 * 复习/练习), so a learner configures Enter/Backspace once instead of per mode.
 * W/A/S/D are not in this map: the 随心 mind map owns them as fixed view-port
 * pan keys (`useMindMapViewPanKeys`), so no flip action may capture them.
 */
export type ShortcutScene = 'flip'
export type MemoryAnkiShortcutActionId =
  | 'flip_current_card'
  | 'retract_current_card'
  | 'page_previous_card'
  | 'page_next_card'
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

const BARE_KEY_H = binding('KeyH', 'h', { shift: true })

export const MEMORY_ANKI_SHORTCUT_ACTIONS: MemoryAnkiShortcutActionDefinition[] = [
  {
    id: 'flip_current_card',
    scene: 'flip',
    label: '翻卡',
    description: '翻开当前正在学习的卡；揭示方式决定先出待回忆占位符还是直接出内容。',
    defaultBinding: binding('Enter', 'enter'),
  },
  {
    id: 'retract_current_card',
    scene: 'flip',
    label: '收卡',
    description: '收回当前卡并折起它下面翻开的子卡：两阶段回到待回忆，直接显示则整张收起；可以再按翻卡重新来。',
    defaultBinding: binding('Backspace', 'backspace'),
  },
  {
    id: 'page_previous_card',
    scene: 'flip',
    label: '上一张',
    description: '随心页翻到上一张卡。← 也是固定翻页键；PageUp 同样可用。',
    defaultBinding: binding('ArrowUp', 'arrowup'),
  },
  {
    id: 'page_next_card',
    scene: 'flip',
    label: '下一张',
    description: '随心页翻到下一张卡。→ 也是固定翻页键；PageDown 同样可用。',
    defaultBinding: binding('ArrowDown', 'arrowdown'),
  },
  {
    id: 'hide_child_cards',
    scene: 'flip',
    label: '隐藏/取消子级知识点显示',
    description: '对当前选中的知识点执行右键同款隐藏子级操作。',
    defaultBinding: BARE_KEY_H,
  },
]

/**
 * Keys the 随心 canvas always owns. A flip action must never capture them: the
 * page-turn and view-pan contracts are fixed even when the map is rebound.
 *
 * Space is in the list without being a page key any more. It is the character a
 * learner types inside a card editor, so no flip action may take it; the feed
 * pages on PageUp / PageDown and ← / → only.
 */
export const RESERVED_FLIP_SHORTCUT_CODES = [
  'Space',
  'PageUp',
  'PageDown',
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
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
      // 翻卡 steal Space (typing) / PageUp / PageDown / ← / → (feed paging).
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
 * then the fixed ←/→ keys. PageUp/PageDown stay with the feed itself; Space is
 * not a page key (it belongs to whatever text the learner is typing).
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
