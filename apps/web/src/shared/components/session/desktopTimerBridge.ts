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
  | 'focusing'
  | 'idle_warning'
  | 'goal_reached'
  | 'paused'
  | 'completed'

export interface UnifiedTimerFeedbackSignal {
  eventId: string
  kind: 'interval' | 'goal'
  ordinal: number
  roundIndex: number
  occurredAt: number
}

export type UnifiedTimerAction =
  | 'startBreak'
  | 'pause'
  | 'resume'
  | 'snooze'
  | 'finishBreak'
  | 'openTarget'
  | 'collapse'
  | 'continueRound'
  | 'startGoalBreak'
  | 'startStudy'

export interface UnifiedTimerSnapshot {
  mode: UnifiedTimerMode
  status: UnifiedTimerStatus
  title: string
  scene: string
  displaySeconds: number | null
  primaryText: string
  secondaryText: string
  snoozeCount: number
  availableActions: UnifiedTimerAction[]
  presetMinutes: number[]
  allowCustomMinutes?: boolean
  snoozeMinutes: number[]
  targetPath: string
  updatedAt: number
  studyPhase?: UnifiedTimerStudyPhase | null
  effectiveSeconds?: number
  roundElapsedSeconds?: number
  roundTargetSeconds?: number
  roundIndex?: number
  idleWarningRemainingSeconds?: number | null
  suggestedBreakMinutes?: number
  feedbackSignal?: UnifiedTimerFeedbackSignal | null
  semanticState?: 'running' | 'paused' | 'warning' | 'goal' | 'break' | 'expired' | 'idle'
  progressMode?: 'focus_round' | 'idle_timeout' | 'break_countdown' | 'frozen' | 'empty'
  progressValue?: number
}

export type UnifiedTimerCommand =
  | { type: 'promptBreak' }
  | { type: 'returnToStudy' }
  | { type: 'startBreak'; minutes: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'snooze'; minutes: number }
  | { type: 'finishBreak'; openTarget?: boolean }
  | { type: 'openTarget'; path: string }
  | { type: 'collapse'; collapsed: boolean }
  | { type: 'continueRound' }
  | { type: 'startGoalBreak'; minutes?: number }
  | { type: 'startStudy' }
  | { type: 'openTimerSettings' }

export interface DesktopTimerBridge {
  isDesktop?: boolean
  onDesktopFlushRequest?: (
    handler: (request: { requestId: string; reason?: string; requestedAt?: number }) => Promise<unknown> | unknown,
  ) => () => void
  onMainWindowBlur?: (handler: () => void) => () => void
  onPauseActiveTimer?: (handler: () => void) => () => void
  requestMainPause?: () => void
  openMainTarget?: (path: string) => void
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
