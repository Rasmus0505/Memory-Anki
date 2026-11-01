export type FreestyleOverlayWrongState = {
  workspace: string
  roundId: string | null
  planVersion: number
  wrongQuestionIds: ReadonlySet<number>
}

type Listener = () => void

const EMPTY_STATE: FreestyleOverlayWrongState = {
  workspace: 'primary',
  roundId: null,
  planVersion: 0,
  wrongQuestionIds: new Set<number>(),
}

let state: FreestyleOverlayWrongState = EMPTY_STATE
const listeners = new Set<Listener>()

function normalizeIds(ids: Iterable<unknown> | null | undefined): ReadonlySet<number> {
  const normalized = new Set<number>()
  for (const value of ids ?? []) {
    const id = Number(value)
    if (Number.isInteger(id) && id > 0) normalized.add(id)
  }
  return normalized
}

function notify() {
  listeners.forEach((listener) => listener())
}

export function readFreestyleOverlayWrongState(): FreestyleOverlayWrongState {
  return state
}

export function subscribeFreestyleOverlayWrongState(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function replaceFreestyleOverlayWrongState(input: {
  workspace?: string
  roundId: string
  planVersion: number
  wrongQuestionIds: Iterable<unknown>
}): boolean {
  const roundId = String(input.roundId || '').trim()
  if (!roundId) return false
  const planVersion = Number.isFinite(Number(input.planVersion))
    ? Math.max(0, Math.round(Number(input.planVersion)))
    : 0
  if (state.roundId === roundId && planVersion < state.planVersion) return false
  state = {
    workspace: String(input.workspace || 'primary'),
    roundId,
    planVersion,
    wrongQuestionIds: normalizeIds(input.wrongQuestionIds),
  }
  notify()
  return true
}

export function clearFreestyleOverlayWrongState(roundId?: string): boolean {
  const requested = String(roundId || '').trim()
  if (requested && state.roundId && requested !== state.roundId) return false
  if (state.roundId == null && state.wrongQuestionIds.size === 0) return false
  state = EMPTY_STATE
  notify()
  return true
}

export function replaceFreestyleOverlayWrongStateFromOverlay(input: {
  workspace?: string
  roundId: string
  planVersion: number
  overlay?: {
    states?: Record<string, Record<string, unknown>>
    parked?: { states?: Record<string, Record<string, unknown>> }
  } | null
}): boolean {
  const states = {
    ...(input.overlay?.parked?.states ?? {}),
    ...(input.overlay?.states ?? {}),
  }
  return replaceFreestyleOverlayWrongState({
    workspace: input.workspace,
    roundId: input.roundId,
    planVersion: input.planVersion,
    wrongQuestionIds: Object.entries(states)
      .filter(([, value]) => value?.resolved === true && value?.correct === false)
      .map(([id]) => id),
  })
}
