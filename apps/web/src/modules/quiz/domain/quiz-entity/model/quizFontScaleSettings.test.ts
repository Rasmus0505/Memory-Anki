import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'
import {
  QUIZ_FONT_SCALE_STORAGE_KEY,
  readQuizFontScale,
  saveQuizFontScale,
} from './quizFontScaleSettings'

describe('quizFontScaleSettings', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetClientPreferenceCacheForTest()
  })

  afterEach(() => {
    saveQuizFontScale(100)
  })

  it('defaults to 100%', () => {
    expect(readQuizFontScale()).toBe(100)
  })

  it('reads a locally stored percent before backend preferences finish loading', () => {
    window.localStorage.setItem(QUIZ_FONT_SCALE_STORAGE_KEY, JSON.stringify({ percent: 140 }))
    expect(readQuizFontScale()).toBe(140)
  })

  it('writes the chosen percent', () => {
    expect(saveQuizFontScale(125)).toBe(130)
    expect(readQuizFontScale()).toBe(130)
  })
})
