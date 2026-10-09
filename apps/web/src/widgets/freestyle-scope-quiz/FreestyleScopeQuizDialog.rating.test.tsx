import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FREESTYLE_FEED_CONFIG } from '@/modules/practice/domain/feedConfig'
import { clearQuizSessionProgress } from '@/modules/quiz/public'
import { ensureFreestyleOverlayQuizApi } from '@/modules/practice/ui/freestyle/api'
import { FreestyleScopeQuizDialog } from './FreestyleScopeQuizDialog'

vi.mock('@/modules/practice/public', () => ({
  createOperationId: () => 'op-1',
}))

vi.mock('@/modules/practice/ui/freestyle/api', () => ({
  ensureFreestyleOverlayQuizApi: vi.fn(),
  progressFreestyleOverlayQuizApi: vi.fn(),
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
  getPalacesGroupedApi: vi.fn(async () => ({ groups: [], ungrouped: [], subjects: [] })),
}))

vi.mock('@/widgets/palace-memory-lookup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/widgets/palace-memory-lookup')>()
  return {
    ...actual,
    PalaceMemoryLookupDialog: () => null,
  }
})

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

const ensureFreestyleOverlayQuizApiMock = vi.mocked(ensureFreestyleOverlayQuizApi)

describe('FreestyleScopeQuizDialog rating display', () => {
  beforeEach(() => {
    clearQuizSessionProgress()
    vi.clearAllMocks()
    ensureFreestyleOverlayQuizApiMock.mockResolvedValue({
      round_id: 'round-1',
      plan_version: 2,
      plan: {
        overlay_quiz: {
          question_ids: [],
          current_index: 0,
          completed_ids: [],
          states: {},
          quiz_scope: 'cross_palace_random',
          seed: 1,
          scope_signature: 'sig',
          limit_reached: false,
          candidate_count: 0,
          kind_counts: { objective: 0, subjective: 0 },
        },
      },
    } as never)
  })

  it('lets a blank score follow the lowest reviewed ancestor, and still saves from that page', async () => {
    const onConfirmSetup = vi.fn()
    render(
      <FreestyleScopeQuizDialog
        open
        onOpenChange={vi.fn()}
        roundId="round-1"
        planVersion={1}
        storedConfig={DEFAULT_FREESTYLE_FEED_CONFIG}
        setupDone={false}
        roundReviewPalaceCount={2}
        onConfirmSetup={onConfirmSetup}
        onRoundSync={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /题目分数/ }))
    expect(screen.getByRole('radio', { name: /跟着已复习的最低分/ }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: /保持空白/ }))
    const start = await screen.findByRole('button', { name: '开始做题' })
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(start)
    expect(onConfirmSetup).toHaveBeenCalledWith(expect.objectContaining({
      overlayRatingInherit: 'blank',
    }))
  })
})
