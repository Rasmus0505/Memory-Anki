export type RevealState = 'hidden' | 'placeholder' | 'revealed'

export type SessionKind = 'palace_edit' | 'practice' | 'quiz' | 'review' | 'custom'
export type SessionScene = SessionKind | 'english' | 'english_reading' | 'freestyle'
export type TimeRecordClientSource = 'desktop' | 'pwa'
export type TimeRecordSortBy = 'started_at' | 'effective_seconds' | 'title'
export type TimeRecordSortOrder = 'asc' | 'desc'

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
  | 'leave_scene'
  | 'complete'
  | 'adjust_duration'
  | 'enter_edit_mode'
  | 'exit_edit_mode'
  | 'restart'
  | 'auto_complete'
  | 'manual_complete'
  | 'focus_interval_complete'
  | 'focus_round_complete'
  | 'focus_round_continue'
  | 'break_start'
  | 'break_end'

export interface SessionEventRecord {
  type: SessionEventType
  at: string
  meta?: Record<string, boolean | number | string | null>
}

export interface SessionSceneSegment {
  scene: SessionScene
  kind: SessionKind
  palaceId: number | null
  palaceSegmentId?: number | null
  sourceKind?: 'palace' | 'english' | 'english_reading' | null
  englishCourseId?: number | null
  title: string
  startedAt: string
  endedAt: string
  effectiveSeconds: number
}

export interface TimeSessionRecord {
  id: string
  kind: SessionKind
  palaceId: number | null
  palaceSegmentId?: number | null
  sourceKind?: 'palace' | 'english' | 'english_reading' | null
  englishCourseId?: number | null
  title: string
  startedAt: string
  endedAt: string
  effectiveSeconds: number
  pauseCount: number
  completionMethod: SessionCompletionMethod
  durationEdited: boolean
  clientSource?: TimeRecordClientSource | null
  /** Stable tag id: builtin kind or custom tag id. */
  activityTag?: string | null
  /** Display label snapshot for custom tags. */
  activityTagLabel?: string | null
  deletedAt?: string | null
  deletedReason?: 'manual' | null
  events: SessionEventRecord[]
  sceneSegments?: SessionSceneSegment[]
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

export type TimeRecordChartRange = 7 | 30 | 90 | 'all'

export interface SessionKindBreakdownItem {
  /** Builtin kind or custom tag id. */
  kind: string
  label: string
  seconds: number
  sessions: number
  isBuiltin?: boolean
}
