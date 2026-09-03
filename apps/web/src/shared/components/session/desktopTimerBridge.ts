export type UnifiedTimerMode = 'study' | 'break'

export type UnifiedTimerStatus =
  | 'idle'
  | 'prompting'
  | 'running'
  | 'paused'
  | 'expired'
  | 'completed'
  | 'dismissed'

export type UnifiedTimerStudyPhase =
  | 'idle'
  | 'running'
  | 'paused'
  | 'completed'
  | 'focusing'
  | 'idle_warning'
  | 'goal_reached'

export type UnifiedTimerAction =
  | 'start'
  | 'pause'
  | 'resume'
  | 'collapse'
  | 'closeOverlay'
  | 'openTimerSettings'

export interface UnifiedTimerSnapshot {
  mode: UnifiedTimerMode
  status: UnifiedTimerStatus
  /** Stable owner used by the desktop shell to resume only the timer it paused. */
  ownerSessionId?: string | null
  ownerSessionKey?: string | null
  title: string
  scene: string
  displaySeconds: number | null
  primaryText: string
  secondaryText: string
  snoozeCount?: number
  availableActions: UnifiedTimerAction[]
  presetMinutes?: number[]
  allowCustomMinutes?: boolean
  snoozeMinutes?: number[]
  targetPath: string
  updatedAt: number
  studyPhase?: UnifiedTimerStudyPhase | null
  effectiveSeconds?: number
  semanticState?: 'running' | 'paused' | 'idle'
  progressMode?: 'elapsed' | 'frozen' | 'empty'
  progressValue?: number
}

export type UnifiedTimerCommand =
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'collapse'; collapsed: boolean }
  | { type: 'closeOverlay' }
  | { type: 'openTimerSettings' }

export interface DesktopTimerBridge {
  isDesktop?: boolean
  setMainWindowFullscreen?: (active: boolean) => void
  onMainWindowFullscreenChange?: (handler: (active: boolean) => void) => () => void
  onDesktopFlushRequest?: (
    handler: (request: { requestId: string; reason?: string; requestedAt?: number }) => Promise<unknown> | unknown,
  ) => () => void
  setOverlayCollapsed?: (collapsed: boolean) => void
  publishTimerSnapshot?: (snapshot: UnifiedTimerSnapshot) => void
  onTimerSnapshot?: (handler: (snapshot: UnifiedTimerSnapshot) => void) => () => void
  sendTimerCommand?: (command: UnifiedTimerCommand) => void
  onTimerCommand?: (handler: (command: UnifiedTimerCommand) => void) => () => void
}

declare global {
  interface Window {
    memoryAnkiDesktopTimer?: DesktopTimerBridge
  }
}

export function getDesktopTimerBridge(): DesktopTimerBridge | null {
  if (typeof window === 'undefined') return null
  return window.memoryAnkiDesktopTimer ?? null
}

export function hasDesktopTimerBridge() {
  return getDesktopTimerBridge() != null
}
