import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearQuizSessionProgress,
  isQuestionDue,
  markQuizSessionCompleted,
  mergeQuizPracticeProgressSnapshot,
  readQuizPracticeProgressSnapshot,
  removeQuizSessionQuestions,
  readQuizSessionCompletedIds,
  readQuizSessionState,
  reloadQuizPracticeProgressFromStorage,
  writeQuizSessionState,
} from './quizSessionProgress'

describe('quizSessionProgress', () => {
  afterEach(() => {
    vi.useRealTimers()
    clearQuizSessionProgress()
  })

  it('shares completed ids across surfaces until an explicit clear', () => {
    writeQuizSessionState(41, { resolved: true, correct: true }, 7)
    markQuizSessionCompleted(41, 7)
    expect(readQuizSessionCompletedIds().has(41)).toBe(true)
    expect(readQuizSessionState(41).resolved).toBe(true)
    reloadQuizPracticeProgressFromStorage()
    expect(readQuizSessionCompletedIds().has(41)).toBe(true)
    clearQuizSessionProgress()
    reloadQuizPracticeProgressFromStorage()
    expect(readQuizSessionCompletedIds().has(41)).toBe(false)
  })

  it('keeps a new answer after a clear in the same millisecond across reload', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-07T00:00:00.000Z'))
    clearQuizSessionProgress()
    writeQuizSessionState(41, { resolved: true }, 7)
    reloadQuizPracticeProgressFromStorage()
    expect(readQuizSessionCompletedIds().has(41)).toBe(true)
  })

  it('removes unfinished state covered by a remote clear', () => {
    writeQuizSessionState(41, { selectedOptionId: 'A' }, 7)
    const snapshot = readQuizPracticeProgressSnapshot()
    mergeQuizPracticeProgressSnapshot({
      items: {},
      clears: { all: snapshot.items['41'].updatedAt, palaces: {}, questions: {} },
    })
    expect(readQuizSessionState(41)).toEqual({})
  })

  it('does not resurrect a cleared question from a stale snapshot', () => {
    writeQuizSessionState(41, { resolved: true }, 7)
    const stale = readQuizPracticeProgressSnapshot()
    removeQuizSessionQuestions([41])
    mergeQuizPracticeProgressSnapshot(stale)
    expect(readQuizSessionCompletedIds().has(41)).toBe(false)
  })

  it('treats today and earlier due dates as due', () => {
    expect(isQuestionDue(null)).toBe(false)
    expect(isQuestionDue('1999-01-01')).toBe(true)
    expect(isQuestionDue('2999-01-01')).toBe(false)
  })
})
