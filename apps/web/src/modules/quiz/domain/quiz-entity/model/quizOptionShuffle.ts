export interface QuizOptionShuffleActions {
  shuffle: () => void
  restore: () => void
  canShuffle: boolean
  canRestore: boolean
}

export interface QuizOptionOrderState {
  originalOrder: string[]
  currentOrder: string[]
  shuffled: boolean
}

export const QUIZ_OPTION_SHUFFLE_DEFAULT_ENABLED = true
export const QUIZ_OPTION_SHUFFLE_DEFAULT_THRESHOLD_SECONDS = 5
export const QUIZ_OPTION_SHUFFLE_MAX_THRESHOLD_SECONDS = 300

export interface QuizOptionShuffleSettings {
  enabled: boolean
  thresholdSeconds: number
}

export const DEFAULT_QUIZ_OPTION_SHUFFLE_SETTINGS: QuizOptionShuffleSettings = {
  enabled: QUIZ_OPTION_SHUFFLE_DEFAULT_ENABLED,
  thresholdSeconds: QUIZ_OPTION_SHUFFLE_DEFAULT_THRESHOLD_SECONDS,
}

export function sanitizeQuizOptionShuffleSettings(value: unknown): QuizOptionShuffleSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_QUIZ_OPTION_SHUFFLE_SETTINGS }
  }
  const raw = value as Partial<QuizOptionShuffleSettings>
  const thresholdSeconds = typeof raw.thresholdSeconds === 'number' && Number.isFinite(raw.thresholdSeconds)
    ? Math.min(QUIZ_OPTION_SHUFFLE_MAX_THRESHOLD_SECONDS, Math.max(0, raw.thresholdSeconds))
    : QUIZ_OPTION_SHUFFLE_DEFAULT_THRESHOLD_SECONDS
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : QUIZ_OPTION_SHUFFLE_DEFAULT_ENABLED,
    thresholdSeconds,
  }
}

export function isQuizOptionShuffleSettings(value: unknown): value is QuizOptionShuffleSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const raw = value as Partial<QuizOptionShuffleSettings>
  return typeof raw.enabled === 'boolean'
    && typeof raw.thresholdSeconds === 'number'
    && Number.isFinite(raw.thresholdSeconds)
}

export function shouldAutoShuffleQuizOptions(
  elapsedMs: number | null,
  settings: QuizOptionShuffleSettings,
) {
  return settings.enabled
    && elapsedMs != null
    && elapsedMs >= 0
    && elapsedMs < settings.thresholdSeconds * 1000
}

export function shuffleQuizOptions<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1))
    ;[result[index], result[swap]] = [result[swap], result[index]]
  }
  return result
}

export function withShuffledQuizOptions<T>(
  options: readonly T[],
  state: QuizOptionOrderState,
  idOf: (option: T) => string,
  rng: () => number = Math.random,
): QuizOptionOrderState {
  const ids = options.map(idOf)
  if (ids.length < 2) return state
  const currentIdsValid = state.currentOrder.length === ids.length
    && new Set(state.currentOrder).size === ids.length
    && ids.every((id) => state.currentOrder.includes(id))
  const originalIdsValid = state.originalOrder.length === ids.length
    && new Set(state.originalOrder).size === ids.length
    && ids.every((id) => state.originalOrder.includes(id))
  const currentOrder = currentIdsValid ? state.currentOrder : ids
  const originalOrder = state.shuffled && originalIdsValid ? state.originalOrder : ids
  let next = shuffleQuizOptions(currentOrder, rng)
  if (next.every((id, index) => id === currentOrder[index])) next = [...next.slice(1), next[0]]
  return { originalOrder: [...originalOrder], currentOrder: next, shuffled: true }
}

export function withRestoredQuizOptions(state: QuizOptionOrderState): QuizOptionOrderState {
  if (!state.shuffled) return state
  return {
    originalOrder: [...state.originalOrder],
    currentOrder: [...state.originalOrder],
    shuffled: false,
  }
}

/**
 * Questions whose next visit must start with shuffled options.
 *
 * 自动打乱 is a rule about the *next* look, never the answer being read right
 * now: reshuffling in place would move the option the learner just clicked and
 * the explanation under it. A fast answer therefore only leaves a marker here;
 * `useQuizOptionShuffle` turns it into a shuffled first paint when the question
 * is shown again (this visit, a later visit, or after a reload).
 *
 * Memory-only by default; `sessionStorage` keeps it across a reload in the same
 * tab so a refresh between questions does not silently drop the rule.
 */
const PENDING_STORAGE_KEY = 'memory-anki.quiz.auto-option-shuffle.pending.v1'
const pendingAutoShuffle = new Set<number>()

function readPendingFromSession(): number[] {
  try {
    const raw = globalThis.sessionStorage?.getItem(PENDING_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is number => typeof item === 'number' && Number.isInteger(item))
      : []
  } catch {
    return []
  }
}

function writePendingToSession(): void {
  try {
    globalThis.sessionStorage?.setItem(PENDING_STORAGE_KEY, JSON.stringify([...pendingAutoShuffle]))
  } catch {
    // A full/disabled storage only costs the reload mirror.
  }
}

export function markQuizOptionAutoShufflePending(questionId: number | null): void {
  if (questionId == null) return
  if (pendingAutoShuffle.has(questionId)) return
  pendingAutoShuffle.add(questionId)
  writePendingToSession()
}

export function takeQuizOptionAutoShufflePending(questionId: number | null): boolean {
  if (questionId == null) return false
  if (!pendingAutoShuffle.has(questionId)) {
    const restored = readPendingFromSession().includes(questionId)
    if (!restored) return false
    pendingAutoShuffle.add(questionId)
  }
  pendingAutoShuffle.delete(questionId)
  writePendingToSession()
  return true
}

export function resetQuizOptionAutoShufflePendingForTest(): void {
  pendingAutoShuffle.clear()
  try {
    globalThis.sessionStorage?.removeItem(PENDING_STORAGE_KEY)
  } catch {
    // Nothing to clean.
  }
}
