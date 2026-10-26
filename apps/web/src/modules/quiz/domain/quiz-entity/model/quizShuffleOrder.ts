/**
 * 「打乱题库」order for the 关联题目 window.
 *
 * The window rebuilds its list from the opener's question ids on every open, so
 * a shuffled order only survives if it is remembered here. Answered questions
 * keep their slot; only the still-open questions move. Stored ids are merged
 * with whatever questions exist now, so a deleted question leaves no hole and a
 * new question joins the end.
 */
const STORAGE_KEY = 'memory-anki.quiz.shuffle-order.v1'

type ShuffleOrderMap = Record<string, number[]>

export type QuizShuffleSource = {
  palaceId: number | null
  /** The node whose badge opened the window; null when the opener has none. */
  nodeUid: string | null
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function quizShuffleStorageKey(source: QuizShuffleSource): string {
  const palace = source.palaceId != null && source.palaceId > 0 ? String(source.palaceId) : 'palace'
  return `${palace}:${source.nodeUid || 'palace'}`
}

function readMap(): ShuffleOrderMap {
  const raw = storage()?.getItem(STORAGE_KEY)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: ShuffleOrderMap = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue
      const ids = value.filter((item): item is number => (
        typeof item === 'number' && Number.isInteger(item) && item > 0
      ))
      if (ids.length > 0) result[key] = ids
    }
    return result
  } catch {
    return {}
  }
}

/** Stored order for this window; empty means "never shuffled here". */
export function readQuizShuffleOrder(source: QuizShuffleSource): number[] {
  return readMap()[quizShuffleStorageKey(source)] ?? []
}

export function saveQuizShuffleOrder(source: QuizShuffleSource, questionIds: readonly number[]): void {
  const ids = questionIds.filter((item) => Number.isInteger(item) && item > 0)
  if (ids.length < 2) return
  const map = readMap()
  map[quizShuffleStorageKey(source)] = ids
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // A full/disabled storage only costs the remembered order, never the answer.
  }
}

/**
 * Reorder `questions` by a remembered id list.
 *
 * Stored ids that still exist keep their stored order; questions the stored
 * list does not know (newly bound) follow in their current display order.
 * Unknown stored ids are dropped rather than leaving a blank slot.
 */
export function applyQuizShuffleOrder<T extends { id: number }>(
  questions: readonly T[],
  storedIds: readonly number[],
): T[] {
  if (storedIds.length === 0 || questions.length < 2) return [...questions]
  const byId = new Map<number, T>()
  for (const question of questions) byId.set(question.id, question)
  const ordered: T[] = []
  const seen = new Set<number>()
  for (const id of storedIds) {
    const question = byId.get(id)
    if (!question || seen.has(id)) continue
    seen.add(id)
    ordered.push(question)
  }
  if (ordered.length === 0) return [...questions]
  for (const question of questions) {
    if (!seen.has(question.id)) ordered.push(question)
  }
  return ordered
}

/**
 * Shuffle the unanswered questions among their own slots.
 *
 * Answered questions stay exactly where they are. When every question is
 * answered there is no open slot left to protect, so the whole list is
 * shuffled — otherwise the button would do nothing on a finished set.
 */
export function shuffleQuizQuestionsForPractice<T extends { id: number }>(
  questions: readonly T[],
  answeredIds: ReadonlySet<number>,
  rng: () => number = Math.random,
): T[] {
  const result = [...questions]
  if (result.length < 2) return result
  const openSlots: number[] = []
  for (let index = 0; index < result.length; index += 1) {
    if (!answeredIds.has(result[index].id)) openSlots.push(index)
  }
  const targets = openSlots.length > 0 ? openSlots : result.map((_item, index) => index)
  const pool = targets.map((slot) => result[slot])
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1))
    const current = pool[index]
    pool[index] = pool[swap]
    pool[swap] = current
  }
  targets.forEach((slot, index) => {
    result[slot] = pool[index]
  })
  return result
}
