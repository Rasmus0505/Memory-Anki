import * as React from 'react'
import { GlobalTimerFloatingOverlay } from '@/shared/components/session/GlobalTimerFloatingOverlay'
import {
  readTimerAutomationConfig,
  resetTimerAutomationConfig,
  saveTimerAutomationConfig,
  TIMER_AUTOMATION_UPDATED_EVENT,
  type TimerAutomationConfig,
} from '@/shared/components/session/timer-automation-config'
import { onAppEvent } from '@/shared/events/appEvents'
import {
  getDesktopTimerBridge,
  hasDesktopTimerBridge,
  type UnifiedTimerCommand,
} from '@/shared/components/session/desktopTimerBridge'
import { detectClientSource } from '@/shared/lib/clientSource'
import {
  adoptLiveTimerSnapshot,
  interpolateTimerSeconds,
  setLiveForegroundClockSuppressed,
  useLiveStudyPresence,
} from '@/modules/session/public'
import { TimerAutomationDialog } from '@/shared/components/session/TimerAutomationDialog'
import {
  selectActiveTimerEntry,
  type GlobalTimerRegistration,
} from '@/shared/components/session/globalTimerModel'
import { buildStudyTimerSnapshot } from '@/shared/components/session/timerSnapshotBuilders'
import { useDesktopTimerBridgeSync } from '@/shared/components/session/useDesktopTimerBridgeSync'
import { useScreenWakeLock } from '@/shared/hooks/useScreenWakeLock'
import {
  GlobalTimerActionsContext,
  type GlobalTimerActions,
} from '@/shared/components/session/globalTimerContext'

export function GlobalTimerProvider({
  children,
}: React.PropsWithChildren) {
  const [entries, setEntries] = React.useState<Record<string, GlobalTimerRegistration>>({})
  // Desktop Electron uses the separate timer overlay window. Browser desktop
  // keeps the in-page floating chrome; PWA mounts it headlessly.
  const [showInPageTimerOverlay] = React.useState(() => !hasDesktopTimerBridge())
  const [showFloatingTimerChrome] = React.useState(
    () => !hasDesktopTimerBridge() && detectClientSource() !== 'pwa',
  )
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const activeEntry = React.useMemo(() => selectActiveTimerEntry(Object.values(entries)), [entries])
  const presence = useLiveStudyPresence()
  const [followerClockNow, setFollowerClockNow] = React.useState(() => Date.now())
  const lastPublishedTimerAtRef = React.useRef(0)
  const lastPublishedTimerStatusRef = React.useRef<string | null>(null)
  const [automationConfig, setAutomationConfig] = React.useState<TimerAutomationConfig>(() =>
    readTimerAutomationConfig(),
  )
  const activeEntryRef = React.useRef<GlobalTimerRegistration | null>(null)
  activeEntryRef.current = activeEntry

  // One place covers every study scene: the registry always knows which timer
  // is live. Screen-off is what suspends timing on phones, so hold the lock
  // only while actually counting.
  useScreenWakeLock(automationConfig.keepScreenAwake && activeEntry?.timer.status === 'running')

  React.useEffect(() => {
    const unsubscribeAutomation = onAppEvent(TIMER_AUTOMATION_UPDATED_EVENT, (detail) => {
      const nextConfig = detail || readTimerAutomationConfig()
      setAutomationConfig(nextConfig)
    })
    return () => {
      unsubscribeAutomation()
    }
  }, [])

  const upsertTimer = React.useCallback((entry: GlobalTimerRegistration) => {
    setEntries((current) => {
      const previous = current[entry.sessionId]
      if (
        previous &&
        previous.scene === entry.scene &&
        previous.title === entry.title &&
        previous.isRouteActive === entry.isRouteActive &&
        previous.becameActiveAt === entry.becameActiveAt &&
        previous.timer === entry.timer
      ) {
        return current
      }
      return {
        ...current,
        [entry.sessionId]: entry,
      }
    })
  }, [])

  const removeTimer = React.useCallback((sessionId: string) => {
    setEntries((current) => {
      if (!current[sessionId]) return current
      const next = { ...current }
      delete next[sessionId]
      return next
    })
  }, [])

  const contextValue = React.useMemo<GlobalTimerActions>(
    () => ({
      upsertTimer,
      removeTimer,
    }),
    [removeTimer, upsertTimer],
  )

  const handleTimerCommand = React.useCallback((command: UnifiedTimerCommand) => {
    const currentActiveEntry = activeEntryRef.current
    const remoteTimer = presence?.projection.timer
    if (
      presence &&
      !presence.isController &&
      (command.type === 'pause' || command.type === 'start' || command.type === 'resume')
    ) {
      setLiveForegroundClockSuppressed(false)
      if (remoteTimer?.ownerSessionKey) {
        adoptLiveTimerSnapshot({
          sessionKey: remoteTimer.ownerSessionKey,
          status:
            remoteTimer.status === 'running' || remoteTimer.status === 'paused'
              ? remoteTimer.status
              : 'paused',
          effectiveSeconds: interpolateTimerSeconds(remoteTimer),
        })
      }
      presence.publish({
        takeControl: true,
        timer: remoteTimer ?? undefined,
      })
    }

    if (command.type === 'openTimerSettings') {
      setSettingsOpen(true)
      return
    }

    if (command.type === 'pause') {
      currentActiveEntry?.timer.pause({ source: 'global_floating_timer' })
      return
    }

    if (command.type === 'start') {
      currentActiveEntry?.timer.start({ source: 'global_floating_timer' })
      // 强制桌面版也开始计时
      const bridge = getDesktopTimerBridge()
      if (bridge?.sendTimerCommand) {
        bridge.sendTimerCommand({ type: 'start' })
      }
      return
    }

    if (command.type === 'resume') {
      if (currentActiveEntry?.timer.status === 'paused') {
        currentActiveEntry.timer.resume({ source: 'global_floating_timer' })
      } else if (currentActiveEntry?.timer.status === 'idle') {
        currentActiveEntry.timer.start({ source: 'global_floating_timer' })
        // 强制桌面版也开始计时
        const bridge = getDesktopTimerBridge()
        if (bridge?.sendTimerCommand) {
          bridge.sendTimerCommand({ type: 'start' })
        }
      }
      return
    }

    if (command.type === 'collapse') {
      const bridge = getDesktopTimerBridge()
      bridge?.setOverlayCollapsed?.(command.collapsed)
      return
    }

    // In-page floating overlay owns hide via layout.hidden. Desktop Electron
    // hides the overlay window in main before this command would be forwarded.
    if (command.type === 'closeOverlay') {
      return
    }
  }, [
    activeEntryRef,
    presence,
  ])

  const localTimerSnapshot = React.useMemo(
    () => buildStudyTimerSnapshot({ activeEntry, automationConfig }),
    [activeEntry, automationConfig],
  )
  const remoteTimer = presence?.projection.timer ?? null
  const followingRemoteTimer = Boolean(
    presence && !presence.isController && presence.projection.controllerClientId && remoteTimer,
  )
  const timerSnapshot = React.useMemo(() => {
    if (!followingRemoteTimer || !remoteTimer) return localTimerSnapshot
    const seconds = interpolateTimerSeconds(remoteTimer, followerClockNow)
    return {
      ...remoteTimer,
      displaySeconds: seconds,
      effectiveSeconds: seconds,
    }
  }, [followerClockNow, followingRemoteTimer, localTimerSnapshot, remoteTimer])

  React.useEffect(() => {
    if (!followingRemoteTimer || remoteTimer?.status !== 'running') return
    const timer = window.setInterval(() => setFollowerClockNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [followingRemoteTimer, remoteTimer?.status])

  React.useEffect(() => {
    if (!presence) return
    if (presence.projection.controllerClientId && !presence.isController) return
    if (!activeEntry && localTimerSnapshot.status === 'idle') return
    const now = Date.now()
    const status = localTimerSnapshot.status
    const runningTick =
      status === 'running' &&
      lastPublishedTimerStatusRef.current === 'running' &&
      now - lastPublishedTimerAtRef.current < 1_000
    if (runningTick) return
    lastPublishedTimerAtRef.current = now
    lastPublishedTimerStatusRef.current = status
    presence.publish({
      takeControl: false,
      timer: localTimerSnapshot,
    })
  }, [activeEntry, localTimerSnapshot, presence])

  useDesktopTimerBridgeSync({
    timerSnapshot,
    handleTimerCommand,
  })

  return (
    <GlobalTimerActionsContext.Provider value={contextValue}>
      {children}
      {showInPageTimerOverlay ? (
        <GlobalTimerFloatingOverlay
          entries={Object.values(entries)}
          snapshot={timerSnapshot}
          onCommand={handleTimerCommand}
          showChrome={showFloatingTimerChrome}
        />
      ) : null}
      <TimerAutomationDialog
        open={settingsOpen}
        config={automationConfig}
        onOpenChange={setSettingsOpen}
        onSave={(nextConfig) => setAutomationConfig(saveTimerAutomationConfig(nextConfig))}
        onReset={() => {
          setAutomationConfig(resetTimerAutomationConfig())
        }}
      />    </GlobalTimerActionsContext.Provider>
  )
}

export { useGlobalTimerRegistration } from '@/shared/components/session/globalTimerContext'
