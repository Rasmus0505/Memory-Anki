import type { QuizRuntimeState } from '@/modules/quiz/domain/quiz-entity/model/quizRuntime'

/**
 * Same-session 已做 / drafts shared by node-bound badges, toolbar overlay, and
 * palace quiz practice. Reload empties this mirror; freestyle toolbar 做题
 * re-seeds it from the durable round-plan `overlay_quiz` on hydrate.
 */
const completedIds = new Set<number>()
const questionStates: Record<number, QuizRuntimeState> = {}
const palaceIds: Record<number, number> = {}
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

function rememberPalace(questionId: number, palaceId?: number | null) {
  if (palaceId != null && Number.isInteger(palaceId) && palaceId > 0) {
    palaceIds[questionId] = palaceId
  }
}

export function subscribeQuizSessionProgress(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function readQuizSessionCompletedIds() {
  return new Set(completedIds)
}

export function readQuizSessionStates() {
  return { ...questionStates }
}

export function readQuizSessionState(questionId: number): QuizRuntimeState {
  return questionStates[questionId] ?? {}
}

export function writeQuizSessionState(
  questionId: number,
  next: QuizRuntimeState,
  palaceId?: number | null,
) {
  questionStates[questionId] = next
  rememberPalace(questionId, palaceId)
  if (next.resolved || next.rating) {
    completedIds.add(questionId)
  }
  notify()
}

export function markQuizSessionCompleted(questionId: number, palaceId?: number | null) {
  rememberPalace(questionId, palaceId)
  if (completedIds.has(questionId)) return
  completedIds.add(questionId)
  notify()
}

export function resetQuizSessionQuestion(questionId: number) {
  questionStates[questionId] = { resolved: false, rating: undefined }
  completedIds.delete(questionId)
  notify()
}

export function removeQuizSessionQuestions(questionIds: readonly number[]) {
  for (const questionId of questionIds) {
    delete questionStates[questionId]
    delete palaceIds[questionId]
    completedIds.delete(questionId)
  }
  notify()
}

export function clearQuizSessionProgress() {
  completedIds.clear()
  for (const key of Object.keys(questionStates)) delete questionStates[Number(key)]
  for (const key of Object.keys(palaceIds)) delete palaceIds[Number(key)]
  notify()
}

export function clearQuizSessionProgressForPalaces(palaceIdList: readonly number[]) {
  const drop = new Set(palaceIdList.filter((id) => Number.isInteger(id) && id > 0))
  if (drop.size === 0) return
  const removeIds = Object.entries(palaceIds)
    .filter(([, palaceId]) => drop.has(palaceId))
    .map(([questionId]) => Number(questionId))
  if (removeIds.length === 0) return
  removeQuizSessionQuestions(removeIds)
}

export function isQuestionDue(dueOn: string | null | undefined, now = new Date()) {
  if (!dueOn) return false
  const stamp = Date.parse(`${dueOn.slice(0, 10)}T00:00:00`)
  if (!Number.isFinite(stamp)) return false
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return stamp <= today
}
