import { vi } from 'vitest'
import { getPalaceEditorApi } from '@/modules/content/public'
import {
  ensureFreestyleOverlayQuizApi,
  progressFreestyleOverlayQuizApi,
} from '@/modules/practice/ui/freestyle/api'
import {
  deletePalaceQuizQuestionApi,
  getPalaceQuizQuestionsByIdsApi,
  listQuestionNodeBindingsApi,
} from '@/modules/quiz/domain/quiz-entity/api'

/**
 * Module mocks shared by the `FreestyleScopeQuizDialog` specs.
 *
 * The dialog resolves questions, bindings, the round plan, palace lookup and
 * preferences through six module boundaries, so every spec needs the same
 * mocks. Import this before the widget: an ESM import list runs in source
 * order, and importing the widget first would bind the real modules.
 */

vi.mock('@/modules/practice/public', () => ({
  createOperationId: () => 'op-1',
}))

vi.mock('@/modules/practice/ui/freestyle/api', () => ({
  ensureFreestyleOverlayQuizApi: vi.fn(),
  progressFreestyleOverlayQuizApi: vi.fn(),
  shuffleFreestyleOverlayQuizApi: vi.fn(),
}))

vi.mock('@/modules/quiz/domain/quiz-entity/api', () => ({
  getPalaceQuizQuestionsByIdsApi: vi.fn(),
  listQuestionNodeBindingsApi: vi.fn(),
  deletePalaceQuizQuestionApi: vi.fn(async () => ({ ok: true })),
  setPalaceQuizQuestionMarkedApi: vi.fn(async (id: number, marked: boolean) => ({
    item: { id, marked },
  })),
}))

vi.mock('@/modules/settings/public', () => ({
  useAiRunConfigDialog: () => ({ promptForAiOptions: vi.fn(), aiRunConfigDialog: null }),
}))

vi.mock('@/modules/content/public', () => ({
  getPalaceEditorApi: vi.fn(),
  getPalacesGroupedApi: vi.fn(async () => ({
    groups: [],
    ungrouped: [{ id: 7, title: '第一节', resolved_title: '第一节新教育运动' }],
    subjects: [],
  })),
}))

vi.mock('@/modules/quiz/public', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/quiz/public')>()
  return {
    ...actual,
    isQuizChoiceShortcutActive: () => false,
    QuizQuestionInteraction: () => null,
    useQuizAttemptOrchestration: () => ({
      handleChoiceSelect: vi.fn(),
      handleShortAnswerSubmit: vi.fn(),
      handleShortAnswerFeedback: vi.fn(),
    }),
  }
})

vi.mock('@/widgets/palace-memory-lookup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/widgets/palace-memory-lookup')>()
  return {
    ...actual,
    PalaceMemoryLookupDialog: ({
      open,
      currentPalaceId,
      focusNodeUid,
    }: {
      open: boolean
      currentPalaceId?: number | null
      focusNodeUid?: string | null
    }) =>
      open ? (
        <div
          data-testid="palace-memory-lookup"
          data-palace-id={String(currentPalaceId ?? '')}
          data-focus-node={String(focusNodeUid ?? '')}
        />
      ) : null,
  }
})

export const ensureFreestyleOverlayQuizApiMock = vi.mocked(ensureFreestyleOverlayQuizApi)
export const progressFreestyleOverlayQuizApiMock = vi.mocked(progressFreestyleOverlayQuizApi)
export const getPalaceQuizQuestionsByIdsApiMock = vi.mocked(getPalaceQuizQuestionsByIdsApi)
export const listQuestionNodeBindingsApiMock = vi.mocked(listQuestionNodeBindingsApi)
export const deletePalaceQuizQuestionApiMock = vi.mocked(deletePalaceQuizQuestionApi)
export const getPalaceEditorApiMock = vi.mocked(getPalaceEditorApi)
