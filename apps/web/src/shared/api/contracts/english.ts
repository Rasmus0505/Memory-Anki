import type { AiCallLogDetail } from './aiLogs'
import type { DashboardResponse } from './dashboard'
import type { ResolvedAiRuntimeMeta } from './profile'

export interface EnglishGenerationTask {
  id: string
  status: 'queued' | 'running' | 'failed' | 'completed'
  stage: string
  progressPercent: number
  message: string
  sourceFilename: string
  fileSize: number
  errorMessage: string
  courseId: number | null
  resolved_ai?: ResolvedAiRuntimeMeta | null
  createdAt: string | null
  updatedAt: string | null
  startedAt: string | null
  completedAt: string | null
}
export interface EnglishCourseSummary {
  id: number
  title: string
  originalFilename: string
  sentenceCount: number
  durationSeconds: number
  status: 'unfinished' | 'completed'
  currentSentenceIndex: number
  updatedAt: string | null
  createdAt: string | null
}
export interface EnglishCourseProgress {
  currentSentenceIndex: number
  completedSentenceIndexes: number[]
  completed: boolean
  updatedAt: string | null
}
export interface EnglishCourseSentence {
  id: number
  index: number
  textEn: string
  textZh: string
  startMs: number
  endMs: number
  tokens: string[]
}
export interface EnglishCourseDetail extends EnglishCourseSummary {
  mediaUrl: string
  sentences: EnglishCourseSentence[]
  progress: EnglishCourseProgress
}
export interface EnglishWorkspaceResponse {
  currentTask: EnglishGenerationTask | null
  continueCourse: EnglishCourseSummary | null
  recentCourses: EnglishCourseSummary[]
  stats: DashboardResponse['english_stats']
}
export interface EnglishSentenceCheckResponse {
  passed: boolean
  tokenResults: Array<{
    input: string
    correct: boolean
    missing: boolean
    unexpected: boolean
  }>
  normalizedInput: string[]
  tokenCount: number
}
export interface EnglishGenerationLogEvent {
  id: string
  timestamp: string
  stage: string
  kind: string
  message: string
  data: Record<string, unknown>
}
export interface EnglishGenerationLogResponse {
  task: EnglishGenerationTask | null
  events: EnglishGenerationLogEvent[]
  aiLogs: AiCallLogDetail[]
}
