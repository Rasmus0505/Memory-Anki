// Must be imported before the widget: this module registers the `vi.mock` calls
// for the widget's API dependencies, and an ESM import list is evaluated in
// source order, so importing the widget first would bind the real modules.
import {
  getPalaceQuizQuestionsApiMock,
  getPalaceQuizQuestionsByIdsApiMock,
  primeQuestionMocks,
  renderDialog,
  sampleQuestion,
  secondQuestion,
  shortAnswerQuestion,
} from './NodeBoundQuizDialog.harness'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearQuizSessionProgress,
  saveQuizAnswerMode,
  writeQuizSessionState,
} from '@/modules/quiz/public'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'

const SHUFFLE_STORAGE_KEY = 'memory-anki.quiz.shuffle-order.v1'

describe('NodeBoundQuizDialog 打乱题库', () => {
  beforeEach(() => {
    window.localStorage.clear()
    clearQuizSessionProgress()
    resetClientPreferenceCacheForTest()
    saveQuizAnswerMode('choice')
    vi.clearAllMocks()
    primeQuestionMocks()
  })

  it('shuffles only the unanswered questions, resumes at the first open one, and remembers the order', async () => {
    // 42 is already answered: it must keep slot 1 while 43 and 41 trade places.
    writeQuizSessionState(42, { resolved: true, selectedOptionId: 'A', correct: true })
    getPalaceQuizQuestionsByIdsApiMock.mockResolvedValue({
      items: [sampleQuestion, secondQuestion, shortAnswerQuestion],
      item_count: 3,
    })
    getPalaceQuizQuestionsApiMock.mockResolvedValue({
      items: [sampleQuestion, secondQuestion, shortAnswerQuestion],
    })

    const view = renderDialog({ questionIds: [42, 43, 41] })
    expect(await screen.findByText('下列哪一项是细胞膜的主要成分？')).toBeTruthy()

    // Constant 0 swaps the only two open slots: [43, 41] becomes [41, 43].
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    fireEvent.click(screen.getByRole('button', { name: '打乱题库' }))
    random.mockRestore()

    expect(await screen.findByText('简述细胞膜的主要成分。')).toBeTruthy()
    const stored = JSON.parse(window.localStorage.getItem(SHUFFLE_STORAGE_KEY) ?? '{}')
    expect(stored['1:node-1']).toEqual([42, 41, 43])

    view.unmount()
    // The order is a shared preference, so it must not depend on this browser's
    // storage: wiping localStorage must still reopen in the shuffled order.
    window.localStorage.clear()
    renderDialog({ questionIds: [42, 43, 41] })
    expect(await screen.findByText('下列哪一项是细胞膜的主要成分？')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '下一题' }))
    expect(await screen.findByText('简述细胞膜的主要成分。')).toBeTruthy()
  })

  it('hides the button when there is only one question', async () => {
    getPalaceQuizQuestionsByIdsApiMock.mockResolvedValue({
      items: [sampleQuestion],
      item_count: 1,
    })
    getPalaceQuizQuestionsApiMock.mockResolvedValue({ items: [sampleQuestion] })

    renderDialog({ questionIds: [42] })

    expect(await screen.findByText('下列哪一项是细胞膜的主要成分？')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '打乱题库' })).toBeNull()
  })
})
