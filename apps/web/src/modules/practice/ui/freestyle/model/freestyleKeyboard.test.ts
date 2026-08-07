import { describe, expect, it } from 'vitest'
import {
  getFreestyleChoiceIndex,
  getFreestyleQuestionDirection,
  isFreestyleShortcutBlocked,
} from './freestyleKeyboard'

describe('freestyle keyboard shortcuts', () => {
  it('maps number and letter keys to the first four choices', () => {
    expect(getFreestyleChoiceIndex('1')).toBe(0)
    expect(getFreestyleChoiceIndex('4')).toBe(3)
    expect(getFreestyleChoiceIndex('A')).toBe(0)
    expect(getFreestyleChoiceIndex('d')).toBe(3)
    expect(getFreestyleChoiceIndex('5')).toBeNull()
    expect(getFreestyleChoiceIndex('e')).toBeNull()
  })

  it('maps left and right arrows to question navigation', () => {
    expect(getFreestyleQuestionDirection('ArrowLeft')).toBe('previous')
    expect(getFreestyleQuestionDirection('ArrowRight')).toBe('next')
    expect(getFreestyleQuestionDirection('ArrowUp')).toBeNull()
  })

  it('blocks page navigation while a modal owns keyboard input', () => {
    const scope = document.createElement('div')
    scope.dataset.keyboardShortcutsSuspended = 'true'
    document.body.appendChild(scope)

    try {
      expect(isFreestyleShortcutBlocked(window)).toBe(true)
    } finally {
      scope.remove()
    }
  })
})
