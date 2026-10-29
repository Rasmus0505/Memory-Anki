import { describe, expect, it } from 'vitest'
import {
  getFreestyleChoiceIndex,
  getFreestyleFeedPageDirection,
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

  it('keeps PageUp/PageDown as fixed feed paging keys and never binds Space', () => {
    expect(getFreestyleFeedPageDirection('PageUp')).toBe('previous')
    expect(getFreestyleFeedPageDirection('PageDown')).toBe('next')
    // Space belongs to typing (a card can be in inline edit), so it pages nothing.
    expect(getFreestyleFeedPageDirection(' ')).toBeNull()
    expect(getFreestyleFeedPageDirection('Spacebar')).toBeNull()
    // Arrows come from the configurable 翻卡快捷键 map, not this helper.
    expect(getFreestyleFeedPageDirection('ArrowUp')).toBeNull()
    expect(getFreestyleFeedPageDirection('ArrowDown')).toBeNull()
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

  it('blocks every learning shortcut while a card editor is open', () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    editor.setAttribute('data-mindmap-editor-active', 'true')
    const card = document.createElement('button')
    document.body.append(editor, card)
    try {
      // Focus may sit on the card shell (toolbar/layout stole it) while the edit
      // session is still open: the card behind the editor must not page or flip.
      expect(isFreestyleShortcutBlocked(card)).toBe(true)
      expect(isFreestyleShortcutBlocked(document.body)).toBe(true)
      expect(isFreestyleOverlayOpen()).toBe(true)
    } finally {
      editor.remove()
      card.remove()
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
