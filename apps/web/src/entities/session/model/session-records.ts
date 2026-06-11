export type RevealState = 'hidden' | 'placeholder' | 'revealed'

export type SessionKind = 'palace_edit' | 'practice' | 'review'

export type SessionCompletionMethod =
  | 'manual_complete'
  | 'auto_complete'
  | 'restart'
  | 'left_page'
  | 'saved'

export type SessionEventType =
  | 'start'
  | 'pause'
  | 'resume'
  | 'complete'
  | 'adjust_duration'
  | 'enter_edit_mode'
  | 'exit_edit_mode'
  | 'restart'
  | 'auto_complete'
  | 'manual_complete'

export interface SessionEventRecord {
  type: SessionEventType
  at: string
  meta?: Record<string, boolean | number | string | null>
}

export interface TimeSessionRecord {
  id: string
  kind: SessionKind
  palaceId: number | null
  sourceKind?: 'palace' | 'english' | 'english_reading' | null
  englishCourseId?: number | null
  title: string
  startedAt: string
  endedAt: string
  effectiveSeconds: number
  pauseCount: number
  completionMethod: SessionCompletionMethod
  durationEdited: boolean
  deletedAt?: string | null
  deletedReason?: 'manual' | null
  events: SessionEventRecord[]
}

export interface TimeRecordSummary {
  totalRecords: number
  totalEffectiveSeconds: number
  last7DaysSeconds: number
  todaySeconds: number
  weekPauseCount: number
  longestSession: TimeSessionRecord | null
}

export interface DailyTrendPoint {
  dateKey: string
  label: string
  seconds: number
}

export interface SessionKindBreakdownItem {
  kind: SessionKind
  label: string
  seconds: number
  sessions: number
}

export interface PracticeProgressRecord {
  palaceId: number
  updatedAt: string
  completed: boolean
  revealMap: Record<string, RevealState>
  redNodeIds: string[]
}
