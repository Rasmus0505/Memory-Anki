import type { CSSProperties } from 'react'
import type {
  MindMapFeedbackEvent,
  MindMapFeedbackLevel,
  MindMapFeedbackOrigin,
} from '@/shared/components/mindmap-host/hostBridgeUtils'
import {
  type FeedbackBurst,
  type FeedbackDescriptor,
  type KeyboardLikeEvent,
} from './feedbackTypes'
import { getMindMapFeedbackProfile } from './globalFeedbackProfiles'

export type {
  FeedbackBurst,
  FeedbackDescriptor,
  FeedbackVisualKind,
  KeyboardLikeEvent,
} from './feedbackTypes'
export { getMindMapFeedbackProfile } from './globalFeedbackProfiles'

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
