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

export type EnglishPatternStatus =
  | 'draft'
  | 'learning'
  | 'speakable'
  | 'mature'
  | 'archived'

export type EnglishPatternSentenceSource =
  | 'manual'
  | 'from_listening'
  | 'from_reading'
  | 'ai'

export type EnglishPatternReviewResult = 'forgot' | 'hard' | 'good' | 'easy'

export interface EnglishPatternSentence {
  id: number
  patternId: number
  promptId: number
  patternTitle?: string
  promptTextEn?: string
  promptTextZh?: string
  sentenceIndex: number
  textEn: string
  textZh: string
  slots: string[]
  collocations: string[]
  note: string
  source: EnglishPatternSentenceSource
  sourceCourseId: number | null
  sourceSentenceId: number | null
  sourceMaterialId: number | null
  sourceVersionId: number | null
  status: string
  reviewNumber: number
  reviewCount: number
  correctCount: number
  incorrectCount: number
  nextDueDate: string | null
  nextDueAt: string | null
  intervalDays: number
  reviewType: string
  algorithmUsed: string
  anchorDate: string | null
  lastReviewedAt: string | null
  stability: number | null
  difficulty: number | null
  state: number
  desiredRetention: number
  ratingLabels: Record<string, string>
  isDue: boolean
  createdAt: string | null
  updatedAt: string | null
}

export interface EnglishPatternPrompt {
  id: number
  patternId: number
  promptIndex: number
  textEn: string
  textZh: string
  sentences: EnglishPatternSentence[]
  createdAt: string | null
  updatedAt: string | null
}

export interface EnglishPatternSummary {
  id: number
  title: string
  tags: string[]
  notes: string
  status: EnglishPatternStatus
  promptCount: number
  sentenceCount: number
  slotCount: number
  targetSentenceCount: number
  dueCount: number
  createdAt: string | null
  updatedAt: string | null
}

export interface EnglishPatternDetail extends EnglishPatternSummary {
  prompts: EnglishPatternPrompt[]
}

export interface EnglishPatternListResponse {
  items: EnglishPatternSummary[]
  total: number
  dueSentenceCount: number
}

export interface EnglishPatternDueSentencesResponse {
  items: EnglishPatternSentence[]
  dueCount: number
}

export interface EnglishPatternCreateRequest {
  title: string
  tags?: string[]
  notes?: string
  seedTemplate?: boolean
}

export interface EnglishPatternUpdateRequest {
  title?: string
  tags?: string[]
  notes?: string
  status?: EnglishPatternStatus
}

export interface EnglishPatternSentenceUpsertRequest {
  sentenceId?: number | null
  textEn?: string
  textZh?: string
  note?: string
  slots?: string[]
  collocations?: string[]
  sentenceIndex?: number
  source?: EnglishPatternSentenceSource
}

export interface EnglishPatternCollectRequest {
  patternId?: number | null
  patternTitle?: string
  promptId?: number | null
  promptTextEn?: string
  promptTextZh?: string
  textEn: string
  textZh?: string
  note?: string
  source?: EnglishPatternSentenceSource
  sourceCourseId?: number | null
  sourceSentenceId?: number | null
  sourceMaterialId?: number | null
  sourceVersionId?: number | null
}

export interface EnglishPatternCollectResponse {
  pattern: EnglishPatternSummary
  sentence: EnglishPatternSentence
}
