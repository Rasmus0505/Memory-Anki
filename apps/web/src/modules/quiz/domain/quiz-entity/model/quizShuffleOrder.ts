/**
 * 「打乱题库」order for the 关联题目 window.
 *
 * The window rebuilds its list from the opener's question ids on every open, so
 * a shuffled order only survives if it is remembered here. Answered questions
 * keep their slot; only the still-open questions move. Stored ids are merged
 * with whatever questions exist now, so a deleted question leaves no hole and a
 * new question joins the end.
 *
 * The order lives in the shared client preferences (`quiz_shuffle_orders`), not
 * only in this browser's storage: the desktop window and the PWA run on
 * different origins/profiles and the data folder is shared between the two
 * devices, so an order kept in localStorage alone looked freshly shuffled every
 * time the learner reopened the window on another surface. localStorage stays as
 * a mirror for the moment before the preferences finish loading.
 */
import type { ClientPreferences } from '@/shared/api/contracts'
import {
  getClientPreferenceCacheStatus,
  hasLoadedClientPreferences,
  saveClientPreference,
} from '@/shared/preferences/clientPreferences'

const PREFERENCE_KEY: keyof ClientPreferences = 'quiz_shuffle_orders'
const LEGACY_STORAGE_KEY = 'memory-anki.quiz.shuffle-order.v1'
/** Two keys per shuffle (window + question set); older ones fall off the end. */
const MAX_STORED_ORDERS = 160

type ShuffleOrderMap = Record<string, number[]>

export type QuizShuffleSource = {
  palaceId: number | null
  /** The node whose badge opened the window; null when the opener has none. */
  nodeUid: string | null
}

function palaceKey(palaceId: number | null): string {
  return palaceId != null && palaceId > 0 ? String(palaceId) : 'palace'
}

function cleanIds(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return [...new Set(
    value.filter((item): item is number => (
      typeof item === 'number' && Number.isInteger(item) && item > 0
    )),
  )]
}

function sanitizeMap(value: unknown): ShuffleOrderMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: ShuffleOrderMap = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const ids = cleanIds(entry)
    if (ids.length > 0) result[key] = ids
  }
  return result
}

function isShuffleOrderMap(value: unknown): value is ShuffleOrderMap {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function readLegacyLocal(): ShuffleOrderMap {
  try {
    const raw = globalThis.localStorage?.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return {}
    return sanitizeMap(JSON.parse(raw))
  } catch {
    return {}
  }
}

function readMap(): ShuffleOrderMap {
  const cached = getClientPreferenceCacheStatus(PREFERENCE_KEY, isShuffleOrderMap)
  if (cached.value) return sanitizeMap(cached.value)
  // Once preferences have loaded, the backend is authoritative: a stale mirror
  // must not resurrect an order the learner replaced on the other device. The
  // one exception is the first load after this change shipped — older orders
  // live only in the mirror, so push them up once instead of dropping them.
  if (cached.hasEntry || hasLoadedClientPreferences()) {
    const legacy = readLegacyLocal()
    if (Object.keys(legacy).length > 0) writeMap(legacy)
    return legacy
  }
  return readLegacyLocal()
}

function writeMap(map: ShuffleOrderMap): void {
  void saveClientPreference(PREFERENCE_KEY, map)
  try {
    globalThis.localStorage?.setItem(LEGACY_STORAGE_KEY, JSON.stringify(map))
  } catch {
    // A full/disabled browser storage only costs the offline mirror.
  }
}

export function quizShuffleStorageKey(source: QuizShuffleSource): string {
  return `${palaceKey(source.palaceId)}:${source.nodeUid || 'palace'}`
}

/**
 * Second key: the same questions opened through another card/entry point share
 * this one, so one shuffle covers every way of reaching that set.
 */
export function quizShuffleSetStorageKey(
  source: Pick<QuizShuffleSource, 'palaceId'>,
  questionIds: readonly number[],
): string {
  const ids = [...new Set(cleanIds(questionIds))].sort((left, right) => left - right)
  return `${palaceKey(source.palaceId)}:set:${ids.join(',')}`
}

/**
 * Stored order for this window; empty means "never shuffled here". `questionIds`
 * lets a different entry point for the same questions reuse the order.
 */
export function readQuizShuffleOrder(
  source: QuizShuffleSource,
  questionIds?: readonly number[],
): number[] {
  const map = readMap()
  const windowOrder = map[quizShuffleStorageKey(source)]
  if (windowOrder) return windowOrder
  if (questionIds && questionIds.length > 1) {
    return map[quizShuffleSetStorageKey(source, questionIds)] ?? []
  }
  return []
}

export function saveQuizShuffleOrder(
  source: QuizShuffleSource,
  questionIds: readonly number[],
): void {
  const ids = cleanIds(questionIds)
  if (ids.length < 2) return
  const windowKey = quizShuffleStorageKey(source)
  const setKey = quizShuffleSetStorageKey(source, ids)
  const previous = readMap()
  // Recently written keys first, so trimming drops the least recently used one.
  // The set key is sorted (identity of the set); its value is the shuffled order.
  const next: ShuffleOrderMap = {
    [windowKey]: ids,
    [setKey]: ids,
  }
  for (const [key, value] of Object.entries(previous)) {
    if (Object.keys(next).length >= MAX_STORED_ORDERS) break
    if (key === windowKey || key === setKey) continue
    next[key] = value
  }
  writeMap(next)
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
