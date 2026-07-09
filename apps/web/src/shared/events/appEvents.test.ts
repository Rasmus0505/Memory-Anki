import { describe, expect, it, vi } from 'vitest'
import { APP_EVENT_NAMES, emitAppEvent, onAppEvent } from './appEvents'

describe('appEvents', () => {
  it('emits and subscribes to typed app events', () => {
    const listener = vi.fn()
    const unsubscribe = onAppEvent(APP_EVENT_NAMES.clientPreferencesUpdated, (detail) => {
      listener(detail)
    })

    emitAppEvent(APP_EVENT_NAMES.clientPreferencesUpdated, {
      timer_automation_config: { mode: 'scene' },
    })

    expect(listener).toHaveBeenCalledWith({
      timer_automation_config: { mode: 'scene' },
    })
    unsubscribe()
  })

  it('returns an unsubscribe function', () => {
    const listener = vi.fn()
    const unsubscribe = onAppEvent(APP_EVENT_NAMES.palaceCatalogInvalidated, listener)

    unsubscribe()
    emitAppEvent(APP_EVENT_NAMES.palaceCatalogInvalidated)

    expect(listener).not.toHaveBeenCalled()
  })
})
