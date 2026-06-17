import * as React from 'react'
import { createPortal } from 'react-dom'
import { Pause, Play, Settings2, Shrink, Expand } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'
import { TimerAutomationDialog } from '@/shared/components/session/TimerAutomationDialog'
import {
  getTimerAutomationRule,
  readTimerAutomationConfig,
  resetTimerAutomationConfig,
  saveTimerAutomationConfig,
  type TimerAutomationConfig,
} from '@/shared/components/session/timer-automation-config'
import {
  getTimerFocusRule,
  readTimerFocusConfig,
  resetTimerFocusConfig,
  saveTimerFocusConfig,
  TIMER_FOCUS_SCENE_LABELS,
  TIMER_FOCUS_UPDATED_EVENT,
  type TimerFocusConfig,
  type TimerFocusScene,
} from '@/shared/components/session/timer-focus-config'
import {
  readTimerOverlayLayout,
  saveTimerOverlayLayout,
  sanitizeTimerOverlayLayout,
  TIMER_OVERLAY_MIN_HEIGHT,
  TIMER_OVERLAY_MIN_WIDTH,
  type TimerOverlayLayout,
} from '@/shared/components/session/timer-overlay-layout'
import { emitTimerCelebration } from '@/shared/components/session/timer-celebration'
import type { TimedSessionController } from '@/shared/hooks/useTimedSession'
import { useMindMapFeedbackSettings } from '@/shared/components/mindmap-host/useMindMapFeedback'

interface GlobalTimerRegistration {
  sessionId: string
  scene: TimerFocusScene
  title: string
  timer: TimedSessionController
  isRouteActive: boolean
  becameActiveAt: number
}

interface GlobalTimerContextValue {
  upsertTimer: (entry: GlobalTimerRegistration) => void
  removeTimer: (sessionId: string) => void
}

const GlobalTimerContext = React.createContext<GlobalTimerContextValue | null>(null)
const OVERLAY_VIEWPORT_MARGIN = 12
const TIMER_DRAG_CLICK_THRESHOLD_PX = 6

type ResizeHandleDirection =
  | 'n'
  | 'e'
  | 's'
  | 'w'
  | 'ne'
  | 'nw'
  | 'se'
  | 'sw'

interface TimerResizeState {
  direction: ResizeHandleDirection
  startX: number
  startY: number
  x: number
  y: number
  width: number
  height: number
}

const TIMER_RESIZE_HANDLE_STYLES: Record<ResizeHandleDirection, React.CSSProperties> = {
  n: {
    position: 'absolute',
    top: -6,
    left: 14,
    right: 14,
    height: 14,
    cursor: 'ns-resize',
  },
  e: {
    position: 'absolute',
    top: 14,
    right: -6,
    bottom: 14,
    width: 14,
    cursor: 'ew-resize',
  },
  s: {
    position: 'absolute',
    bottom: -6,
    left: 14,
    right: 14,
    height: 14,
    cursor: 'ns-resize',
  },
  w: {
    position: 'absolute',
    top: 14,
    left: -6,
    bottom: 14,
    width: 14,
    cursor: 'ew-resize',
  },
  nw: {
    position: 'absolute',
    top: -6,
    left: -6,
    width: 26,
    height: 26,
    cursor: 'nwse-resize',
  },
  ne: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 26,
    height: 26,
    cursor: 'nesw-resize',
  },
  se: {
    position: 'absolute',
    right: -6,
    bottom: -6,
    width: 26,
    height: 26,
    cursor: 'nwse-resize',
  },
  sw: {
    position: 'absolute',
    left: -6,
    bottom: -6,
    width: 26,
    height: 26,
    cursor: 'nesw-resize',
  },
}

function formatClock(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.round(totalSeconds))
  const minutes = `${Math.floor(safeSeconds / 60)}`.padStart(2, '0')
  const seconds = `${safeSeconds % 60}`.padStart(2, '0')
  return `${minutes}:${seconds}`
}

function formatPrimaryProgress(elapsedSeconds: number, totalSeconds: number) {
  const safeTargetSeconds = Math.max(1, Math.round(totalSeconds))
  const ratio = (Math.max(0, elapsedSeconds) / safeTargetSeconds).toFixed(2)
  return `${formatClock(elapsedSeconds)}/${formatClock(totalSeconds)}  ${ratio}`
}

function formatIdlePrimaryProgress(totalSeconds: number) {
  return `${formatClock(totalSeconds)}/${formatClock(totalSeconds)}  1.00`
}

function clampLayoutToViewport(layout: TimerOverlayLayout) {
  if (typeof window === 'undefined') return layout
  const minMargin = OVERLAY_VIEWPORT_MARGIN
  const maxWidth = Math.max(TIMER_OVERLAY_MIN_WIDTH, window.innerWidth - minMargin * 2)
  const maxHeight = Math.max(TIMER_OVERLAY_MIN_HEIGHT, window.innerHeight - minMargin * 2)
  const width = Math.min(Math.max(TIMER_OVERLAY_MIN_WIDTH, layout.width), maxWidth)
  const height = Math.min(Math.max(TIMER_OVERLAY_MIN_HEIGHT, layout.height), maxHeight)
  const maxX = Math.max(minMargin, window.innerWidth - width - minMargin)
  const maxY = Math.max(minMargin, window.innerHeight - height - minMargin)
  return {
    ...layout,
    x: Math.min(Math.max(minMargin, layout.x), maxX),
    y: Math.min(Math.max(minMargin, layout.y), maxY),
    width,
    height,
  }
}

function resolveFloatingLayout(layout: TimerOverlayLayout) {
  const sanitized = sanitizeTimerOverlayLayout(layout)
  return clampLayoutToViewport(sanitized)
}

export function calculateResizedTimerOverlayLayout(
  resizeState: TimerResizeState,
  clientX: number,
  clientY: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  const deltaX = clientX - resizeState.startX
  const deltaY = clientY - resizeState.startY
  const viewportLeft = OVERLAY_VIEWPORT_MARGIN
  const viewportTop = OVERLAY_VIEWPORT_MARGIN
  const viewportRight = viewportWidth - OVERLAY_VIEWPORT_MARGIN
  const viewportBottom = viewportHeight - OVERLAY_VIEWPORT_MARGIN
  const availableWidth = Math.max(1, viewportRight - viewportLeft)
  const availableHeight = Math.max(1, viewportBottom - viewportTop)
  const minWidth = Math.min(TIMER_OVERLAY_MIN_WIDTH, availableWidth)
  const minHeight = Math.min(TIMER_OVERLAY_MIN_HEIGHT, availableHeight)
  const startRight = resizeState.x + resizeState.width
  const startBottom = resizeState.y + resizeState.height
  let nextLeft = resizeState.x
  let nextTop = resizeState.y
  let nextRight = startRight
  let nextBottom = startBottom

  if (resizeState.direction.includes('e')) {
    nextRight = Math.min(Math.max(startRight + deltaX, nextLeft + minWidth), viewportRight)
  }

  if (resizeState.direction.includes('s')) {
    nextBottom = Math.min(Math.max(startBottom + deltaY, nextTop + minHeight), viewportBottom)
  }

  if (resizeState.direction.includes('w')) {
    nextLeft = Math.max(Math.min(resizeState.x + deltaX, startRight - minWidth), viewportLeft)
  }

  if (resizeState.direction.includes('n')) {
    nextTop = Math.max(Math.min(resizeState.y + deltaY, startBottom - minHeight), viewportTop)
  }

  return {
    x: nextLeft,
    y: nextTop,
    width: nextRight - nextLeft,
    height: nextBottom - nextTop,
  }
}

function rankEntry(entry: GlobalTimerRegistration) {
  if (entry.isRouteActive) {
    if (entry.timer.status === 'running' || entry.timer.status === 'paused') return 4
  }
  if (entry.timer.startedAt && entry.timer.status !== 'completed') {
    if (entry.timer.status === 'running') return 3
    if (entry.timer.status === 'paused') return 2
  }
  if (entry.isRouteActive && entry.timer.status === 'idle') return 1
  return 0
}

function selectActiveEntry(entries: GlobalTimerRegistration[]) {
  const ranked = entries
    .map((entry) => ({ entry, rank: rankEntry(entry) }))
    .filter((candidate) => candidate.rank > 0)
    .sort((left, right) => {
      if (right.rank !== left.rank) return right.rank - left.rank
      if (right.entry.isRouteActive !== left.entry.isRouteActive) {
        return right.entry.isRouteActive ? 1 : -1
      }
      if (right.entry.becameActiveAt !== left.entry.becameActiveAt) {
        return right.entry.becameActiveAt - left.entry.becameActiveAt
      }
      return right.entry.timer.effectiveSeconds - left.entry.timer.effectiveSeconds
    })
  return ranked[0]?.entry ?? null
}

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = React.useState(false)

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(mediaQuery.matches)
    sync()
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', sync)
      return () => mediaQuery.removeEventListener('change', sync)
    }
    mediaQuery.addListener(sync)
    return () => mediaQuery.removeListener(sync)
  }, [])

  return reducedMotion
}

function GlobalTimerFloatingOverlay({
  entries,
}: {
  entries: GlobalTimerRegistration[]
}) {
  const [layout, setLayout] = React.useState<TimerOverlayLayout>(() =>
    resolveFloatingLayout(readTimerOverlayLayout()),
  )
  const [automationOpen, setAutomationOpen] = React.useState(false)
  const [automationConfig, setAutomationConfig] = React.useState<TimerAutomationConfig>(() =>
    readTimerAutomationConfig(),
  )
  const [focusConfig, setFocusConfig] = React.useState<TimerFocusConfig>(() =>
    readTimerFocusConfig(),
  )
  const [pulseKind, setPulseKind] = React.useState<'secondary' | 'primary' | null>(null)
  const [pulseNonce, setPulseNonce] = React.useState(0)
  const reducedMotion = usePrefersReducedMotion()
  const feedbackSettings = useMindMapFeedbackSettings()
  const activeEntry = React.useMemo(() => selectActiveEntry(entries), [entries])
  const dragStateRef = React.useRef<{
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)
  const resizeStateRef = React.useRef<TimerResizeState | null>(null)
  const suppressCapsuleClickRef = React.useRef(false)
  const completionStateRef = React.useRef<Record<string, { secondaryCount: number; primaryDone: boolean }>>({})

  const persistLayout = React.useCallback((nextLayout: TimerOverlayLayout | ((current: TimerOverlayLayout) => TimerOverlayLayout)) => {
    setLayout((current) => {
      const resolved = typeof nextLayout === 'function' ? nextLayout(current) : nextLayout
      const normalized = resolveFloatingLayout(resolved)
      saveTimerOverlayLayout(normalized)
      return normalized
    })
  }, [])

  React.useEffect(() => {
    const handleResize = () => {
      persistLayout((current) => current)
    }
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [persistLayout])

  React.useEffect(() => {
    const handleAutomationChange = (event: Event) => {
      const nextConfig =
        event instanceof CustomEvent && event.detail
          ? (event.detail as TimerAutomationConfig)
          : readTimerAutomationConfig()
      setAutomationConfig(nextConfig)
    }
    const handleFocusChange = (event: Event) => {
      const nextConfig =
        event instanceof CustomEvent && event.detail
          ? (event.detail as TimerFocusConfig)
          : readTimerFocusConfig()
      setFocusConfig(nextConfig)
    }

    window.addEventListener('memory-anki-timer-automation-change', handleAutomationChange)
    window.addEventListener(TIMER_FOCUS_UPDATED_EVENT, handleFocusChange)
    return () => {
      window.removeEventListener('memory-anki-timer-automation-change', handleAutomationChange)
      window.removeEventListener(TIMER_FOCUS_UPDATED_EVENT, handleFocusChange)
    }
  }, [])

  React.useEffect(() => {
    if (pulseKind == null) return
    const timer = window.setTimeout(() => setPulseKind(null), pulseKind === 'primary' ? 540 : 360)
    return () => window.clearTimeout(timer)
  }, [pulseKind, pulseNonce])

  React.useEffect(() => {
    if (!activeEntry) return
    const previous = completionStateRef.current[activeEntry.sessionId]
    const focusRule = getTimerFocusRule(activeEntry.scene, focusConfig)
    const primarySeconds = Math.max(60, focusRule.primaryMinutes * 60)
    const secondarySeconds = Math.max(60, Math.min(primarySeconds, focusRule.secondaryMinutes * 60))
    const secondaryCount = Math.floor(activeEntry.timer.effectiveSeconds / secondarySeconds)
    const primaryDone = activeEntry.timer.effectiveSeconds >= primarySeconds

    if (!previous || secondaryCount < previous.secondaryCount || activeEntry.timer.effectiveSeconds === 0) {
      completionStateRef.current[activeEntry.sessionId] = {
        secondaryCount,
        primaryDone,
      }
      return
    }

    if (secondaryCount > previous.secondaryCount) {
      emitTimerCelebration({
        completionCount: secondaryCount,
        kind: 'secondary',
        reducedMotion,
        soundEnabled: feedbackSettings.soundEnabled && feedbackSettings.mode === 'immersive',
        volume: feedbackSettings.volume,
        feedbackIntensity: focusConfig.feedbackIntensity,
      })
      setPulseKind('secondary')
      setPulseNonce((current) => current + 1)
    }

    if (primaryDone && !previous.primaryDone) {
      emitTimerCelebration({
        completionCount: secondaryCount,
        kind: 'primary',
        reducedMotion,
        soundEnabled: feedbackSettings.soundEnabled && feedbackSettings.mode === 'immersive',
        volume: feedbackSettings.volume,
        feedbackIntensity: focusConfig.feedbackIntensity,
      })
      setPulseKind('primary')
      setPulseNonce((current) => current + 1)
    }

    completionStateRef.current[activeEntry.sessionId] = {
      secondaryCount,
      primaryDone,
    }
  }, [activeEntry, feedbackSettings.mode, feedbackSettings.soundEnabled, feedbackSettings.volume, focusConfig, reducedMotion])

  const beginDrag = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    const target = event.target
    if (
      target instanceof Element &&
      target.closest('[data-timer-overlay-control="true"]')
    ) {
      return
    }
    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: layout.x,
      originY: layout.y,
    }
    suppressCapsuleClickRef.current = false
    if ('setPointerCapture' in event.currentTarget) {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
  }, [layout.x, layout.y])

  const beginResize = React.useCallback((direction: ResizeHandleDirection, event: React.PointerEvent<HTMLButtonElement>) => {
    resizeStateRef.current = {
      direction,
      startX: event.clientX,
      startY: event.clientY,
      x: layout.x,
      y: layout.y,
      width: layout.width,
      height: layout.height,
    }
    if ('setPointerCapture' in event.currentTarget) {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    event.stopPropagation()
  }, [layout.height, layout.width, layout.x, layout.y])

  const handlePointerMove = React.useCallback((clientX: number, clientY: number) => {
    if (dragStateRef.current) {
      const deltaX = clientX - dragStateRef.current.startX
      const deltaY = clientY - dragStateRef.current.startY
      const dragState = dragStateRef.current
      if (Math.abs(deltaX) > TIMER_DRAG_CLICK_THRESHOLD_PX || Math.abs(deltaY) > TIMER_DRAG_CLICK_THRESHOLD_PX) {
        suppressCapsuleClickRef.current = true
      }
      persistLayout((current) => ({
        ...current,
        x: (dragState?.originX ?? current.x) + deltaX,
        y: (dragState?.originY ?? current.y) + deltaY,
      }))
    }

    if (resizeStateRef.current) {
      const nextLayout = calculateResizedTimerOverlayLayout(
        resizeStateRef.current,
        clientX,
        clientY,
        window.innerWidth,
        window.innerHeight,
      )

      persistLayout((current) => ({
        ...current,
        ...nextLayout,
      }))
    }
  }, [persistLayout])

  const handlePointerMoveEvent = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    handlePointerMove(event.clientX, event.clientY)
  }, [handlePointerMove])

  const stopPointerInteraction = React.useCallback(() => {
    dragStateRef.current = null
    resizeStateRef.current = null
  }, [])

  React.useEffect(() => {
    const handleWindowPointerMove = (event: PointerEvent) => {
      handlePointerMove(event.clientX, event.clientY)
    }
    const handleWindowPointerUp = () => {
      stopPointerInteraction()
    }

    window.addEventListener('pointermove', handleWindowPointerMove)
    window.addEventListener('pointerup', handleWindowPointerUp)
    window.addEventListener('pointercancel', handleWindowPointerUp)
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove)
      window.removeEventListener('pointerup', handleWindowPointerUp)
      window.removeEventListener('pointercancel', handleWindowPointerUp)
    }
  }, [handlePointerMove, stopPointerInteraction])

  const toggleCollapsed = React.useCallback(() => {
    persistLayout((current) => ({
      ...current,
      collapsed: !current.collapsed,
    }))
  }, [persistLayout])

  const scene = activeEntry?.scene ?? null
  const sceneLabel = scene ? TIMER_FOCUS_SCENE_LABELS[scene] : '计时器'
  const title = activeEntry?.title ?? '待开始'
  const focusRule = scene ? getTimerFocusRule(scene, focusConfig) : focusConfig.global
  const automationRule = scene ? getTimerAutomationRule(scene, automationConfig) : null
  const primarySeconds = Math.max(60, focusRule.primaryMinutes * 60)
  const secondarySeconds = Math.max(60, Math.min(primarySeconds, focusRule.secondaryMinutes * 60))
  const effectiveSeconds = activeEntry?.timer.effectiveSeconds ?? 0
  const secondaryCount = secondarySeconds > 0 ? Math.floor(effectiveSeconds / secondarySeconds) : 0
  const secondaryRemainder = secondarySeconds > 0 ? effectiveSeconds % secondarySeconds : 0
  const secondaryRemaining =
    secondarySeconds > 0
      ? secondaryRemainder === 0
        ? secondarySeconds
        : secondarySeconds - secondaryRemainder
      : 0
  const idleSecondarySeconds = secondarySeconds
  const idleText = automationRule
    ? `闲置 ${activeEntry?.timer.idleSeconds ?? 0}/${automationRule.inactiveAutoPauseSeconds} 秒`
    : '当前无学习会话'
  const primarySummaryText = activeEntry
    ? formatPrimaryProgress(effectiveSeconds, primarySeconds)
    : formatIdlePrimaryProgress(primarySeconds)
  const showFullPanel = !layout.collapsed
  const primaryAction =
    activeEntry == null
      ? null
      : activeEntry.timer.status === 'running'
      ? {
          label: '暂停',
          icon: Pause,
          onClick: () => activeEntry.timer.pause({ source: 'global_floating_timer' }),
        }
      : {
          label: activeEntry?.timer.status === 'paused' ? '继续' : '开始',
          icon: Play,
          onClick: () =>
            (activeEntry?.timer.status === 'paused'
              ? activeEntry.timer.resume({ source: 'global_floating_timer' })
              : activeEntry?.timer.start({ source: 'global_floating_timer' })),
        }
  const PrimaryActionIcon = primaryAction?.icon ?? Play

  const overlay = (
    <>
      {pulseKind ? (
        <div
          key={`${pulseKind}-${pulseNonce}`}
          className={cn(
            'memory-anki-timer-screen-pulse',
            pulseKind === 'primary'
              ? 'memory-anki-timer-screen-pulse-primary'
              : 'memory-anki-timer-screen-pulse-secondary',
          )}
          aria-hidden="true"
        />
      ) : null}
      <div
        className="memory-anki-global-timer-layer"
        style={{ left: layout.x, top: layout.y }}
        onPointerMove={handlePointerMoveEvent}
        onPointerUp={stopPointerInteraction}
        onPointerCancel={stopPointerInteraction}
      >
        {showFullPanel ? (
          <div
            className={cn(
              'memory-anki-global-timer-panel',
              pulseKind === 'primary' && 'memory-anki-global-timer-panel-primary',
              pulseKind === 'secondary' && 'memory-anki-global-timer-panel-secondary',
            )}
            style={{ width: layout.width, height: layout.height }}
          >
            <div className="memory-anki-global-timer-dragbar" onPointerDown={beginDrag}>
              <div className="min-w-0">
                <div className="memory-anki-global-timer-scene">{sceneLabel}</div>
                <div className="truncate text-[11px] text-muted-foreground/85" title={title}>
                  {title}
                </div>
              </div>
              <div className="flex items-center gap-1.5" data-timer-overlay-control="true">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => setAutomationOpen(true)}
                  title="打开计时器设置"
                >
                  <Settings2 className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={toggleCollapsed}
                  title="折叠为胶囊"
                >
                  <Shrink className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="memory-anki-global-timer-body">
              <div className="memory-anki-global-timer-digits">
                {formatClock(activeEntry ? secondaryRemaining : idleSecondarySeconds)}
              </div>
              <div className="memory-anki-global-timer-row">{idleText}</div>
              <div className="memory-anki-global-timer-row memory-anki-global-timer-row-primary">
                {primarySummaryText}
              </div>
              <div className="memory-anki-global-timer-body-spacer" aria-hidden="true" />
              <div className="memory-anki-global-timer-actions">
                {activeEntry && primaryAction ? (
                  <Button type="button" size="sm" className="flex-1" onClick={primaryAction.onClick}>
                    <PrimaryActionIcon className="mr-2 h-4 w-4" />
                    {primaryAction.label}
                  </Button>
                ) : (
                  <Button type="button" size="sm" className="flex-1" disabled>
                    <Play className="mr-2 h-4 w-4" />
                    进入学习页后开始
                  </Button>
                )}
              </div>
            </div>

            <button type="button" aria-label="从上边调整计时器大小" className="memory-anki-global-timer-resize memory-anki-global-timer-resize-n" style={TIMER_RESIZE_HANDLE_STYLES.n} onPointerDown={(event) => beginResize('n', event)} />
            <button type="button" aria-label="从右边调整计时器大小" className="memory-anki-global-timer-resize memory-anki-global-timer-resize-e" style={TIMER_RESIZE_HANDLE_STYLES.e} onPointerDown={(event) => beginResize('e', event)} />
            <button type="button" aria-label="从下边调整计时器大小" className="memory-anki-global-timer-resize memory-anki-global-timer-resize-s" style={TIMER_RESIZE_HANDLE_STYLES.s} onPointerDown={(event) => beginResize('s', event)} />
            <button type="button" aria-label="从左边调整计时器大小" className="memory-anki-global-timer-resize memory-anki-global-timer-resize-w" style={TIMER_RESIZE_HANDLE_STYLES.w} onPointerDown={(event) => beginResize('w', event)} />
            <button type="button" aria-label="从左上角调整计时器大小" className="memory-anki-global-timer-resize memory-anki-global-timer-resize-nw" style={TIMER_RESIZE_HANDLE_STYLES.nw} onPointerDown={(event) => beginResize('nw', event)} />
            <button type="button" aria-label="从右上角调整计时器大小" className="memory-anki-global-timer-resize memory-anki-global-timer-resize-ne" style={TIMER_RESIZE_HANDLE_STYLES.ne} onPointerDown={(event) => beginResize('ne', event)} />
            <button type="button" aria-label="从右下角调整计时器大小" className="memory-anki-global-timer-resize memory-anki-global-timer-resize-se" style={TIMER_RESIZE_HANDLE_STYLES.se} onPointerDown={(event) => beginResize('se', event)} />
            <button type="button" aria-label="从左下角调整计时器大小" className="memory-anki-global-timer-resize memory-anki-global-timer-resize-sw" style={TIMER_RESIZE_HANDLE_STYLES.sw} onPointerDown={(event) => beginResize('sw', event)} />
          </div>
        ) : (
          <button
            type="button"
            className="memory-anki-global-timer-capsule"
            onPointerDown={beginDrag}
            onClick={() => {
              if (suppressCapsuleClickRef.current) {
                suppressCapsuleClickRef.current = false
                return
              }
              persistLayout((current) => ({ ...current, collapsed: false }))
            }}
            title={activeEntry ? `${sceneLabel} 计时器` : '展开计时器'}
          >
            <span className="memory-anki-global-timer-capsule-dot" />
            <span className="memory-anki-global-timer-capsule-label">
              {activeEntry ? `${sceneLabel} ${formatClock(secondaryRemaining)}` : '计时器 待开始'}
            </span>
            <Expand className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <TimerAutomationDialog
        open={automationOpen}
        config={automationConfig}
        onOpenChange={setAutomationOpen}
        onSave={(nextConfig) => {
          const saved = saveTimerAutomationConfig(nextConfig)
          setAutomationConfig(saved)
        }}
        onReset={() => {
          setAutomationConfig(resetTimerAutomationConfig())
          setFocusConfig(resetTimerFocusConfig())
        }}
        focusConfig={focusConfig}
        onFocusConfigSave={(nextConfig) => {
          const saved = saveTimerFocusConfig(nextConfig)
          setFocusConfig(saved)
        }}
      />
    </>
  )

  if (typeof document === 'undefined') {
    return overlay
  }

  return createPortal(overlay, document.body)
}

export function GlobalTimerProvider({
  children,
}: React.PropsWithChildren) {
  const [entries, setEntries] = React.useState<Record<string, GlobalTimerRegistration>>({})

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

  const contextValue = React.useMemo(
    () => ({
      upsertTimer,
      removeTimer,
    }),
    [removeTimer, upsertTimer],
  )

  return (
    <GlobalTimerContext.Provider value={contextValue}>
      {children}
      <GlobalTimerFloatingOverlay entries={Object.values(entries)} />
    </GlobalTimerContext.Provider>
  )
}

export function useGlobalTimerRegistration(entry: {
  scene: TimerFocusScene
  title: string
  timer: TimedSessionController
  isRouteActive: boolean
  becameActiveAt: number
}) {
  const context = React.useContext(GlobalTimerContext)
  const {
    scene,
    title,
    timer,
    isRouteActive,
    becameActiveAt,
  } = entry

  React.useEffect(() => {
    if (!context) return
    context.upsertTimer({
      sessionId: timer.sessionId,
      scene,
      title,
      timer,
      isRouteActive,
      becameActiveAt,
    })
    return () => {
      context.removeTimer(timer.sessionId)
    }
  }, [becameActiveAt, context, isRouteActive, scene, timer, title])
}
