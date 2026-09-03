import type { QuizRuntimeState } from '@/modules/quiz/domain/quiz-entity'
import type { PalaceQuizTabKey, PalaceQuizViewMode } from '@/modules/quiz/ui/palace-quiz/model/palaceQuizPage'

export interface PalaceQuizLiveView {
  palaceId: number | null
  tab: PalaceQuizTabKey
  viewMode: PalaceQuizViewMode
  questionId: number | null
  questionIndex: number
  questionState: { questionId: number; state: QuizRuntimeState } | null
}

const TABS: PalaceQuizTabKey[] = ['practice', 'manage', 'generate']
const VIEW_MODES: PalaceQuizViewMode[] = ['single', 'list']

export function decodePalaceQuizLiveView(raw: unknown): PalaceQuizLiveView | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const tab = TABS.includes(record.tab as PalaceQuizTabKey) ? record.tab as PalaceQuizTabKey : 'practice'
  const viewMode = VIEW_MODES.includes(record.viewMode as PalaceQuizViewMode)
    ? record.viewMode as PalaceQuizViewMode
    : 'single'
  const questionRaw = record.questionState && typeof record.questionState === 'object'
    ? record.questionState as Record<string, unknown>
    : null
  return {
    palaceId: typeof record.palaceId === 'number' ? record.palaceId : null,
    tab,
    viewMode,
    questionId: typeof record.questionId === 'number' ? record.questionId : null,
    questionIndex: typeof record.questionIndex === 'number' && Number.isFinite(record.questionIndex)
      ? record.questionIndex
      : 0,
    questionState: questionRaw && typeof questionRaw.questionId === 'number'
      ? {
          questionId: questionRaw.questionId,
          state: (questionRaw.state && typeof questionRaw.state === 'object'
            ? questionRaw.state
            : {}) as QuizRuntimeState,
        }
      : null,
  }
}

export function isPalaceQuizApplyReady(remote: PalaceQuizLiveView, questionIds: number[]) {
  if (remote.questionId == null) return true
  return questionIds.includes(remote.questionId)
}

export function applyPalaceQuizLiveView(
  current: {
    tab: PalaceQuizTabKey
    viewMode: PalaceQuizViewMode
    questionIndex: number
    questionStates: Record<number, QuizRuntimeState>
  },
  remote: PalaceQuizLiveView,
  questionIds: number[],
) {
  const ready = isPalaceQuizApplyReady(remote, questionIds)
  const byId = remote.questionId != null ? questionIds.indexOf(remote.questionId) : -1
  const questionIndex = !ready
    ? current.questionIndex
    : byId >= 0
      ? byId
      : Math.max(0, Math.min(remote.questionIndex, Math.max(0, questionIds.length - 1)))
  const questionStates = { ...current.questionStates }
  if (remote.questionState) {
    questionStates[remote.questionState.questionId] = remote.questionState.state
  }
  return {
    tab: remote.tab,
    viewMode: remote.viewMode,
    questionIndex,
    questionStates,
    ready,
  }
}

export function palaceQuizSameInteraction(previous: PalaceQuizLiveView, next: PalaceQuizLiveView) {
  return previous.questionId === next.questionId
    && previous.tab === next.tab
    && previous.viewMode === next.viewMode
    && JSON.stringify(previous.questionState) === JSON.stringify(next.questionState)
}
