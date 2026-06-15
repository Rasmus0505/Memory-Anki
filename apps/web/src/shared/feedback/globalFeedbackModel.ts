import type { CSSProperties } from 'react'
import type {
  MindMapFeedbackEvent,
  MindMapFeedbackLevel,
  MindMapFeedbackOrigin,
} from '@/shared/components/mindmap-host/hostBridgeUtils'

export type FeedbackVisualKind =
  | 'tap'
  | 'confirm'
  | 'focus'
  | 'navigation'
  | 'toggle'
  | 'shortcut'
  | 'hover'
  | 'edit'
  | 'create'
  | 'danger'
  | 'reward'
  | 'link'
  | 'segment'
  | 'move'
  | 'mode'

export interface FeedbackDescriptor {
  audioEvent: MindMapFeedbackEvent
  visualKind: FeedbackVisualKind
  level: MindMapFeedbackLevel
  origin: MindMapFeedbackOrigin
  audioScope?: 'local' | 'global'
  hue: number
  size: number
  label?: string
  screenPulse?: 'soft' | 'navigation' | 'celebration'
}

export interface FeedbackBurst {
  id: number
  x: number
  y: number
  descriptor: FeedbackDescriptor
}

export type KeyboardLikeEvent = Pick<
  KeyboardEvent,
  'key' | 'ctrlKey' | 'altKey' | 'metaKey' | 'repeat'
>

interface MindMapFeedbackProfile {
  visualKind: FeedbackVisualKind
  level: MindMapFeedbackLevel
  origin: MindMapFeedbackOrigin
  audioScope?: 'local' | 'global'
  hue: number
  size: number
  label?: string
  screenPulse?: FeedbackDescriptor['screenPulse']
}

export interface GlobalFeedbackRequestDetail {
  event: MindMapFeedbackEvent
  point?: { x: number; y: number }
  label?: string
  level?: MindMapFeedbackLevel
  origin?: MindMapFeedbackOrigin
  audioScope?: 'local' | 'global'
  screenPulse?: FeedbackDescriptor['screenPulse'] | null
}

export const GLOBAL_FEEDBACK_REQUEST_EVENT = 'memory-anki-global-feedback-request'

const MIND_MAP_FEEDBACK_PROFILES: Record<MindMapFeedbackEvent, MindMapFeedbackProfile> = {
  quiz_nav_open_practice: {
    visualKind: 'navigation',
    level: 'action',
    origin: 'system',
    audioScope: 'global',
    hue: 214,
    size: 94,
    label: 'GO',
    screenPulse: 'navigation',
  },
  quiz_nav_question_prev: {
    visualKind: 'navigation',
    level: 'action',
    origin: 'review',
    audioScope: 'local',
    hue: 210,
    size: 72,
    label: 'PREV',
  },
  quiz_nav_question_next: {
    visualKind: 'navigation',
    level: 'action',
    origin: 'review',
    audioScope: 'local',
    hue: 222,
    size: 72,
    label: 'NEXT',
  },
  quiz_nav_scope_change: {
    visualKind: 'segment',
    level: 'action',
    origin: 'review',
    audioScope: 'global',
    hue: 26,
    size: 84,
    label: 'SCOPE',
  },
  quiz_nav_view_switch: {
    visualKind: 'mode',
    level: 'action',
    origin: 'toolbar',
    audioScope: 'global',
    hue: 36,
    size: 84,
    label: 'VIEW',
    screenPulse: 'soft',
  },
  quiz_nav_tab_switch: {
    visualKind: 'mode',
    level: 'action',
    origin: 'toolbar',
    audioScope: 'global',
    hue: 34,
    size: 88,
    label: 'TAB',
    screenPulse: 'soft',
  },
  quiz_answer_select: {
    visualKind: 'focus',
    level: 'micro',
    origin: 'review',
    audioScope: 'local',
    hue: 188,
    size: 60,
    label: 'PICK',
  },
  quiz_answer_submit: {
    visualKind: 'confirm',
    level: 'action',
    origin: 'review',
    audioScope: 'local',
    hue: 156,
    size: 82,
    label: 'SUBMIT',
  },
  quiz_answer_reset: {
    visualKind: 'mode',
    level: 'action',
    origin: 'review',
    audioScope: 'local',
    hue: 214,
    size: 78,
    label: 'RESET',
  },
  quiz_result_correct: {
    visualKind: 'reward',
    level: 'action',
    origin: 'review',
    audioScope: 'local',
    hue: 145,
    size: 84,
    label: 'RIGHT',
  },
  quiz_result_incorrect: {
    visualKind: 'danger',
    level: 'action',
    origin: 'review',
    audioScope: 'local',
    hue: 4,
    size: 84,
    label: 'MISS',
  },
  quiz_result_reveal: {
    visualKind: 'reward',
    level: 'action',
    origin: 'review',
    audioScope: 'local',
    hue: 42,
    size: 92,
    label: 'REVEAL',
  },
  quiz_result_ai_feedback_ready: {
    visualKind: 'link',
    level: 'action',
    origin: 'system',
    audioScope: 'global',
    hue: 284,
    size: 88,
    label: 'AI',
  },
  quiz_manage_create_start: {
    visualKind: 'create',
    level: 'action',
    origin: 'toolbar',
    audioScope: 'local',
    hue: 145,
    size: 82,
    label: 'ADD',
  },
  quiz_manage_edit_start: {
    visualKind: 'edit',
    level: 'action',
    origin: 'toolbar',
    audioScope: 'local',
    hue: 198,
    size: 80,
    label: 'EDIT',
  },
  quiz_manage_save: {
    visualKind: 'confirm',
    level: 'action',
    origin: 'system',
    audioScope: 'global',
    hue: 156,
    size: 84,
    label: 'SAVE',
  },
  quiz_manage_delete: {
    visualKind: 'danger',
    level: 'action',
    origin: 'system',
    audioScope: 'local',
    hue: 4,
    size: 82,
    label: 'DEL',
  },
  quiz_manage_batch_delete: {
    visualKind: 'danger',
    level: 'milestone',
    origin: 'system',
    audioScope: 'global',
    hue: 2,
    size: 104,
    label: 'PURGE',
  },
  quiz_generate_start: {
    visualKind: 'shortcut',
    level: 'action',
    origin: 'system',
    audioScope: 'global',
    hue: 262,
    size: 88,
    label: 'GEN',
  },
  quiz_generate_attach_source: {
    visualKind: 'create',
    level: 'action',
    origin: 'system',
    audioScope: 'local',
    hue: 36,
    size: 82,
    label: 'LOAD',
  },
  quiz_generate_preview_ready: {
    visualKind: 'reward',
    level: 'action',
    origin: 'system',
    audioScope: 'global',
    hue: 42,
    size: 94,
    label: 'PREVIEW',
  },
  quiz_generate_save: {
    visualKind: 'create',
    level: 'milestone',
    origin: 'system',
    audioScope: 'global',
    hue: 145,
    size: 102,
    label: 'APPLY',
  },
  quiz_generate_classify_complete: {
    visualKind: 'segment',
    level: 'milestone',
    origin: 'system',
    audioScope: 'global',
    hue: 32,
    size: 108,
    label: 'GROUP',
    screenPulse: 'celebration',
  },
  quiz_generate_cancel: {
    visualKind: 'mode',
    level: 'action',
    origin: 'system',
    audioScope: 'global',
    hue: 18,
    size: 80,
    label: 'CANCEL',
  },
  quiz_error_missing_input: {
    visualKind: 'danger',
    level: 'action',
    origin: 'system',
    audioScope: 'local',
    hue: 12,
    size: 78,
    label: 'MISS',
  },
  quiz_error_ai_failed: {
    visualKind: 'danger',
    level: 'action',
    origin: 'system',
    audioScope: 'global',
    hue: 0,
    size: 90,
    label: 'AI ERR',
  },
  quiz_error_persist_failed: {
    visualKind: 'danger',
    level: 'action',
    origin: 'system',
    audioScope: 'global',
    hue: 0,
    size: 92,
    label: 'FAIL',
  },
  quiz_error_stat_failed: {
    visualKind: 'danger',
    level: 'action',
    origin: 'system',
    audioScope: 'local',
    hue: 6,
    size: 76,
    label: 'ERR',
  },
  pointer_down: { visualKind: 'tap', level: 'micro', origin: 'pointer', hue: 210, size: 48 },
  pointer_click: { visualKind: 'tap', level: 'micro', origin: 'pointer', hue: 210, size: 56 },
  hover_pulse: { visualKind: 'hover', level: 'micro', origin: 'pointer', hue: 210, size: 42 },
  key_press: { visualKind: 'edit', level: 'micro', origin: 'keyboard', hue: 188, size: 42 },
  shortcut_trigger: {
    visualKind: 'shortcut',
    level: 'action',
    origin: 'keyboard',
    hue: 262,
    size: 82,
    label: 'CMD',
  },
  navigation: {
    visualKind: 'navigation',
    level: 'action',
    origin: 'system',
    hue: 214,
    size: 96,
    label: 'GO',
    screenPulse: 'navigation',
  },
  field_focus: {
    visualKind: 'focus',
    level: 'micro',
    origin: 'keyboard',
    hue: 198,
    size: 64,
    label: 'FOCUS',
  },
  field_commit: {
    visualKind: 'confirm',
    level: 'action',
    origin: 'keyboard',
    hue: 156,
    size: 76,
    label: 'SAVE',
  },
  toggle_on: { visualKind: 'toggle', level: 'action', origin: 'pointer', hue: 145, size: 72, label: 'ON' },
  toggle_off: { visualKind: 'toggle', level: 'action', origin: 'pointer', hue: 18, size: 72, label: 'OFF' },
  text_commit: {
    visualKind: 'confirm',
    level: 'action',
    origin: 'keyboard',
    hue: 156,
    size: 78,
    label: 'SAVE',
  },
  node_select: { visualKind: 'focus', level: 'micro', origin: 'node', hue: 214, size: 54 },
  node_edit_start: {
    visualKind: 'edit',
    level: 'action',
    origin: 'node',
    hue: 198,
    size: 76,
    label: 'EDIT',
  },
  node_create: {
    visualKind: 'create',
    level: 'action',
    origin: 'node',
    hue: 145,
    size: 84,
    label: 'ADD',
  },
  node_delete: {
    visualKind: 'danger',
    level: 'action',
    origin: 'node',
    hue: 4,
    size: 82,
    label: 'DEL',
  },
  node_move: { visualKind: 'move', level: 'micro', origin: 'node', hue: 238, size: 58 },
  drag_start: { visualKind: 'move', level: 'micro', origin: 'pointer', hue: 238, size: 54 },
  drag_drop: {
    visualKind: 'move',
    level: 'action',
    origin: 'pointer',
    hue: 238,
    size: 78,
    label: 'DROP',
  },
  context_menu: {
    visualKind: 'mode',
    level: 'action',
    origin: 'pointer',
    hue: 36,
    size: 70,
    label: 'MENU',
  },
  toolbar_action: { visualKind: 'mode', level: 'micro', origin: 'toolbar', hue: 36, size: 58 },
  mode_switch: {
    visualKind: 'mode',
    level: 'action',
    origin: 'toolbar',
    hue: 36,
    size: 86,
    label: 'MODE',
    screenPulse: 'soft',
  },
  save_success: {
    visualKind: 'confirm',
    level: 'action',
    origin: 'system',
    hue: 156,
    size: 76,
    label: 'SAVE',
  },
  save_error: {
    visualKind: 'danger',
    level: 'action',
    origin: 'system',
    hue: 4,
    size: 86,
    label: 'ERR',
  },
  import_apply: {
    visualKind: 'create',
    level: 'milestone',
    origin: 'system',
    hue: 145,
    size: 98,
    label: 'APPLY',
  },
  bilink_action: {
    visualKind: 'link',
    level: 'action',
    origin: 'node',
    hue: 284,
    size: 78,
    label: 'LINK',
  },
  segment_action: {
    visualKind: 'segment',
    level: 'action',
    origin: 'node',
    hue: 26,
    size: 78,
    label: 'SEG',
  },
  category_expand: {
    visualKind: 'create',
    level: 'action',
    origin: 'review',
    hue: 42,
    size: 86,
    label: 'OPEN',
  },
  next_level_expand: {
    visualKind: 'create',
    level: 'action',
    origin: 'review',
    hue: 42,
    size: 82,
    label: 'OPEN',
  },
  card_reveal: {
    visualKind: 'reward',
    level: 'action',
    origin: 'review',
    hue: 42,
    size: 90,
    label: 'REVEAL',
  },
  branch_clear: {
    visualKind: 'reward',
    level: 'milestone',
    origin: 'review',
    hue: 145,
    size: 104,
    label: 'CLEAR',
  },
  all_clear_ready: {
    visualKind: 'reward',
    level: 'milestone',
    origin: 'review',
    hue: 42,
    size: 116,
    label: 'READY',
    screenPulse: 'celebration',
  },
  session_complete: {
    visualKind: 'reward',
    level: 'milestone',
    origin: 'review',
    hue: 42,
    size: 126,
    label: 'DONE',
    screenPulse: 'celebration',
  },
  session_reset: {
    visualKind: 'mode',
    level: 'action',
    origin: 'review',
    hue: 214,
    size: 84,
    label: 'RESET',
  },
}

export function getMindMapFeedbackProfile(event: MindMapFeedbackEvent) {
  return MIND_MAP_FEEDBACK_PROFILES[event]
}

export function createMindMapFeedbackDescriptor(
  event: MindMapFeedbackEvent,
  overrides: Omit<GlobalFeedbackRequestDetail, 'event' | 'point'> = {},
) {
  const profile = getMindMapFeedbackProfile(event)
  return {
    audioEvent: event,
    visualKind: profile.visualKind,
    level: overrides.level ?? profile.level,
    origin: overrides.origin ?? profile.origin,
    audioScope: overrides.audioScope ?? profile.audioScope,
    hue: profile.hue,
    size: profile.size,
    label: overrides.label ?? profile.label,
    screenPulse:
      overrides.screenPulse === null
        ? undefined
        : overrides.screenPulse ?? profile.screenPulse,
  } satisfies FeedbackDescriptor
}

export function dispatchGlobalFeedback(
  event: MindMapFeedbackEvent,
  options: Omit<GlobalFeedbackRequestDetail, 'event'> = {},
) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<GlobalFeedbackRequestDetail>(GLOBAL_FEEDBACK_REQUEST_EVENT, {
      detail: {
        event,
        ...options,
      },
    }),
  )
}

export const FEEDBACK_INTERACTIVE_SELECTOR = [
  '[data-feedback]',
  'button',
  'a[href]',
  'input',
  'textarea',
  'select',
  'summary',
  'label[for]',
  '[role="button"]',
  '[role="link"]',
  '[role="switch"]',
  '[role="tab"]',
].join(', ')

function matches(element: Element | null, selector: string) {
  return Boolean(element && 'matches' in element && element.matches(selector))
}

export function findInteractiveElement(target: EventTarget | null) {
  if (!(target instanceof Element)) return null
  const closest = target.closest(FEEDBACK_INTERACTIVE_SELECTOR)
  return closest instanceof HTMLElement ? closest : null
}

export function isTextEditableElement(element: HTMLElement | null) {
  if (!element) return false
  if (element instanceof HTMLInputElement) {
    return !['checkbox', 'radio', 'range', 'color', 'file'].includes(element.type)
  }
  return (
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    element.isContentEditable
  )
}

function resolveElementLabel(element: HTMLElement | null) {
  if (!element) return undefined
  const datasetLabel = element.dataset.feedbackLabel?.trim()
  if (datasetLabel) return datasetLabel
  const ariaLabel = element.getAttribute('aria-label')?.trim()
  if (ariaLabel) return ariaLabel
  const text = element.textContent?.replace(/\s+/g, ' ').trim()
  if (text) return text.slice(0, 18)
  return undefined
}

function isNavElement(element: HTMLElement | null) {
  return matches(element, 'a[href], [role="link"], nav a')
}

function isToggleElement(element: HTMLElement | null) {
  return (
    element instanceof HTMLInputElement &&
    (element.type === 'checkbox' || element.type === 'radio')
  ) || matches(element, '[role="switch"]')
}

function isPrimaryActionElement(element: HTMLElement | null) {
  return Boolean(
    element &&
      (matches(element, 'button, summary, [role="button"], [role="tab"]') ||
        (element instanceof HTMLInputElement &&
          ['button', 'submit', 'reset', 'range', 'color', 'file'].includes(element.type))),
  )
}

export function createPointerDescriptor(target: EventTarget | null, phase: 'down' | 'click') {
  const element = findInteractiveElement(target)
  if (!element) return null

  if (phase === 'down') {
    return {
      ...createMindMapFeedbackDescriptor('pointer_down', {
        label: resolveElementLabel(element),
      }),
      audioEvent: 'pointer_down',
      visualKind: 'tap',
      hue: isNavElement(element) ? 210 : isToggleElement(element) ? 145 : 32,
      size: isPrimaryActionElement(element) ? 58 : 48,
    } satisfies FeedbackDescriptor
  }

  if (isToggleElement(element)) {
    const isOn =
      element instanceof HTMLInputElement
        ? element.checked
        : element.getAttribute('aria-checked') === 'true'
    return {
      ...createMindMapFeedbackDescriptor(isOn ? 'toggle_on' : 'toggle_off'),
      audioEvent: isOn ? 'toggle_on' : 'toggle_off',
      visualKind: 'toggle',
      hue: isOn ? 145 : 18,
      size: 72,
      label: isOn ? 'ON' : 'OFF',
    } satisfies FeedbackDescriptor
  }

  if (isNavElement(element)) {
    return {
      ...createMindMapFeedbackDescriptor('navigation'),
      audioEvent: 'navigation',
      visualKind: 'navigation',
      hue: 214,
      size: 96,
      label: 'GO',
      screenPulse: 'navigation',
    } satisfies FeedbackDescriptor
  }

  if (isPrimaryActionElement(element)) {
    return {
      ...createMindMapFeedbackDescriptor('pointer_click', {
        label: resolveElementLabel(element),
      }),
      audioEvent: 'pointer_click',
      visualKind: 'confirm',
      hue: 35,
      level: 'action',
      size: 76,
    } satisfies FeedbackDescriptor
  }

  return {
    ...createMindMapFeedbackDescriptor('pointer_click', {
      label: resolveElementLabel(element),
    }),
    audioEvent: 'pointer_click',
    visualKind: 'tap',
    hue: 32,
    size: 58,
  } satisfies FeedbackDescriptor
}

export function createFocusDescriptor(target: EventTarget | null) {
  const element = findInteractiveElement(target)
  if (!isTextEditableElement(element)) return null
  return {
    ...createMindMapFeedbackDescriptor('field_focus'),
    audioEvent: 'field_focus',
    visualKind: 'focus',
    hue: 198,
    size: 64,
    label: 'FOCUS',
  } satisfies FeedbackDescriptor
}

export function createCommitDescriptor(target: EventTarget | null) {
  const element = findInteractiveElement(target)
  if (!element) return null

  if (isToggleElement(element)) {
    const isOn =
      element instanceof HTMLInputElement
        ? element.checked
        : element.getAttribute('aria-checked') === 'true'
    return {
      ...createMindMapFeedbackDescriptor(isOn ? 'toggle_on' : 'toggle_off'),
      audioEvent: isOn ? 'toggle_on' : 'toggle_off',
      visualKind: 'toggle',
      hue: isOn ? 145 : 18,
      size: 72,
      label: isOn ? 'ON' : 'OFF',
    } satisfies FeedbackDescriptor
  }

  if (!isTextEditableElement(element)) return null
  return {
    ...createMindMapFeedbackDescriptor('field_commit'),
    audioEvent: 'field_commit',
    visualKind: 'confirm',
    hue: 156,
    size: 76,
    label: 'SAVE',
  } satisfies FeedbackDescriptor
}

export function createHoverDescriptor(target: EventTarget | null) {
  const element = findInteractiveElement(target)
  if (!element || (!isNavElement(element) && !isPrimaryActionElement(element))) return null
  return {
    ...createMindMapFeedbackDescriptor('hover_pulse'),
    audioEvent: 'hover_pulse',
    visualKind: 'hover',
    hue: isNavElement(element) ? 214 : 36,
    size: isNavElement(element) ? 46 : 42,
  } satisfies FeedbackDescriptor
}

export function createKeyboardDescriptor(event: KeyboardLikeEvent) {
  if (event.ctrlKey || event.altKey || event.metaKey) {
    return {
      ...createMindMapFeedbackDescriptor('shortcut_trigger', {
        label: 'CMD',
      }),
      audioEvent: 'shortcut_trigger',
      visualKind: 'shortcut',
      hue: 284,
      size: 86,
      label: 'CMD',
    } satisfies FeedbackDescriptor
  }

  if (event.key === 'Enter' || event.key === 'Tab' || event.key === 'Escape') {
    return {
      ...createMindMapFeedbackDescriptor('shortcut_trigger', {
        label: event.key.toUpperCase(),
        level: 'action',
      }),
      audioEvent: 'shortcut_trigger',
      visualKind: 'shortcut',
      hue: 262,
      size: 82,
      label: event.key.toUpperCase(),
    } satisfies FeedbackDescriptor
  }

  if (
    event.key === 'ArrowUp' ||
    event.key === 'ArrowDown' ||
    event.key === 'ArrowLeft' ||
    event.key === 'ArrowRight' ||
    event.key === 'Home' ||
    event.key === 'End' ||
    event.key === 'PageUp' ||
    event.key === 'PageDown'
  ) {
    return {
      ...createMindMapFeedbackDescriptor('shortcut_trigger', {
        label: 'MOVE',
        level: 'micro',
      }),
      audioEvent: 'shortcut_trigger',
      visualKind: 'shortcut',
      hue: 214,
      size: 62,
      label: 'MOVE',
    } satisfies FeedbackDescriptor
  }

  if (
    event.key.length === 1 ||
    event.key === 'Backspace' ||
    event.key === 'Delete' ||
    event.key === 'Process' ||
    event.key === 'Unidentified'
  ) {
    return {
      ...createMindMapFeedbackDescriptor('key_press'),
      audioEvent: 'key_press',
      visualKind: 'edit',
      hue: 188,
      size: 42,
    } satisfies FeedbackDescriptor
  }

  return {
    ...createMindMapFeedbackDescriptor('key_press'),
    audioEvent: 'key_press',
    visualKind: 'edit',
    hue: 224,
    size: 44,
  } satisfies FeedbackDescriptor
}

export function createRouteDescriptor() {
  return {
    ...createMindMapFeedbackDescriptor('navigation', {
      label: 'FLOW',
    }),
    audioEvent: 'navigation',
    visualKind: 'navigation',
    hue: 214,
    size: 112,
    label: 'FLOW',
    screenPulse: 'navigation',
  } satisfies FeedbackDescriptor
}

export function resolveFeedbackPoint(
  target: EventTarget | null,
  fallback?: { x: number; y: number },
) {
  if (fallback) {
    return fallback
  }
  const element = findInteractiveElement(target)
  if (!element) return null
  const rect = element.getBoundingClientRect()
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  }
}

export function buildFeedbackStyle(burst: FeedbackBurst) {
  return {
    left: `${burst.x}px`,
    top: `${burst.y}px`,
    '--feedback-hue': `${burst.descriptor.hue}`,
    '--feedback-size': `${burst.descriptor.size}px`,
  } as CSSProperties
}
