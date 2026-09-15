import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'
import {
  QUIZ_ANSWER_MODE_STORAGE_KEY,
  readQuizAnswerMode,
  saveQuizAnswerMode,
} from './quizAnswerModeSettings'

describe('quizAnswerModeSettings', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetClientPreferenceCacheForTest()
  })

  afterEach(() => {
    saveQuizAnswerMode('choice')
  })

  it('defaults to choice mode', () => {
    expect(readQuizAnswerMode()).toBe('choice')
  })

  it('reads a locally stored setting before backend preferences finish loading', () => {
    window.localStorage.setItem(
      QUIZ_ANSWER_MODE_STORAGE_KEY,
      JSON.stringify({ mcqMode: 'subjective' }),
    )
    expect(readQuizAnswerMode()).toBe('subjective')
  })

  it('writes the chosen mode', () => {
    expect(saveQuizAnswerMode('subjective').mcqMode).toBe('subjective')
    expect(readQuizAnswerMode()).toBe('subjective')
  })
})
