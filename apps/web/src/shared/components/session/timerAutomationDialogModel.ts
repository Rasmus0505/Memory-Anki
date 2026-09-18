import type { TimerAutomationConfig } from '@/shared/components/session/timer-automation-config'
import {
  sanitizeTimerAutomationConfig,
  TIMER_AUTOMATION_CONFIG_VERSION,
} from '@/shared/components/session/timer-automation-config'

export function toDraft(config: TimerAutomationConfig) {
  return {
    autoStartOnPageEnter: config.autoStartOnPageEnter,
    keepScreenAwake: config.keepScreenAwake,
    showFloatingTimer: config.showFloatingTimer,
  }
}

export type AutomationDraft = ReturnType<typeof toDraft>

export function parseAutomationDraft(draft: AutomationDraft): TimerAutomationConfig {
  return sanitizeTimerAutomationConfig({
    schemaVersion: TIMER_AUTOMATION_CONFIG_VERSION,
    autoStartOnPageEnter: draft.autoStartOnPageEnter,
    keepScreenAwake: draft.keepScreenAwake,
    showFloatingTimer: draft.showFloatingTimer,
  })
}
