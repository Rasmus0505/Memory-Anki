import { afterEach, describe, expect, it } from 'vitest'
import {
  clearQuizSessionProgress,
  isQuestionDue,
  markQuizSessionCompleted,
  readQuizSessionCompletedIds,
  readQuizSessionState,
  writeQuizSessionState,
} from './quizSessionProgress'

describe('quizSessionProgress', () => {
  afterEach(() => {
    clearQuizSessionProgress()
  })

  it('shares completed ids across surfaces until reload', () => {
    writeQuizSessionState(41, { resolved: true, correct: true })
    markQuizSessionCompleted(41, 7)
    expect(readQuizSessionCompletedIds().has(41)).toBe(true)
    expect(readQuizSessionState(41).resolved).toBe(true)
  })

  it('treats today and earlier due dates as due', () => {
    expect(isQuestionDue(null)).toBe(false)
    expect(isQuestionDue('1999-01-01')).toBe(true)
    expect(isQuestionDue('2999-01-01')).toBe(false)
  })
})
