import type { QuizRuntimeState } from '@/modules/quiz/domain/quiz-entity/model/quizRuntime'

/**
 * Question-owned 已做 shared by node-bound badges, toolbar overlay, palace quiz,
 * and freestyle quiz cards. A refresh restores it. It is cleared only when the
 * learner chooses to clear it, or the settlement page chooses to clear it.
 */
const STORAGE_KEY = 'memory-anki.quiz.practice-progress.v1'

export interface QuizPracticeProgressItem {
  palaceId: number | null
  state: QuizRuntimeState
  updatedAt: string
}

export interface QuizPracticeProgressSnapshot {
  items: Record<string, QuizPracticeProgressItem>
  clears: {
    all: string | null
    palaces: Record<string, string>
    questions: Record<string, string>
  }
}

const completedIds = new Set<number>()
const questionStates: Record<number, QuizRuntimeState> = {}
const palaceIds: Record<number, number> = {}
const updatedAtByQuestion: Record<number, string> = {}
const listeners = new Set<() => void>()
const persistListeners = new Set<() => void>()
let clears: QuizPracticeProgressSnapshot['clears'] = { all: null, palaces: {}, questions: {} }

function notify() {
  for (const listener of listeners) listener()
}

function notifyPersist() {
  saveSnapshot()
  for (const listener of persistListeners) listener()
}

function nowStamp() {
  const previous = [
    clears.all || '',
    ...Object.values(clears.palaces),
    ...Object.values(clears.questions),
    ...Object.values(updatedAtByQuestion),
  ].reduce((latest, stamp) => Math.max(latest, Date.parse(stamp) || 0), 0)
  return new Date(Math.max(Date.now(), previous + 1)).toISOString()
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function emptyClears(): QuizPracticeProgressSnapshot['clears'] {
  return { all: null, palaces: {}, questions: {} }
}

function blockedAt(questionId: number, palaceId: number | null | undefined) {
  const stamps = [clears.all || '']
  if (palaceId) stamps.push(clears.palaces[String(palaceId)] || '')
  stamps.push(clears.questions[String(questionId)] || '')
  return stamps.reduce((latest, stamp) => (stamp > latest ? stamp : latest), '')
}

function rememberPalace(questionId: number, palaceId?: number | null) {
  if (palaceId != null && Number.isInteger(palaceId) && palaceId > 0) {
    palaceIds[questionId] = palaceId
  }
}

function wipeMemory() {
  completedIds.clear()
  for (const key of Object.keys(questionStates)) delete questionStates[Number(key)]
  for (const key of Object.keys(palaceIds)) delete palaceIds[Number(key)]
  for (const key of Object.keys(updatedAtByQuestion)) delete updatedAtByQuestion[Number(key)]
}

function applyItem(questionId: number, item: QuizPracticeProgressItem) {
  const palaceId = item.palaceId
  if (item.updatedAt <= blockedAt(questionId, palaceId)) return
  questionStates[questionId] = item.state
  updatedAtByQuestion[questionId] = item.updatedAt
  rememberPalace(questionId, palaceId)
  if (item.state.resolved || item.state.rating) completedIds.add(questionId)
  else completedIds.delete(questionId)
}

export function readQuizPracticeProgressSnapshot(): QuizPracticeProgressSnapshot {
  const items: QuizPracticeProgressSnapshot['items'] = {}
  for (const [rawId, state] of Object.entries(questionStates)) {
    const questionId = Number(rawId)
    items[rawId] = {
      palaceId: palaceIds[questionId] ?? null,
      state,
      updatedAt: updatedAtByQuestion[questionId] || '',
    }
  }
  return {
    items,
    clears: {
      all: clears.all,
      palaces: { ...clears.palaces },
      questions: { ...clears.questions },
    },
  }
}

function saveSnapshot() {
  const store = storage()
  if (!store) return
  store.setItem(STORAGE_KEY, JSON.stringify(readQuizPracticeProgressSnapshot()))
}

export function reloadQuizPracticeProgressFromStorage() {
  wipeMemory()
  clears = emptyClears()
  const store = storage()
  const raw = store?.getItem(STORAGE_KEY)
  if (!raw) {
    notify()
    return
  }
  try {
    const parsed = JSON.parse(raw) as Partial<QuizPracticeProgressSnapshot>
    clears = {
      all: parsed.clears?.all || null,
      palaces: { ...(parsed.clears?.palaces || {}) },
      questions: { ...(parsed.clears?.questions || {}) },
    }
    for (const [rawId, item] of Object.entries(parsed.items || {})) {
      const questionId = Number(rawId)
      if (!Number.isInteger(questionId) || questionId <= 0 || !item?.state) continue
      applyItem(questionId, item)
    }
  } catch {
    clears = emptyClears()
  }
  notify()
}

export function mergeQuizPracticeProgressSnapshot(remote: QuizPracticeProgressSnapshot) {
  clears = {
    all: laterStamp(clears.all, remote.clears.all),
    palaces: mergeStampMap(clears.palaces, remote.clears.palaces),
    questions: mergeStampMap(clears.questions, remote.clears.questions),
  }
  for (const [rawId, item] of Object.entries(remote.items || {})) {
    const questionId = Number(rawId)
    if (!Number.isInteger(questionId) || questionId <= 0 || !item) continue
    const localAt = updatedAtByQuestion[questionId] || ''
    if (item.updatedAt <= localAt) continue
    applyItem(questionId, item)
  }
  for (const rawId of Object.keys(questionStates)) {
    const questionId = Number(rawId)
    if ((updatedAtByQuestion[questionId] || '') <= blockedAt(questionId, palaceIds[questionId])) {
      delete questionStates[questionId]
      delete palaceIds[questionId]
      delete updatedAtByQuestion[questionId]
      completedIds.delete(questionId)
    }
  }
  saveSnapshot()
  notify()
}

function laterStamp(left: string | null | undefined, right: string | null | undefined) {
  const a = left || ''
  const b = right || ''
  if (!a) return b || null
  if (!b) return a
  return a > b ? a : b
}

function mergeStampMap(left: Record<string, string>, right: Record<string, string>) {
  const next = { ...left }
  for (const [key, stamp] of Object.entries(right || {})) {
    if (stamp && stamp > (next[key] || '')) next[key] = stamp
  }
  return next
}

export function subscribeQuizSessionProgress(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function subscribeQuizPracticeProgressPersist(listener: () => void) {
  persistListeners.add(listener)
  return () => {
    persistListeners.delete(listener)
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
  if (!Number.isInteger(questionId) || questionId <= 0) return
  questionStates[questionId] = next
  updatedAtByQuestion[questionId] = nowStamp()
  rememberPalace(questionId, palaceId)
  if (next.resolved || next.rating) completedIds.add(questionId)
  else completedIds.delete(questionId)
  notify()
  notifyPersist()
}

export function markQuizSessionCompleted(questionId: number, palaceId?: number | null) {
  rememberPalace(questionId, palaceId)
  if (completedIds.has(questionId) && questionStates[questionId]) return
  writeQuizSessionState(questionId, { ...questionStates[questionId], resolved: true }, palaceId)
}

export function resetQuizSessionQuestion(questionId: number) {
  writeQuizSessionState(questionId, { resolved: false, rating: undefined }, palaceIds[questionId])
}

export function removeQuizSessionQuestions(questionIds: readonly number[]) {
  const stamp = nowStamp()
  let changed = false
  for (const questionId of questionIds) {
    if (!Number.isInteger(questionId) || questionId <= 0) continue
    clears.questions[String(questionId)] = stamp
    delete questionStates[questionId]
    delete palaceIds[questionId]
    delete updatedAtByQuestion[questionId]
    completedIds.delete(questionId)
    changed = true
  }
  if (!changed) return
  notify()
  notifyPersist()
}

export function clearQuizSessionProgress() {
  const stamp = nowStamp()
  wipeMemory()
  clears = { all: stamp, palaces: {}, questions: {} }
  notify()
  notifyPersist()
}

export function clearQuizSessionProgressForPalaces(palaceIdList: readonly number[]) {
  const stamp = nowStamp()
  const drop = new Set(palaceIdList.filter((id) => Number.isInteger(id) && id > 0))
  if (drop.size === 0) return
  for (const palaceId of drop) clears.palaces[String(palaceId)] = stamp
  const removeIds = Object.entries(palaceIds)
    .filter(([, palaceId]) => drop.has(palaceId))
    .map(([questionId]) => Number(questionId))
  for (const questionId of removeIds) {
    delete questionStates[questionId]
    delete palaceIds[questionId]
    delete updatedAtByQuestion[questionId]
    completedIds.delete(questionId)
  }
  notify()
  notifyPersist()
}

export function isQuestionDue(dueOn: string | null | undefined, now = new Date()) {
  if (!dueOn) return false
  const stamp = Date.parse(`${dueOn.slice(0, 10)}T00:00:00`)
  if (!Number.isFinite(stamp)) return false
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return stamp <= today
}

reloadQuizPracticeProgressFromStorage()
