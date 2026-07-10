import * as React from 'react'
import {
  getDesktopTimerBridge,
  type UnifiedTimerCommand,
  type UnifiedTimerSnapshot,
} from '@/shared/components/session/desktopTimerBridge'
import type { GlobalTimerRegistration } from '@/shared/components/session/globalTimerModel'

export function useDesktopTimerBridgeSync({
  timerSnapshot,
  handleTimerCommand,
  activeEntryRef,
}: {
  timerSnapshot: UnifiedTimerSnapshot
  handleTimerCommand: (command: UnifiedTimerCommand) => void
  activeEntryRef: React.MutableRefObject<GlobalTimerRegistration | null>
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
}
