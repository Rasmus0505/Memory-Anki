import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FREESTYLE_FEED_CONFIG, sanitizeFreestyleFeedConfig } from '@/modules/practice/domain/feedConfig'
import {
  ensureFreestyleOverlayQuizApi,
  progressFreestyleOverlayQuizApi,
} from '@/modules/practice/ui/freestyle/api'
import { FreestyleScopeQuizDialog } from './FreestyleScopeQuizDialog'
import type { FreestyleOverlayScopePalaces } from '@/shared/api/contracts'

/**
 * 随心 config changes must reach an already-open 做题 dialog immediately, and
 * name the palaces that left the pool.
 *
 * The original complaint had two halves: the pool silently kept a stale scope
 * until the dialog was reopened, and when it did shrink nothing said so.
 *
 * Split from `FreestyleScopeQuizDialog.test.tsx` because that spec is at its
 * size limit and this is a distinct concern (config reactivity, not question
 * interaction).
 */

vi.mock('@/modules/practice/public', () => ({
  createOperationId: () => 'op-1',
}))

vi.mock('@/modules/practice/ui/freestyle/api', () => ({
  ensureFreestyleOverlayQuizApi: vi.fn(),
  progressFreestyleOverlayQuizApi: vi.fn(),
}))

vi.mock('@/modules/quiz/domain/quiz-entity/api', () => ({
  getPalaceQuizQuestionsByIdsApi: vi.fn(async () => ({ items: [], item_count: 0 })),
  listQuestionNodeBindingsApi: vi.fn(async () => ({ items: [], item_count: 0 })),
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
  return { ...actual, PalaceMemoryLookupDialog: () => null }
})

const ensureMock = vi.mocked(ensureFreestyleOverlayQuizApi)
const progressMock = vi.mocked(progressFreestyleOverlayQuizApi)

function scope(palaceIds: number[], titles: Record<number, string> = {}) {
  const palaces = palaceIds.map((palaceId) => ({
    palace_id: palaceId,
    title: titles[palaceId] ?? `宫殿 ${palaceId}`,
    question_count: 5,
    objective: 5,
    subjective: 0,
    in_pool: true,
    reason: '' as const,
  }))
  return {
    scheduled_count: palaces.length,
    in_pool_count: palaces.length,
    question_count: palaces.length * 5,
    palaces,
  } satisfies FreestyleOverlayScopePalaces
}

function round(before: FreestyleOverlayScopePalaces, after?: FreestyleOverlayScopePalaces) {
  return {
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
        scope_palaces: after ?? before,
      },
    },
  } as never
}

/** Feed config whose memory-palace stream is narrowed to one palace. */
function configForPalace(palaceId: number) {
  return sanitizeFreestyleFeedConfig({
    ...DEFAULT_FREESTYLE_FEED_CONFIG,
    streams: {
      ...DEFAULT_FREESTYLE_FEED_CONFIG.streams,
      memory_palace: {
        ...DEFAULT_FREESTYLE_FEED_CONFIG.streams.memory_palace,
        specific_palace_ids: [palaceId],
        subject_scope: 'all',
        subject_ids: [],
      },
    },
  })
}

describe('FreestyleScopeQuizDialog config reactivity', () => {
  // Stable identities, as the real host passes (`adoptRoundVersion` is a
  // useCallback). A fresh `vi.fn()` per render would re-run `adoptRound`'s
  // effect deps and make the call counts meaningless.
  const onOpenChange = vi.fn()
  const onConfirmSetup = vi.fn()
  const onRoundSync = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    progressMock.mockResolvedValue({} as never)
  })

  it('re-ensures the 做题 scope when the 随心 palace selection changes while open', async () => {
    ensureMock.mockResolvedValue(round(scope([7, 8], { 7: '第一节英国近代教育', 8: '第二节法国近代教育' })))
    const { rerender } = render(
      <FreestyleScopeQuizDialog
        open
        onOpenChange={onOpenChange}
        roundId="round-1"
        planVersion={1}
        storedConfig={configForPalace(7)}
        setupDone
        roundReviewPalaceCount={2}
        onConfirmSetup={onConfirmSetup}
        onRoundSync={onRoundSync}
      />,
    )
    await waitFor(() => expect(ensureMock).toHaveBeenCalledTimes(1))

    // The learner widens the selection in the config dialog; the 做题 dialog is
    // still open. It must adopt the new scope without being closed and reopened.
    rerender(
      <FreestyleScopeQuizDialog
        open
        onOpenChange={onOpenChange}
        roundId="round-1"
        planVersion={1}
        storedConfig={configForPalace(8)}
        setupDone
        roundReviewPalaceCount={2}
        onConfirmSetup={onConfirmSetup}
        onRoundSync={onRoundSync}
      />,
    )
    await waitFor(() => expect(ensureMock).toHaveBeenCalledTimes(2))
  })

  it('does not re-ensure when an unrelated config change leaves palace scope alone', async () => {
    ensureMock.mockResolvedValue(round(scope([7])))
    const config = configForPalace(7)
    const { rerender } = render(
      <FreestyleScopeQuizDialog
        open
        onOpenChange={onOpenChange}
        roundId="round-1"
        planVersion={1}
        storedConfig={config}
        setupDone
        roundReviewPalaceCount={1}
        onConfirmSetup={onConfirmSetup}
        onRoundSync={onRoundSync}
      />,
    )
    await waitFor(() => expect(ensureMock).toHaveBeenCalledTimes(1))

    // Same palace scope, different object identity: not a scope change.
    rerender(
      <FreestyleScopeQuizDialog
        open
        onOpenChange={onOpenChange}
        roundId="round-1"
        planVersion={1}
        storedConfig={sanitizeFreestyleFeedConfig({ ...config, queue_length: 12 })}
        setupDone
        roundReviewPalaceCount={1}
        onConfirmSetup={onConfirmSetup}
        onRoundSync={onRoundSync}
      />,
    )
    await waitFor(() => expect(ensureMock).toHaveBeenCalledTimes(1))
  })

  it('names the palaces a config change took out of 做题', async () => {
    // First ensure reports both palaces playable...
    ensureMock.mockResolvedValueOnce(round(scope([7, 8], { 7: '第一节英国近代教育', 8: '第二节法国近代教育' })))
    const { rerender } = render(
      <FreestyleScopeQuizDialog
        open
        onOpenChange={onOpenChange}
        roundId="round-1"
        planVersion={1}
        storedConfig={configForPalace(8)}
        setupDone
        roundReviewPalaceCount={2}
        onConfirmSetup={onConfirmSetup}
        onRoundSync={onRoundSync}
      />,
    )
    await waitFor(() => expect(ensureMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId('freestyle-scope-left-notice')).toBeNull()

    // ...then the learner narrows the range, and palace 8 drops out.
    ensureMock.mockResolvedValue(
      round(scope([7, 8]), {
        scheduled_count: 2,
        in_pool_count: 1,
        question_count: 10,
        palaces: [
          {
            palace_id: 7,
            title: '第一节英国近代教育',
            question_count: 5,
            objective: 5,
            subjective: 0,
            in_pool: true,
            reason: '',
          },
          {
            palace_id: 8,
            title: '第二节法国近代教育',
            question_count: 5,
            objective: 5,
            subjective: 0,
            in_pool: false,
            reason: 'kinds_filtered',
          },
        ],
      }),
    )
    rerender(
      <FreestyleScopeQuizDialog
        open
        onOpenChange={onOpenChange}
        roundId="round-1"
        planVersion={1}
        storedConfig={configForPalace(7)}
        setupDone
        roundReviewPalaceCount={2}
        onConfirmSetup={onConfirmSetup}
        onRoundSync={onRoundSync}
      />,
    )

    const notice = await screen.findByTestId('freestyle-scope-left-notice')
    expect(notice.textContent).toContain('第二节法国近代教育')
    // A palace that never left must not be named in the removal notice.
    expect(notice.textContent).not.toContain('第一节英国近代教育')
  })
})
