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
  [APP_EVENT_NAMES.reviewStateChanged]: undefined
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

const WINDOW_CHANNEL = 'memory-anki-window'
const TAB_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`
let windowChannel: BroadcastChannel | null | undefined

function bridgeWindowEvents(): BroadcastChannel | null {
  if (windowChannel !== undefined) return windowChannel
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    windowChannel = null
    return null
  }
  try {
    const channel = new BroadcastChannel(WINDOW_CHANNEL)
    channel.onmessage = (event: MessageEvent) => {
      const data = event.data as { name?: string; detail?: unknown; sender?: string } | null
      if (!data || data.sender === TAB_ID || typeof data.name !== 'string') return
      const delivered = new CustomEvent(data.name, { detail: data.detail })
      Object.defineProperty(delivered, 'remote', { value: true })
      window.dispatchEvent(delivered)
    }
    windowChannel = channel
    return channel
  } catch {
    windowChannel = null
    return null
  }
}

export function isRemoteWindowEvent(event: Event | undefined): boolean {
  return Boolean(event && (event as Event & { remote?: boolean }).remote)
}

export function emitAppEvent<Name extends AppEventName>(
  name: Name,
  ...args: AppEventDetailArgs<Name>
): void
export function emitAppEvent(name: string, detail?: unknown): void
export function emitAppEvent(name: string, detail?: unknown) {
  if (typeof window === 'undefined') return
  const init = arguments.length >= 2 ? { detail } : undefined
  window.dispatchEvent(new CustomEvent(name, init))
  bridgeWindowEvents()?.postMessage({ name, detail, sender: TAB_ID })
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
  bridgeWindowEvents()
  const listener = (event: Event) => {
    const customEvent = event as CustomEvent<Detail>
    handler(customEvent.detail, customEvent)
  }
  window.addEventListener(name, listener)
  return () => {
    window.removeEventListener(name, listener)
  }
}
