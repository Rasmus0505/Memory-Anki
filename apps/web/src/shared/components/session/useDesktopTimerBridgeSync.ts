import * as React from 'react'
import {
  getDesktopTimerBridge,
  type UnifiedTimerCommand,
  type UnifiedTimerSnapshot,
} from '@/shared/components/session/desktopTimerBridge'
import type { BreakGuardConfig } from '@/shared/components/session/break-guard-config'
import type { BreakGuardState } from '@/shared/components/session/breakGuardModel'
import type { GlobalTimerRegistration } from '@/shared/components/session/globalTimerModel'

export function useDesktopTimerBridgeSync({
  timerSnapshot,
  handleTimerCommand,
  activeEntryRef,
  scheduleBreakPrompt,
  breakConfigRef,
  breakStateRef,
}: {
  timerSnapshot: UnifiedTimerSnapshot
  handleTimerCommand: (command: UnifiedTimerCommand) => void
  activeEntryRef: React.MutableRefObject<GlobalTimerRegistration | null>
  scheduleBreakPrompt: (config: BreakGuardConfig, currentBreakState: BreakGuardState) => void
  breakConfigRef: React.MutableRefObject<BreakGuardConfig>
  breakStateRef: React.MutableRefObject<BreakGuardState>
}) {
  React.useEffect(() => {
    const bridge = getDesktopTimerBridge()
    if (!bridge?.onPauseActiveTimer) return
    return bridge.onPauseActiveTimer(() => {
      activeEntryRef.current?.timer.pause({ source: 'desktop_timer_overlay' })
    })
  }, [activeEntryRef])

  React.useEffect(() => {
    const bridge = getDesktopTimerBridge()
    bridge?.publishTimerSnapshot?.(timerSnapshot)
  }, [timerSnapshot])

  React.useEffect(() => {
    const bridge = getDesktopTimerBridge()
    if (!bridge?.onTimerCommand) return
    return bridge.onTimerCommand(handleTimerCommand)
  }, [handleTimerCommand])

  React.useEffect(() => {
    const bridge = getDesktopTimerBridge()
    if (!bridge?.onMainWindowBlur) return
    return bridge.onMainWindowBlur(() => {
      scheduleBreakPrompt(breakConfigRef.current, breakStateRef.current)
    })
  }, [breakConfigRef, breakStateRef, scheduleBreakPrompt])
}
