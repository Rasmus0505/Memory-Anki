export interface FreestyleRoundLearningTimePayload {
  intervals?: FreestyleLearningInterval[]
  today?: {
    day: string
    started_at: string
    ended_at: string
    known_seconds: number
    unattributed_seconds: number
  }
  unit_seconds: number
  quiz_seconds: number
  lookup_seconds: number
  backfilled?: boolean
  by_palace?: Record<string, {
    unit_seconds: number
    quiz_seconds: number
    lookup_seconds: number
  }>
}

export interface FreestyleLearningTimeAdd {
  bucket: 'unit' | 'quiz' | 'lookup'
  seconds: number
  palace_id?: number | null
}

export interface FreestyleLearningInterval {
  interval_id: string
  session_id: string
  started_at: string
  ended_at: string
  bucket: 'unit' | 'quiz' | 'lookup'
  palace_id?: number | null
  client_source: 'desktop' | 'pwa' | 'unknown'
}

export interface FreestyleLearningTimeRequest {
  operation_id: string
  expected_version: number
  intervals?: FreestyleLearningInterval[]
  /** Historical clients without actual interval boundaries. */
  adds?: FreestyleLearningTimeAdd[]
}

export interface FreestyleLearningTimeBackfillRequest {
  operation_id: string
  expected_version: number
}
