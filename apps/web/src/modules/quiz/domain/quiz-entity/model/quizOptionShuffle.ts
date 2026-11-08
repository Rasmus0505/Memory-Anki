export interface QuizOptionOrderState {
  currentOrder: string[]
  shuffled: boolean
}

export interface QuizOptionShuffleSettings {
  enabled: boolean
}

export const DEFAULT_QUIZ_OPTION_SHUFFLE_SETTINGS: QuizOptionShuffleSettings = {
  enabled: true,
}

export function sanitizeQuizOptionShuffleSettings(value: unknown): QuizOptionShuffleSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_QUIZ_OPTION_SHUFFLE_SETTINGS }
  }
  const raw = value as Partial<QuizOptionShuffleSettings>
  return {
    enabled: typeof raw.enabled === 'boolean'
      ? raw.enabled
      : DEFAULT_QUIZ_OPTION_SHUFFLE_SETTINGS.enabled,
  }
}

export function isQuizOptionShuffleSettings(value: unknown): value is QuizOptionShuffleSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return typeof (value as Partial<QuizOptionShuffleSettings>).enabled === 'boolean'
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
  const currentOrder = currentIdsValid ? state.currentOrder : ids
  let next = shuffleQuizOptions(currentOrder, rng)
  if (next.every((id, index) => id === currentOrder[index])) next = [...next.slice(1), next[0]]
  return { currentOrder: next, shuffled: true }
}
