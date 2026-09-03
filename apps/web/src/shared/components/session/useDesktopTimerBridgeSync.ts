import * as React from 'react'
import {
  getDesktopTimerBridge,
  type UnifiedTimerCommand,
  type UnifiedTimerSnapshot,
} from '@/shared/components/session/desktopTimerBridge'

export function useDesktopTimerBridgeSync({
  timerSnapshot,
  handleTimerCommand,
}: {
  timerSnapshot: UnifiedTimerSnapshot
  handleTimerCommand: (command: UnifiedTimerCommand) => void
}) {
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
