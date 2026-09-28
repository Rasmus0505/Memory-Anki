import { describe, expect, it } from 'vitest'
import {
  getFreestyleChoiceIndex,
  getFreestyleFeedPageDirection,
  getFreestyleQuestionDirection,
  isFreestyleOverlayOpen,
  isFreestyleShortcutBlocked,
  shouldSwallowFreestyleFeedPageKey,
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

  it('maps vertical arrows to feed paging only when no quiz dialog owns the keyboard', () => {
    expect(getFreestyleFeedPageDirection('ArrowUp')).toBe('previous')
    expect(getFreestyleFeedPageDirection('ArrowDown')).toBe('next')
    expect(getFreestyleFeedPageDirection('ArrowLeft')).toBeNull()
    const scope = document.createElement('div')
    scope.dataset.keyboardShortcutsSuspended = 'true'
    document.body.appendChild(scope)
    try {
      const direction = isFreestyleShortcutBlocked(document.body)
        ? null
        : getFreestyleFeedPageDirection('ArrowUp')
      expect(direction).toBeNull()
    } finally {
      scope.remove()
    }
  })

  it('cancels arrow scrolling aimed at the feed while a quiz dialog is open', () => {
    const feed = document.createElement('div')
    const cardButton = document.createElement('button')
    feed.append(cardButton)
    const dialog = document.createElement('div')
    dialog.dataset.keyboardShortcutsSuspended = 'true'
    dialog.setAttribute('role', 'dialog')
    const dialogButton = document.createElement('button')
    dialog.append(dialogButton)
    const field = document.createElement('input')
    feed.append(field)
    document.body.append(feed, dialog)
    try {
      expect(isFreestyleShortcutBlocked(cardButton)).toBe(true)
      expect(shouldSwallowFreestyleFeedPageKey(cardButton, feed)).toBe(true)
      expect(shouldSwallowFreestyleFeedPageKey(dialogButton, feed)).toBe(false)
      expect(shouldSwallowFreestyleFeedPageKey(field, feed)).toBe(false)
    } finally {
      feed.remove()
      dialog.remove()
    }
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

  describe('isFreestyleOverlayOpen', () => {
    it('is false on a bare feed', () => {
      expect(isFreestyleOverlayOpen()).toBe(false)
    })

    it('reports the linked-question window that suspends shortcuts', () => {
      const scope = document.createElement('div')
      scope.dataset.keyboardShortcutsSuspended = 'true'
      document.body.appendChild(scope)

      try {
        expect(isFreestyleOverlayOpen()).toBe(true)
      } finally {
        scope.remove()
      }
    })

    it('reports any open dialog so auto-advance cannot turn the feed behind it', () => {
      const dialog = document.createElement('div')
      dialog.setAttribute('role', 'dialog')
      document.body.appendChild(dialog)

      try {
        expect(isFreestyleOverlayOpen()).toBe(true)
      } finally {
        dialog.remove()
      }
    })
  })
})
