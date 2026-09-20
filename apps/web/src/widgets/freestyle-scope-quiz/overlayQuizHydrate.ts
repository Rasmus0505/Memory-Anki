import {
  readQuizSessionStates,
  writeQuizSessionState,
  type QuizRuntimeState,
} from '@/modules/quiz/public'
import type {
  FreestyleOverlayQuizState,
  FreestyleRoundStatePayload,
} from '@/shared/api/contracts'

export function overlayFromRound(round: FreestyleRoundStatePayload | null | undefined) {
  return round?.plan?.overlay_quiz ?? null
}

export function statesFromOverlay(overlay: FreestyleOverlayQuizState): Record<number, QuizRuntimeState> {
  const merged: Record<number, QuizRuntimeState> = {}
  for (const [key, value] of Object.entries(overlay.states || {})) {
    const questionId = Number(key)
    if (!Number.isInteger(questionId) || questionId <= 0 || !value || typeof value !== 'object') continue
    merged[questionId] = value as QuizRuntimeState
  }
  return merged
}

export function seedSessionFromOverlay(
  overlay: FreestyleOverlayQuizState,
  states: Record<number, QuizRuntimeState>,
) {
  const palaceMap = overlay.question_palace_ids || {}
  for (const [key, state] of Object.entries(states)) {
    const questionId = Number(key)
    if (!Number.isInteger(questionId) || questionId <= 0) continue
    const existing = readQuizSessionStates()[questionId]
    if (existing?.resolved || existing?.rating) continue
    writeQuizSessionState(questionId, state, palaceMap[String(questionId)])
  }
}

export function mergeOverlayAndSessionStates(
  overlay: FreestyleOverlayQuizState,
): Record<number, QuizRuntimeState> {
  const fromOverlay = statesFromOverlay(overlay)
  seedSessionFromOverlay(overlay, fromOverlay)
  const sessionStates = readQuizSessionStates()
  const merged: Record<number, QuizRuntimeState> = {}
  for (const questionId of overlay.question_ids) {
    const session = sessionStates[questionId]
    const overlayState = fromOverlay[questionId]
    if (session) merged[questionId] = session
    else if (overlayState) merged[questionId] = overlayState
  }
  return merged
}

export function resolveOverlayResumeIndex(
  overlay: FreestyleOverlayQuizState,
  states: Record<number, QuizRuntimeState>,
) {
  const preferred = Number(overlay.current_index)
  const firstOpen = overlay.question_ids.findIndex((questionId) => !states[questionId]?.resolved)
  if (
    Number.isInteger(preferred)
    && preferred >= 0
    && preferred < overlay.question_ids.length
  ) {
    return preferred
  }
  return firstOpen >= 0 ? firstOpen : 0
}
