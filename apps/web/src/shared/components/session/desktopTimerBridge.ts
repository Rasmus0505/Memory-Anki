export type UnifiedTimerMode = 'study' | 'break'

export type UnifiedTimerStatus =
  | 'idle'
  | 'prompting'
  | 'running'
  | 'paused'
  | 'expired'
  | 'completed'
  | 'dismissed'

export type UnifiedTimerAction =
  | 'startBreak'
  | 'pause'
  | 'resume'
  | 'snooze'
  | 'finishBreak'
  | 'openTarget'
  | 'collapse'

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

export interface DesktopTimerBridge {
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
