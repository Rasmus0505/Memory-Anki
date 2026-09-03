import * as React from 'react'
import { createPortal } from 'react-dom'
import { Clock, Expand, Pause, Play, Settings2, Shrink, X } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { TimerAutomationDialog } from '@/shared/components/session/TimerAutomationDialog'
import {
  readTimerAutomationConfig,
  resetTimerAutomationConfig,
  saveTimerAutomationConfig,
  TIMER_AUTOMATION_UPDATED_EVENT,
  type TimerAutomationConfig,
} from '@/shared/components/session/timer-automation-config'
import { onAppEvent } from '@/shared/events/appEvents'
import type { UnifiedTimerCommand, UnifiedTimerSnapshot } from '@/shared/components/session/desktopTimerBridge'
import {
  createTimerOverlaySizeTokens,
  formatClock,
  resolveFloatingTimerLayout,
  selectActiveTimerEntry,
  TIMER_RESIZE_HANDLE_STYLES,
  type GlobalTimerRegistration,
} from '@/shared/components/session/globalTimerModel'
import {
  readTimerOverlayLayout,
  saveTimerOverlayLayout,
  type TimerOverlayLayout,
} from '@/shared/components/session/timer-overlay-layout'
import { useTimerOverlayDrag } from '@/shared/components/session/useTimerOverlayDrag'

export function GlobalTimerFloatingOverlay({
  entries,
  snapshot,
  onCommand,
  showChrome = true,
}: {
  entries: GlobalTimerRegistration[]
  snapshot: UnifiedTimerSnapshot
  onCommand: (command: UnifiedTimerCommand) => void
  showChrome?: boolean
}) {
  const [layout, setLayout] = React.useState<TimerOverlayLayout>(() =>
    resolveFloatingTimerLayout(readTimerOverlayLayout()),
  )
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [automationConfig, setAutomationConfig] = React.useState<TimerAutomationConfig>(() =>
    readTimerAutomationConfig(),
  )
  const [idlePanelExpanded, setIdlePanelExpanded] = React.useState(false)
  const activeEntry = React.useMemo(() => selectActiveTimerEntry(entries), [entries])

  const persistLayout = React.useCallback(
    (nextLayout: TimerOverlayLayout | ((current: TimerOverlayLayout) => TimerOverlayLayout)) => {
      setLayout((current) => {
        const resolved = typeof nextLayout === 'function' ? nextLayout(current) : nextLayout
        const normalized = resolveFloatingTimerLayout(resolved)
        saveTimerOverlayLayout(normalized)
        return normalized
      })
    },
    [],
  )

  React.useEffect(() => {
    const unsubscribe = onAppEvent(TIMER_AUTOMATION_UPDATED_EVENT, (detail) => {
      setAutomationConfig(detail || readTimerAutomationConfig())
    })
    return unsubscribe
  }, [])

  React.useEffect(() => {
    setIdlePanelExpanded(false)
  }, [activeEntry?.sessionId])

  const {
    beginDrag,
    beginResize,
    handlePointerMoveEvent,
    stopPointerInteraction,
    toggleCollapsed,
    suppressCapsuleClickRef,
  } = useTimerOverlayDrag(layout, persistLayout)

  const hideOverlay = React.useCallback(() => {
    onCommand({ type: 'closeOverlay' })
    persistLayout((current) => ({ ...current, hidden: true }))
  }, [onCommand, persistLayout])

  const restoreOverlay = React.useCallback(() => {
    persistLayout((current) => ({ ...current, hidden: false, collapsed: false }))
    setIdlePanelExpanded(true)
  }, [persistLayout])

  const effectiveSeconds = Math.max(0, Math.round(snapshot.effectiveSeconds ?? 0))
  const status = snapshot.status
  const isHidden = layout.hidden
  const isCollapsed = layout.collapsed
  const showFullPanel = !isHidden && !isCollapsed && (activeEntry !== null || idlePanelExpanded)
  const sizeTokens = React.useMemo(
    () => createTimerOverlaySizeTokens({ width: layout.width, height: layout.height }),
    [layout.height, layout.width],
  )
  const statusText = !activeEntry
    ? '当前无学习会话'
    : status === 'running'
      ? '正在计时'
      : status === 'paused'
        ? '已暂停'
        : status === 'completed'
          ? '已完成'
          : '等待开始'

  const renderStudyActions = () => {
    if (!activeEntry || status === 'completed') {
      return (
        <Button
          type="button"
          size="sm"
          className="memory-anki-global-timer-action-button flex-1"
          style={sizeTokens.actionButtonStyle}
          disabled
        >
          <Play className="memory-anki-global-timer-icon mr-2" style={sizeTokens.iconStyle} />
          进入学习页后开始
        </Button>
      )
    }
    if (status === 'running') {
      return (
        <Button
          type="button"
          size="sm"
          className="memory-anki-global-timer-action-button flex-1"
          style={sizeTokens.actionButtonStyle}
          onClick={() => onCommand({ type: 'pause' })}
        >
          <Pause className="memory-anki-global-timer-icon mr-2" style={sizeTokens.iconStyle} />
          暂停
        </Button>
      )
    }
    return (
      <Button
        type="button"
        size="sm"
        className="memory-anki-global-timer-action-button flex-1"
        style={sizeTokens.actionButtonStyle}
        onClick={() => onCommand({ type: status === 'idle' ? 'start' : 'resume' })}
      >
        <Play className="memory-anki-global-timer-icon mr-2" style={sizeTokens.iconStyle} />
        {status === 'idle' ? '开始' : '继续'}
      </Button>
    )
  }

  const overlay = (
    <div
      data-timer-overlay-root="true"
      data-timer-overlay-hidden={isHidden ? 'true' : 'false'}
      data-semantic-state={snapshot.semanticState ?? 'idle'}
      className="memory-anki-global-timer-layer"
      style={{ left: layout.x, top: layout.y }}
      onPointerMove={handlePointerMoveEvent}
      onPointerUp={stopPointerInteraction}
      onPointerCancel={stopPointerInteraction}
    >
      {isHidden ? (
        <button
          type="button"
          className="memory-anki-global-timer-restore"
          aria-label="显示悬浮计时器"
          title="显示悬浮计时器"
          onPointerDown={beginDrag}
          onClick={() => {
            if (suppressCapsuleClickRef.current) {
              suppressCapsuleClickRef.current = false
              return
            }
            restoreOverlay()
          }}
        >
          <Clock className="h-4 w-4" />
        </button>
      ) : showFullPanel ? (
        <div
          className="memory-anki-global-timer-panel"
          style={{ width: layout.width, height: layout.height, ...sizeTokens.panelStyle }}
        >
          <div className="memory-anki-global-timer-dragbar" onPointerDown={beginDrag}>
            <div className="min-w-0">
              <div className="memory-anki-global-timer-scene">{snapshot.scene}</div>
              <div className="memory-anki-global-timer-title" title={snapshot.title}>
                {snapshot.title}
              </div>
            </div>
            <div className="flex items-center gap-1.5" data-timer-overlay-control="true">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="memory-anki-global-timer-icon-button"
                style={sizeTokens.iconButtonStyle}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => setSettingsOpen(true)}
                title="打开计时器设置"
              >
                <Settings2 className="memory-anki-global-timer-icon" style={sizeTokens.iconStyle} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="memory-anki-global-timer-icon-button"
                style={sizeTokens.iconButtonStyle}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => toggleCollapsed()}
                title="折叠为胶囊"
              >
                <Shrink className="memory-anki-global-timer-icon" style={sizeTokens.iconStyle} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="memory-anki-global-timer-icon-button"
                style={sizeTokens.iconButtonStyle}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={hideOverlay}
                title="隐藏计时器"
                aria-label="隐藏计时器"
              >
                <X className="memory-anki-global-timer-icon" style={sizeTokens.iconStyle} />
              </Button>
            </div>
          </div>
          <div className="memory-anki-global-timer-body">
            <div className="memory-anki-global-timer-digits">{formatClock(effectiveSeconds)}</div>
            <div className="memory-anki-global-timer-row">{statusText}</div>
            <div className="memory-anki-global-timer-row memory-anki-global-timer-row-primary">
              {snapshot.secondaryText}
            </div>
            <div className="memory-anki-global-timer-body-spacer" aria-hidden="true" />
            <div className="memory-anki-global-timer-actions">{renderStudyActions()}</div>
          </div>
          {(Object.keys(TIMER_RESIZE_HANDLE_STYLES) as Array<keyof typeof TIMER_RESIZE_HANDLE_STYLES>).map(
            (direction) => (
              <button
                key={direction}
                type="button"
                aria-label={`从${direction}调整计时器大小`}
                className={`memory-anki-global-timer-resize memory-anki-global-timer-resize-${direction}`}
                style={TIMER_RESIZE_HANDLE_STYLES[direction]}
                onPointerDown={(event) => beginResize(direction, event)}
              />
            ),
          )}
        </div>
      ) : (
        <div className="memory-anki-global-timer-capsule-row">
          <button
            type="button"
            className="memory-anki-global-timer-capsule"
            onPointerDown={beginDrag}
            onClick={() => {
              if (suppressCapsuleClickRef.current) {
                suppressCapsuleClickRef.current = false
                return
              }
              setIdlePanelExpanded(!activeEntry)
              persistLayout((current) => ({ ...current, collapsed: false }))
            }}
            title={activeEntry ? `${snapshot.scene} 计时器` : '展开计时器'}
          >
            <span className="memory-anki-global-timer-capsule-dot" />
            <span className="memory-anki-global-timer-capsule-label">
              {activeEntry ? `${snapshot.scene} ${formatClock(effectiveSeconds)}` : '计时器 待开始'}
            </span>
            <Expand className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="memory-anki-global-timer-capsule-hide"
            aria-label="隐藏计时器"
            title="隐藏计时器"
            data-timer-overlay-control="true"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              hideOverlay()
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <TimerAutomationDialog
        open={settingsOpen}
        config={automationConfig}
        onOpenChange={setSettingsOpen}
        onSave={(nextConfig) => setAutomationConfig(saveTimerAutomationConfig(nextConfig))}
        onReset={() => setAutomationConfig(resetTimerAutomationConfig())}
      />
    </div>
  )

  if (!showChrome) return null
  if (typeof document === 'undefined') return overlay
  return createPortal(overlay, document.body)
}
