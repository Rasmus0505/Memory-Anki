import type { ClientPreferences } from '@/shared/api/contracts'
import type { BreakGuardConfig } from '@/shared/components/session/break-guard-config'
import type { TimerAutomationConfig } from '@/shared/components/session/timer-automation-config'
import type { TimerFocusConfig } from '@/shared/components/session/timer-focus-config'
import type { ThemePreference } from '@/shared/theme/themePreference'

export const APP_EVENT_NAMES = {
  clientPreferencesUpdated: 'memory-anki-client-preferences-updated',
  palaceCatalogInvalidated: 'palace-catalog:invalidated',
  reviewStateChanged: 'review-state:changed',
  timerAutomationUpdated: 'memory-anki-timer-automation-change',
  timerFocusUpdated: 'memory-anki-timer-focus-change',
  breakGuardUpdated: 'memory-anki-break-guard-config-change',
  themeUpdated: 'memory-anki-theme-updated',
} as const

export interface AppEventMap {
  [APP_EVENT_NAMES.clientPreferencesUpdated]: Partial<ClientPreferences>
  [APP_EVENT_NAMES.palaceCatalogInvalidated]: undefined
  [APP_EVENT_NAMES.reviewStateChanged]: {
    palaceId: number
    chapterId: number | null
    completedStageCount: number
    totalStageCount: number
    mastered: boolean
    nextReviewAt: string | null
  }
  [APP_EVENT_NAMES.timerAutomationUpdated]: TimerAutomationConfig
  [APP_EVENT_NAMES.timerFocusUpdated]: TimerFocusConfig
  [APP_EVENT_NAMES.breakGuardUpdated]: BreakGuardConfig
  [APP_EVENT_NAMES.themeUpdated]: ThemePreference
}

export type AppEventName = keyof AppEventMap

type AppEventHandler<Detail> = (detail: Detail, event: CustomEvent<Detail>) => void

type AppEventDetailArgs<Name extends AppEventName> = undefined extends AppEventMap[Name]
  ? [detail?: AppEventMap[Name]]
  : [detail: AppEventMap[Name]]

export function emitAppEvent<Name extends AppEventName>(
  name: Name,
  ...args: AppEventDetailArgs<Name>
): void
export function emitAppEvent(name: string, detail?: unknown): void
export function emitAppEvent(name: string, detail?: unknown) {
  if (typeof window === 'undefined') return
  const init = arguments.length >= 2 ? { detail } : undefined
  window.dispatchEvent(new CustomEvent(name, init))
}

export function onAppEvent<Name extends AppEventName>(
  name: Name,
  handler: AppEventHandler<AppEventMap[Name]>,
): () => void
export function onAppEvent<Detail = unknown>(
  name: string,
  handler: AppEventHandler<Detail>,
): () => void
export function onAppEvent<Detail = unknown>(
  name: string,
  handler: AppEventHandler<Detail>,
) {
  if (typeof window === 'undefined') return () => {}
  const listener = (event: Event) => {
    const customEvent = event as CustomEvent<Detail>
    handler(customEvent.detail, customEvent)
  }
  window.addEventListener(name, listener)
  return () => {
    window.removeEventListener(name, listener)
  }
}
