import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import FreestylePage from '@/features/freestyle/FreestylePage'
import type { ReviewFeedbackSettings } from '@/shared/feedback/reviewFeedbackSettings'
import type { FreestyleCard, FreestyleQuizCard } from '@/shared/api/contracts'

export { FreestylePage }

export const getFreestyleFeedApiMock = vi.fn()
export const createFreestyleQuestionAttemptApiMock = vi.fn()
export const createFreestyleQuestionExplanationApiMock = vi.fn()
export const getFreestyleQuestionAttemptsApiMock = vi.fn()
export const getFreestyleQuestionExplanationsApiMock = vi.fn()
export const getFreestyleHistorySummaryApiMock = vi.fn()
export const getWrongQuestionsApiMock = vi.fn()
export const getPalacesGroupedApiMock = vi.fn()
export const recordPalaceQuizChoiceAttemptApiMock = vi.fn()
export const requestPalaceQuestionExplainApiMock = vi.fn()
export const requestPalaceShortAnswerFeedbackApiMock = vi.fn()
export const dispatchGlobalFeedbackMock = vi.fn()
export const emitReviewConfettiMock = vi.fn()
export const promptForAiOptionsMock = vi.fn()
export const useTimedSessionMock = vi.fn()
export const toastErrorMock = vi.fn()
export const toastSuccessMock = vi.fn()
export const memoryLookupDialogMock = vi.fn()

vi.mock('@/features/freestyle/api', () => ({
  getFreestyleFeedApi: (...args: unknown[]) => getFreestyleFeedApiMock(...args),
  createFreestyleQuestionAttemptApi: (...args: unknown[]) =>
    createFreestyleQuestionAttemptApiMock(...args),
  createFreestyleQuestionExplanationApi: (...args: unknown[]) =>
    createFreestyleQuestionExplanationApiMock(...args),
  getFreestyleQuestionAttemptsApi: (...args: unknown[]) =>
    getFreestyleQuestionAttemptsApiMock(...args),
  getFreestyleQuestionExplanationsApi: (...args: unknown[]) =>
    getFreestyleQuestionExplanationsApiMock(...args),
  getFreestyleHistorySummaryApi: (...args: unknown[]) =>
    getFreestyleHistorySummaryApiMock(...args),
  getWrongQuestionsApi: (...args: unknown[]) => getWrongQuestionsApiMock(...args),
}))

vi.mock('@/entities/palace/api', () => ({
  getPalacesGroupedApi: (...args: unknown[]) => getPalacesGroupedApiMock(...args),
}))

vi.mock('@/entities/quiz/api', () => ({
  recordPalaceQuizChoiceAttemptApi: (...args: unknown[]) =>
    recordPalaceQuizChoiceAttemptApiMock(...args),
  requestPalaceQuestionExplainApi: (...args: unknown[]) =>
    requestPalaceQuestionExplainApiMock(...args),
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

export function timerMock() {
  return {
    status: 'idle',
    effectiveSeconds: 0,
    startedAt: null,
    setSceneActive: vi.fn(),
    start: vi.fn(),
    registerActivity: vi.fn(),
  }
}

export function quizCard(id: number, correctOptionId = 'A'): FreestyleQuizCard {
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

export function shortAnswerCard(id: number): FreestyleQuizCard {
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

export function renderPage(cards: FreestyleCard[]) {
  getFreestyleFeedApiMock.mockResolvedValue({ cards })
  return render(
    <MemoryRouter>
      <FreestylePage />
    </MemoryRouter>,
  )
}

export function renderFreestylePage() {
  return render(
    <MemoryRouter>
      <FreestylePage />
    </MemoryRouter>,
  )
}

export function renderPageWithFeed(
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

export async function switchToFreeMode() {
  fireEvent.click(await screen.findByRole('button', { name: '自由随心' }))
}

export async function answerChoiceAt(index: number, optionText = 'A. 正确项') {
  await screen.findByText(`选择题 ${index + 1}`)
  fireEvent.click(screen.getAllByRole('button', { name: optionText })[index])
}

export function setupFreestylePageTest() {
  window.localStorage.clear()
  window.sessionStorage.clear()
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  })
  getFreestyleFeedApiMock.mockReset()
  createFreestyleQuestionAttemptApiMock.mockResolvedValue({
    item: {
      id: 1,
      question_id: 1,
      palace_id: 1,
      palace_title: '测试宫殿',
      mini_palace_id: null,
      mini_palace_name: '',
      chapter_id: null,
      chapter_name: '',
      mode: 'today',
      question_type: 'multiple_choice',
      stem_snapshot: '选择题 1',
      answer_payload: { selected_option_id: 'A' },
      is_correct: true,
      created_at: null,
    },
  })
  createFreestyleQuestionExplanationApiMock.mockResolvedValue({
    item: {
      id: 1,
      question_id: 1,
      palace_id: 1,
      palace_title: '测试宫殿',
      mini_palace_id: null,
      mini_palace_name: '',
      chapter_id: null,
      chapter_name: '',
      question_type: 'multiple_choice',
      stem_snapshot: '选择题 1',
      user_question: '请解释这道题的核心考点是什么。',
      explanation_text: '讲解内容',
      ai_call_log_id: 'log-1',
      created_at: null,
    },
  })
  getFreestyleQuestionAttemptsApiMock.mockResolvedValue({ items: [] })
  getFreestyleQuestionExplanationsApiMock.mockResolvedValue({ items: [] })
  getFreestyleHistorySummaryApiMock.mockResolvedValue({
    stored: { attempt_count: 0, explanation_count: 0 },
    legacy_quiz: {
      question_count: 0,
      attempted_question_count: 0,
      attempt_count: 0,
      correct_count: 0,
      incorrect_count: 0,
    },
    legacy_ai_logs: {
      total_count: 0,
      explanation_count: 0,
      short_answer_feedback_count: 0,
    },
  })
  getWrongQuestionsApiMock.mockReset()
  getWrongQuestionsApiMock.mockResolvedValue({ total: 0, items: [] })
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
  window.confirm = vi.fn(() => true)
}
