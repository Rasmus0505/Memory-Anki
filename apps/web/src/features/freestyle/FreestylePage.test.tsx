import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FreestylePage from '@/features/freestyle/FreestylePage'
import {
  readFreestyleProgress,
  saveFreestyleProgress,
} from '@/features/freestyle/model/freestyle'
import type { ReviewFeedbackSettings } from '@/shared/feedback/reviewFeedbackSettings'
import type { FreestyleCard, FreestyleQuizCard } from '@/shared/api/contracts'

const getFreestyleFeedApiMock = vi.fn()
const getPalacesGroupedApiMock = vi.fn()
const recordPalaceQuizChoiceAttemptApiMock = vi.fn()
const requestPalaceShortAnswerFeedbackApiMock = vi.fn()
const dispatchGlobalFeedbackMock = vi.fn()
const emitReviewConfettiMock = vi.fn()
const promptForAiOptionsMock = vi.fn()
const useTimedSessionMock = vi.fn()
const toastErrorMock = vi.fn()
const toastSuccessMock = vi.fn()
const memoryLookupDialogMock = vi.fn()

vi.mock('@/features/freestyle/api', () => ({
  getFreestyleFeedApi: (...args: unknown[]) => getFreestyleFeedApiMock(...args),
}))

vi.mock('@/entities/palace/api', () => ({
  getPalacesGroupedApi: (...args: unknown[]) => getPalacesGroupedApiMock(...args),
}))

vi.mock('@/features/palace-quiz/api', () => ({
  recordPalaceQuizChoiceAttemptApi: (...args: unknown[]) =>
    recordPalaceQuizChoiceAttemptApiMock(...args),
  requestPalaceShortAnswerFeedbackApi: (...args: unknown[]) =>
    requestPalaceShortAnswerFeedbackApiMock(...args),
}))

vi.mock('@/features/palace-quiz/components/PalaceQuizMemoryLookupDialog', () => ({
  PalaceQuizMemoryLookupDialog: (props: unknown) => {
    memoryLookupDialogMock(props)
    return null
  },
}))

vi.mock('@/features/ai-config/useAiRunConfigDialog', () => ({
  useAiRunConfigDialog: () => ({
    promptForAiOptions: (...args: unknown[]) => promptForAiOptionsMock(...args),
    aiRunConfigDialog: null,
  }),
}))

vi.mock('@/shared/components/session/GlobalTimerProvider', () => ({
  useGlobalTimerRegistration: vi.fn(),
}))

vi.mock('@/shared/hooks/useTimedSession', () => ({
  useTimedSession: (...args: unknown[]) => useTimedSessionMock(...args),
  shouldAutoStartOnPageEnter: vi.fn(() => false),
}))

vi.mock('@/shared/feedback/globalFeedbackModel', () => ({
  dispatchGlobalFeedback: (...args: unknown[]) => dispatchGlobalFeedbackMock(...args),
}))

vi.mock('@/shared/components/celebration', () => ({
  emitReviewConfetti: (...args: unknown[]) => emitReviewConfettiMock(...args),
}))

vi.mock('@/shared/feedback/reviewFeedbackSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/feedback/reviewFeedbackSettings')>()
  return {
    ...actual,
    readReviewFeedbackSettings: () => ({
      ...actual.DEFAULT_REVIEW_FEEDBACK_SETTINGS,
      mode: 'immersive',
      soundEnabled: true,
      animationEnabled: true,
      reducedCelebrationMotion: false,
      scenes: {
        ...actual.DEFAULT_REVIEW_FEEDBACK_SETTINGS.scenes,
        milestone: {
          ...actual.DEFAULT_REVIEW_FEEDBACK_SETTINGS.scenes.milestone,
          enabled: true,
          soundEnabled: true,
          animationEnabled: true,
          steps: [4, 8, 12, 20],
          confettiAmount: 1.15,
          confettiPreset: 'fireworks',
          volumeBoost: 1.1,
        },
      },
    }) satisfies ReviewFeedbackSettings,
    getSceneEffectiveVolume: vi.fn(() => 1.265),
  }
})

vi.mock('@/shared/feedback/toast', () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}))

function timerMock() {
  return {
    status: 'idle',
    effectiveSeconds: 0,
    startedAt: null,
    setSceneActive: vi.fn(),
    start: vi.fn(),
    registerActivity: vi.fn(),
  }
}

function quizCard(id: number, correctOptionId = 'A'): FreestyleQuizCard {
  return {
    id: `quiz:${id}`,
    type: 'quiz_question',
    content_type: 'quiz_question',
    group_key: 'palace:1',
    palace_context: {
      id: 1,
      title: '测试宫殿',
      resolved_title: '测试宫殿',
    },
    mini_palace_context: null,
    chapter_context: null,
    question: {
      id,
      palace_id: 1,
      mini_palace_id: null,
      mini_palace: null,
      question_type: 'multiple_choice',
      stem: `选择题 ${id}`,
      options: [
        { id: 'A', text: '正确项' },
        { id: 'B', text: '干扰项' },
      ],
      answer_payload: { correct_option_id: correctOptionId },
      analysis: '解析',
      source_meta: {
        source_kind: 'manual',
        subject_document_id: null,
        page_numbers: null,
        image_names: null,
        extra_prompt: '',
        ai_call_log_id: null,
        generated_at: '',
        generation_mode: 'manual',
      },
      sort_order: id,
      correct_count: 0,
      incorrect_count: 0,
      attempt_count: 0,
      created_at: null,
      updated_at: null,
    },
  }
}

function shortAnswerCard(id: number): FreestyleQuizCard {
  const card = quizCard(id)
  return {
    ...card,
    question: {
      ...card.question,
      question_type: 'short_answer',
      stem: `简答题 ${id}`,
      options: [],
      answer_payload: { reference_answer: '参考答案' },
    },
  }
}

function renderPage(cards: FreestyleCard[]) {
  getFreestyleFeedApiMock.mockResolvedValue({ cards })
  return render(
    <MemoryRouter>
      <FreestylePage />
    </MemoryRouter>,
  )
}

function renderPageWithFeed(
  feeds: Array<{ cards: FreestyleCard[] }>,
) {
  feeds.forEach((feed) => {
    getFreestyleFeedApiMock.mockResolvedValueOnce(feed)
  })
  return render(
    <MemoryRouter>
      <FreestylePage />
    </MemoryRouter>,
  )
}

async function switchToFreeMode() {
  fireEvent.click(await screen.findByRole('button', { name: '自由随心' }))
}

async function answerChoiceAt(index: number, optionText = 'A. 正确项') {
  await screen.findByText(`选择题 ${index + 1}`)
  fireEvent.click(screen.getAllByRole('button', { name: optionText })[index])
}

describe('FreestylePage feedback', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })
    getFreestyleFeedApiMock.mockReset()
    getPalacesGroupedApiMock.mockResolvedValue({ subjects: [] })
    recordPalaceQuizChoiceAttemptApiMock.mockReturnValue(new Promise(() => undefined))
    requestPalaceShortAnswerFeedbackApiMock.mockResolvedValue({
      feedback_text: 'AI 点评完成',
      resolved_ai: { model_label: '测试模型' },
    })
    dispatchGlobalFeedbackMock.mockClear()
    emitReviewConfettiMock.mockClear()
    promptForAiOptionsMock.mockResolvedValue({ provider: 'test', model: 'demo' })
    useTimedSessionMock.mockReturnValue(timerMock())
    toastErrorMock.mockClear()
    toastSuccessMock.mockClear()
    memoryLookupDialogMock.mockClear()
  })

  it('emits correct and incorrect result feedback only when a card is first resolved', async () => {
    renderPage([quizCard(1), quizCard(2, 'B')])

    await answerChoiceAt(0)
    await waitFor(() => {
      expect(dispatchGlobalFeedbackMock).toHaveBeenCalledWith(
        'quiz_result_correct',
        expect.objectContaining({ label: '答对', screenPulse: 'soft', audioScope: 'local' }),
      )
    })
    expect(recordPalaceQuizChoiceAttemptApiMock).toHaveBeenCalledWith(1, 'A')

    fireEvent.click(screen.getByRole('button', { name: '下一题' }))
    await answerChoiceAt(1)
    await waitFor(() => {
      expect(dispatchGlobalFeedbackMock).toHaveBeenCalledWith(
        'quiz_result_incorrect',
        expect.objectContaining({ label: '答错', screenPulse: null, audioScope: 'local' }),
      )
    })
    expect(recordPalaceQuizChoiceAttemptApiMock).toHaveBeenCalledWith(2, 'A')

    const resultEvents = dispatchGlobalFeedbackMock.mock.calls.filter(([event]) =>
      event === 'quiz_result_correct' || event === 'quiz_result_incorrect',
    )
    expect(resultEvents).toHaveLength(2)
  })

  it('emits quiz-result confetti for correct freestyle answers', async () => {
    renderPage([quizCard(1)])

    await answerChoiceAt(0)

    await waitFor(() => {
      expect(emitReviewConfettiMock).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'quiz_correct',
        }),
      )
    })
    expect(emitReviewConfettiMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'quiz_correct',
        confettiAmount: 0.8,
        confettiPreset: 'random_direction',
        reducedMotion: false,
        soundEnabled: true,
        volume: 1.265,
      }),
    )
  })

  it('does not emit result confetti for incorrect freestyle answers', async () => {
    renderPage([quizCard(1, 'B')])

    await answerChoiceAt(0)

    await waitFor(() => {
      expect(dispatchGlobalFeedbackMock).toHaveBeenCalledWith(
        'quiz_result_incorrect',
        expect.objectContaining({ label: '答错', screenPulse: null, audioScope: 'local' }),
      )
    })
    expect(emitReviewConfettiMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'quiz_correct' }),
    )
  })

  it('fires milestone confetti once when the correct streak reaches a configured step', async () => {
    renderPage([quizCard(1), quizCard(2), quizCard(3), quizCard(4)])

    for (let index = 0; index < 4; index += 1) {
      await answerChoiceAt(index)
      expect(recordPalaceQuizChoiceAttemptApiMock).toHaveBeenCalledWith(index + 1, 'A')
      if (index < 3) {
        fireEvent.click(screen.getByRole('button', { name: '下一题' }))
      }
    }

    await waitFor(() => {
      expect(emitReviewConfettiMock).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'milestone',
          confettiAmount: 1.15,
          confettiPreset: 'fireworks',
          milestoneStep: 0,
          reducedMotion: false,
          soundEnabled: true,
          volume: 1.265,
        }),
      )
    })
    expect(emitReviewConfettiMock.mock.calls.filter(([args]) => args.kind === 'milestone')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: '清空本地进度' }))
    for (let index = 0; index < 4; index += 1) {
      await answerChoiceAt(index)
      expect(recordPalaceQuizChoiceAttemptApiMock).toHaveBeenCalledWith(index + 1, 'A')
      if (index < 3) {
        fireEvent.click(screen.getByRole('button', { name: '下一题' }))
      }
    }
    await waitFor(() => {
      expect(emitReviewConfettiMock.mock.calls.filter(([args]) => args.kind === 'milestone')).toHaveLength(2)
    })
  })

  it('emits missing-input feedback for empty short-answer AI feedback requests', async () => {
    renderPage([shortAnswerCard(10)])

    fireEvent.click(await screen.findByRole('button', { name: '提交答案' }))
    fireEvent.click(screen.getByRole('button', { name: 'AI点评' }))

    await waitFor(() => {
      expect(dispatchGlobalFeedbackMock).toHaveBeenCalledWith(
        'quiz_error_missing_input',
        expect.objectContaining({ label: '先写答案', audioScope: 'local' }),
      )
    })
    expect(toastErrorMock).toHaveBeenCalledWith('请先填写你的答案。')
  })

  it('shows an immersive queue HUD and marks fresh versus answered cards', async () => {
    renderPage([quizCard(1), quizCard(2)])

    expect(await screen.findAllByText('新题')).toHaveLength(2)
    expect(screen.getByText('未做 2')).toBeTruthy()
    expect(screen.getByText('已做 0')).toBeTruthy()
    expect(screen.getByText('跳转 0')).toBeTruthy()

    await answerChoiceAt(0)

    await waitFor(() => {
      expect(screen.getByText('已做过')).toBeTruthy()
      expect(screen.getAllByText('新题')).toHaveLength(1)
      expect(screen.getByText('未做 1')).toBeTruthy()
      expect(screen.getByText('已做 1')).toBeTruthy()
    })
  })

  it('does not overwrite the saved card index while the freestyle feed is still loading', async () => {
    saveFreestyleProgress({
      currentIndex: 2,
      correctStreak: 3,
      questionStates: {},
      resolvedQuestionIds: [],
      lastQueueSignature: 'quiz:1|quiz:2|quiz:3',
    })
    getFreestyleFeedApiMock.mockReturnValue(new Promise(() => undefined))

    render(
      <MemoryRouter>
        <FreestylePage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(readFreestyleProgress().currentIndex).toBe(2)
    })
  })

  it('restores the saved card index after reopening once the queue loads', async () => {
    const cards = [quizCard(1), quizCard(2), quizCard(3)]
    const { unmount } = renderPage(cards)
    await switchToFreeMode()

    await screen.findByText('1/3')
    fireEvent.click(screen.getByRole('button', { name: '下一题' }))
    await waitFor(() => {
      expect(screen.getByText('2/3')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '下一题' }))
    await waitFor(() => {
      expect(screen.getByText('3/3')).toBeTruthy()
      expect(readFreestyleProgress().currentIndex).toBe(2)
    })

    unmount()
    getFreestyleFeedApiMock.mockResolvedValue({ cards })
    render(
      <MemoryRouter>
        <FreestylePage />
      </MemoryRouter>,
    )
    await switchToFreeMode()

    await waitFor(() => {
      expect(screen.getByText('3/3')).toBeTruthy()
      expect(readFreestyleProgress().currentIndex).toBe(2)
    })
  })

  it('downgrades answered cards after a reload without clearing them from the deck', async () => {
    const cards = [quizCard(1), quizCard(2), quizCard(3)]
    const { unmount } = renderPage(cards)
    await switchToFreeMode()

    await answerChoiceAt(0)
    await waitFor(() => {
      expect(screen.getByText('已做过')).toBeTruthy()
    })

    unmount()
    getFreestyleFeedApiMock.mockResolvedValue({ cards })
    render(
      <MemoryRouter>
        <FreestylePage />
      </MemoryRouter>,
    )
    await switchToFreeMode()

    await screen.findByText('选择题 2')
    expect(screen.getAllByText(/^选择题 \d$/).map((node) => node.textContent)).toEqual([
      '选择题 2',
      '选择题 3',
      '选择题 1',
    ])
    expect(screen.getByText('未做 2')).toBeTruthy()
    expect(screen.getByText('已做 1')).toBeTruthy()
  })

  it('reshuffles without clearing answered-card progress', async () => {
    renderPage([quizCard(1), quizCard(2), quizCard(3)])
    await switchToFreeMode()

    await answerChoiceAt(0)
    await waitFor(() => {
      expect(screen.getByText('已做 1')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '重洗队列' }))

    await waitFor(() => {
      expect(screen.getByText('已做 1')).toBeTruthy()
      expect(screen.getByText('未做 2')).toBeTruthy()
    })
    expect(toastSuccessMock).not.toHaveBeenCalledWith('已清空随心进度')
  })

  it('emits short-answer AI start, success, cancel, and failure feedback', async () => {
    renderPage([shortAnswerCard(10)])

    fireEvent.change(await screen.findByPlaceholderText('先写下你的答案，再点击提交'), {
      target: { value: '我的答案' },
    })
    fireEvent.click(screen.getByRole('button', { name: '提交答案' }))
    fireEvent.click(screen.getByRole('button', { name: 'AI点评' }))

    await waitFor(() => {
      expect(dispatchGlobalFeedbackMock).toHaveBeenCalledWith(
        'quiz_generate_start',
        expect.objectContaining({ label: 'AI点评', audioScope: 'global' }),
      )
      expect(dispatchGlobalFeedbackMock).toHaveBeenCalledWith(
        'quiz_result_ai_feedback_ready',
        expect.objectContaining({ label: 'AI完成', audioScope: 'global' }),
      )
    })

    promptForAiOptionsMock.mockResolvedValueOnce(null)
    fireEvent.click(screen.getByRole('button', { name: 'AI点评' }))
    await waitFor(() => {
      expect(dispatchGlobalFeedbackMock).toHaveBeenCalledWith(
        'quiz_generate_cancel',
        expect.objectContaining({ label: '取消AI', audioScope: 'global' }),
      )
    })

    promptForAiOptionsMock.mockResolvedValueOnce({ provider: 'test', model: 'demo' })
    requestPalaceShortAnswerFeedbackApiMock.mockRejectedValueOnce(new Error('boom'))
    fireEvent.click(screen.getByRole('button', { name: 'AI点评' }))
    await waitFor(() => {
      expect(dispatchGlobalFeedbackMock).toHaveBeenCalledWith(
        'quiz_error_ai_failed',
        expect.objectContaining({ label: 'AI失败', audioScope: 'global' }),
      )
    })
  })

  it('opens the memory palace lookup for the current random card palace only when available', async () => {
    renderPage([quizCard(1)])

    await screen.findByText('选择题 1')
    expect(screen.getByRole('button', { name: '查看宫殿' })).not.toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: '查看宫殿' }))

    await waitFor(() => {
      expect(memoryLookupDialogMock).toHaveBeenCalledWith(
        expect.objectContaining({
          open: true,
          currentPalaceId: 1,
          followCurrentPalace: true,
        }),
      )
    })
  })

  it('keeps the memory palace lookup disabled when the current random card has no palace context', async () => {
    renderPage([
      {
        id: 'action:english',
        type: 'action',
        content_type: 'english',
        action_kind: 'english',
        title: '英语练习',
        subtitle: '继续英语学习',
        href: '/english',
        reason: '推荐',
        priority: 10,
        palace_context: null,
      },
    ])
    await switchToFreeMode()

    await screen.findByText('英语练习')
    expect(screen.getByRole('button', { name: '查看宫殿' })).toHaveProperty('disabled', true)
    expect(memoryLookupDialogMock).not.toHaveBeenCalled()
  })

  it('opens in today training mode by default and can switch to free mode without overwriting free config', async () => {
    window.localStorage.setItem(
      'memory-anki.freestyle.config',
      JSON.stringify({
        range: 'specific_palaces',
        contentTypes: {
          quiz_question: true,
          review: false,
          segment_review: false,
          mini_review: false,
          practice: false,
          english: false,
          english_reading: false,
        },
        specificPalaceIds: [9],
        orderMode: 'sequential',
        questionType: 'all',
        actionFrequency: 'none',
        seed: 17,
      }),
    )
    renderPageWithFeed([
      { cards: [quizCard(1)] },
      { cards: [] },
      { cards: [quizCard(2)] },
    ])

    expect(await screen.findByRole('button', { name: '今日训练' })).toBeTruthy()
    expect(screen.getByText('12 个/轮')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '自由随心' }))

    await waitFor(() => {
      expect(getFreestyleFeedApiMock).toHaveBeenCalledWith(
        expect.objectContaining({
          range: 'specific_palaces',
          palaceIds: [9],
        }),
      )
    })
  })

  it('shows a today training summary after the fixed round is completed', async () => {
    renderPageWithFeed([
      { cards: Array.from({ length: 12 }, (_, index) => quizCard(index + 1)) },
      { cards: [] },
      { cards: [] },
    ])

    await screen.findByText('选择题 1')
    fireEvent.click(screen.getByRole('button', { name: '下一题' }))
    for (let index = 0; index < 11; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: '下一题' }))
    }

    expect(await screen.findByText('本轮完成')).toBeTruthy()
    expect(screen.getByRole('button', { name: '再来一轮' })).toBeTruthy()
  })

  it('keeps today progress when starting another round', async () => {
    renderPageWithFeed([
      { cards: [quizCard(1)] },
      { cards: [] },
      { cards: [] },
      { cards: [quizCard(1)] },
      { cards: [] },
      { cards: [] },
    ])

    await answerChoiceAt(0)
    await waitFor(() => {
      expect(screen.getByText('已做 1')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '下一题' }))
    fireEvent.click(await screen.findByRole('button', { name: '再来一轮' }))

    await waitFor(() => {
      expect(screen.getByText('已做 1')).toBeTruthy()
    })
  })

  it('shows the today empty state with create and free-mode actions', async () => {
    renderPageWithFeed([{ cards: [] }, { cards: [] }, { cards: [] }])

    expect(await screen.findByText('今天暂时没有可训练内容')).toBeTruthy()
    expect(screen.getByRole('link', { name: '新建宫殿' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '切到自由随心' }))

    await waitFor(() => {
      expect(getFreestyleFeedApiMock).toHaveBeenCalledWith(
        expect.objectContaining({ range: 'all' }),
      )
    })
  })
})
