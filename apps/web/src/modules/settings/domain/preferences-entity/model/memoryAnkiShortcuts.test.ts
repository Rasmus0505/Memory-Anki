import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_MEMORY_ANKI_SHORTCUTS,
  MEMORY_ANKI_SHORTCUTS_STORAGE_KEY,
  readMemoryAnkiShortcuts,
  resetMemoryAnkiShortcuts,
  resolveFlipCardPageDirection,
  sanitizeMemoryAnkiShortcutMap,
  useMemoryAnkiShortcuts,
  writeMemoryAnkiShortcuts,
} from '@/modules/settings/domain/preferences-entity/model/memoryAnkiShortcuts'

describe('memoryAnkiShortcuts', () => {
  beforeEach(() => window.localStorage.clear())

  it('returns defaults when storage is empty', () => {
    expect(readMemoryAnkiShortcuts()).toEqual(DEFAULT_MEMORY_ANKI_SHORTCUTS)
  })

  it('defaults flip to Enter, retract to Backspace, paging to the vertical arrows', () => {
    expect(DEFAULT_MEMORY_ANKI_SHORTCUTS.flip_current_card).toEqual({
      code: 'Enter',
      key: 'enter',
      shift: false,
      ctrl: false,
      alt: false,
      meta: false,
    })
    expect(DEFAULT_MEMORY_ANKI_SHORTCUTS.retract_current_card?.code).toBe('Backspace')
    expect(DEFAULT_MEMORY_ANKI_SHORTCUTS.page_next_card?.code).toBe('ArrowDown')
    expect(DEFAULT_MEMORY_ANKI_SHORTCUTS.page_previous_card?.code).toBe('ArrowUp')
    expect(DEFAULT_MEMORY_ANKI_SHORTCUTS.hide_child_cards).toEqual({
      code: 'KeyH',
      key: 'h',
      shift: true,
      ctrl: false,
      alt: false,
      meta: false,
    })
  })

  it('keeps the bare Backspace 收卡 binding and Shift+H through sanitize', () => {
    const sanitized = sanitizeMemoryAnkiShortcutMap(
      readMemoryAnkiShortcuts(),
    )
    expect(sanitized.retract_current_card?.code).toBe('Backspace')
    expect(sanitized.hide_child_cards?.code).toBe('KeyH')
  })

  it('reserves W/A/S/D for the mind-map view pan so no flip action can take them', () => {
    const keyA = { code: 'KeyA', key: 'a', shift: false, ctrl: false, alt: false, meta: false }
    const sanitized = sanitizeMemoryAnkiShortcutMap({
      ...DEFAULT_MEMORY_ANKI_SHORTCUTS,
      flip_current_card: keyA,
    })
    expect(sanitized.flip_current_card).toBeNull()
  })

  it('treats an explicit null as a cleared binding, not a missing default', () => {
    const cleared = sanitizeMemoryAnkiShortcutMap({
      ...DEFAULT_MEMORY_ANKI_SHORTCUTS,
      retract_current_card: null,
    })
    expect(cleared.retract_current_card).toBeNull()
    // A missing key still inherits the default for a newly added action.
    const { retract_current_card: _gone, ...withoutRetract } = DEFAULT_MEMORY_ANKI_SHORTCUTS
    expect(sanitizeMemoryAnkiShortcutMap(withoutRetract).retract_current_card?.code).toBe('Backspace')
  })

  it('rejects feed-owned page keys on flip actions but keeps them available to page actions', () => {
    const space = { code: 'Space', key: 'space', shift: false, ctrl: false, alt: false, meta: false }
    const pageDown = { code: 'PageDown', key: 'pagedown', shift: false, ctrl: false, alt: false, meta: false }
    const sanitized = sanitizeMemoryAnkiShortcutMap({
      ...DEFAULT_MEMORY_ANKI_SHORTCUTS,
      flip_current_card: space,
      hide_child_cards: pageDown,
      // Fixed page aliases are already built in, but a stored page binding is harmless.
      page_previous_card: { code: 'ArrowLeft', key: 'arrowleft', shift: false, ctrl: false, alt: false, meta: false },
    })
    expect(sanitized.flip_current_card).toBeNull()
    expect(sanitized.hide_child_cards).toBeNull()
    expect(sanitized.page_previous_card?.code).toBe('ArrowLeft')
  })

  it('drops duplicate bindings so one key cannot run two actions', () => {
    const sanitized = sanitizeMemoryAnkiShortcutMap({
      ...DEFAULT_MEMORY_ANKI_SHORTCUTS,
      hide_child_cards: { code: 'Enter', key: 'enter', shift: false, ctrl: false, alt: false, meta: false },
    })
    expect(sanitized.flip_current_card?.code).toBe('Enter')
    expect(sanitized.hide_child_cards).toBeNull()
  })

  it('resolves configured page keys before the fixed left/right arrows', () => {
    const shortcuts = { ...DEFAULT_MEMORY_ANKI_SHORTCUTS }
    expect(
      resolveFlipCardPageDirection(
        new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown' }),
        shortcuts,
      ),
    ).toBe('next')
    expect(
      resolveFlipCardPageDirection(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft' }),
        shortcuts,
      ),
    ).toBe('previous')
    const custom = {
      ...shortcuts,
      page_next_card: { code: 'KeyJ', key: 'j', shift: false, ctrl: false, alt: false, meta: false },
    }
    expect(
      resolveFlipCardPageDirection(
        new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ' }),
        custom,
      ),
    ).toBe('next')
    expect(
      resolveFlipCardPageDirection(
        new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown' }),
        { ...custom, page_next_card: null },
      ),
    ).toBeNull()
  })

  it('writes sanitized settings and resets back to defaults', () => {
    const saved = writeMemoryAnkiShortcuts({
      ...DEFAULT_MEMORY_ANKI_SHORTCUTS,
      flip_current_card: { code: 'KeyZ', key: 'z', shift: true, ctrl: false, alt: false, meta: false },
    })
    expect(saved.flip_current_card).toEqual({ code: 'KeyZ', key: 'z', shift: true, ctrl: false, alt: false, meta: false })
    expect(window.localStorage.getItem(MEMORY_ANKI_SHORTCUTS_STORAGE_KEY)).toBeNull()
    expect(resetMemoryAnkiShortcuts()).toEqual(DEFAULT_MEMORY_ANKI_SHORTCUTS)
  })

  it('invokes the latest handlers after re-render without rebinding gaps', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(
      ({ handler }) =>
        useMemoryAnkiShortcuts(
          'flip',
          { hide_child_cards: handler },
          true,
        ),
      { initialProps: { handler: first } },
    )

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'h', code: 'KeyH', shiftKey: true, bubbles: true, cancelable: true }),
      )
    })
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()

    rerender({ handler: second })

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'h', code: 'KeyH', shiftKey: true, bubbles: true, cancelable: true }),
      )
    })
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('passes the keydown event to the handler', () => {
    const handler = vi.fn((_event: KeyboardEvent) => true)
    renderHook(() => useMemoryAnkiShortcuts('flip', { flip_current_card: handler }, true))

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }),
      )
    })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0].code).toBe('Enter')
  })

  it('does not preventDefault when handler returns false', () => {
    const handler = vi.fn(() => false)
    renderHook(() =>
      useMemoryAnkiShortcuts('flip', { hide_child_cards: handler }, true),
    )

    let event!: KeyboardEvent
    act(() => {
      event = new KeyboardEvent('keydown', {
        key: 'h',
        code: 'KeyH',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
      window.dispatchEvent(event)
    })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(false)
  })

  it('prevents default when handler runs successfully', () => {
    const handler = vi.fn(() => true)
    renderHook(() =>
      useMemoryAnkiShortcuts('flip', { hide_child_cards: handler }, true),
    )

    let event!: KeyboardEvent
    act(() => {
      event = new KeyboardEvent('keydown', {
        key: 'h',
        code: 'KeyH',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
      window.dispatchEvent(event)
    })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it('suspends the flip map while a card editor is open', () => {
    const handler = vi.fn(() => true)
    renderHook(() => useMemoryAnkiShortcuts('flip', { flip_current_card: handler }, true))
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    editor.setAttribute('data-mindmap-editor-active', 'true')
    document.body.appendChild(editor)

    try {
      // Focus already left the editor (toolbar/layout), the session is still open.
      act(() => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }),
        )
      })
      expect(handler).not.toHaveBeenCalled()
    } finally {
      editor.remove()
    }
  })

  it('lets the dialog owner opt in without re-opening shortcuts behind it', () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const button = document.createElement('button')
    dialog.appendChild(button)
    document.body.appendChild(dialog)

    try {
      const pageHandler = vi.fn()
      const ownerHandler = vi.fn()
      renderHook(() => {
        useMemoryAnkiShortcuts('flip', { flip_current_card: pageHandler }, true)
        useMemoryAnkiShortcuts(
          'flip',
          { flip_current_card: ownerHandler },
          true,
          { allowOverlayTarget: true },
        )
      })

      act(() => {
        button.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            bubbles: true,
            cancelable: true,
          }),
        )
      })

      expect(ownerHandler).toHaveBeenCalledTimes(1)
      expect(pageHandler).not.toHaveBeenCalled()
    } finally {
      dialog.remove()
    }
  })

  it('does not run page shortcuts while a modal owns keyboard input', () => {
    const scope = document.createElement('div')
    scope.dataset.keyboardShortcutsSuspended = 'true'
    const button = document.createElement('button')
    scope.appendChild(button)
    document.body.appendChild(scope)

    try {
      const handler = vi.fn()
      renderHook(() =>
        useMemoryAnkiShortcuts('flip', { hide_child_cards: handler }, true),
      )

      act(() => {
        button.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'a',
            code: 'KeyA',
            bubbles: true,
            cancelable: true,
          }),
        )
      })

      expect(handler).not.toHaveBeenCalled()
    } finally {
      scope.remove()
    }
  })
})
