export type FreestyleSaveOutcome = 'saved' | 'conflict' | 'failed' | 'unconfirmed'

export interface FreestyleSaveJudgeInput {
  beforeVersion: number
  beforeCompleted: number
  response: {
    version: number
    conflict: boolean
    duplicate: boolean
    completedCount: number
  } | null
  httpStatus?: number | null
  networkError?: boolean
}

/**
 * Settlement only says 「数据已保存成功」 when the server confirms the write.
 * A 2xx without an advanced version is not proof, so it stays unconfirmed.
 */
export function judgeFreestyleSaveOutcome(input: FreestyleSaveJudgeInput): FreestyleSaveOutcome {
  if (input.networkError) return 'failed'
  if (input.httpStatus === 409) return 'conflict'
  if (input.httpStatus != null && input.httpStatus >= 500) return 'failed'
  if (!input.response) return 'failed'
  if (input.response.conflict) return 'conflict'
  if (input.response.duplicate) return 'saved'
  if (input.response.version > input.beforeVersion && input.response.completedCount >= input.beforeCompleted) {
    return 'saved'
  }
  return 'unconfirmed'
}

export function progressPercent(done: number, total: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return 0
  const clamped = Math.min(Math.max(done, 0), total)
  return Math.round((clamped / total) * 100)
}

export interface FreestyleRemainingDelta {
  before: number
  after: number
  /** Positive when work was cleared. */
  cleared: number
}

export function remainingDelta(before: number, after: number): FreestyleRemainingDelta {
  const b = Math.max(0, Math.round(before))
  const a = Math.max(0, Math.round(after))
  return { before: b, after: a, cleared: Math.max(0, b - a) }
}
