import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_MEMORY_ANKI_SHORTCUTS,
  MEMORY_ANKI_SHORTCUTS_STORAGE_KEY,
  readMemoryAnkiShortcuts,
  resetMemoryAnkiShortcuts,
  sanitizeMemoryAnkiShortcutMap,
  useMemoryAnkiShortcuts,
  writeMemoryAnkiShortcuts,
} from '@/entities/preferences/model/memoryAnkiShortcuts'

describe('memoryAnkiShortcuts', () => {
  beforeEach(() => window.localStorage.clear())

  it('returns defaults when storage is empty', () => {
    expect(readMemoryAnkiShortcuts()).toEqual(DEFAULT_MEMORY_ANKI_SHORTCUTS)
  })

  it('allows bare letter keys for flip-card actions and scene-local uniqueness', () => {
    const sanitized = sanitizeMemoryAnkiShortcutMap({
      hide_child_cards_practice: { code: 'KeyH', key: 'h', shift: false, ctrl: false, alt: false, meta: false },
      hide_child_cards_review: { code: 'KeyH', key: 'h', shift: true, ctrl: false, alt: false, meta: false },
      flip_subtree_cards_practice: { code: 'KeyA', key: 'a', shift: false, ctrl: false, alt: false, meta: false },
      flip_subtree_cards_review: { code: 'KeyA', key: 'a', shift: false, ctrl: false, alt: false, meta: false },
      flip_direct_child_cards_practice: { code: 'KeyS', key: 's', shift: false, ctrl: false, alt: false, meta: false },
      flip_direct_child_cards_review: { code: 'KeyS', key: 's', shift: false, ctrl: false, alt: false, meta: false },
    })
    expect(sanitized.hide_child_cards_practice).toEqual({
      code: 'KeyH',
      key: 'h',
      shift: false,
      ctrl: false,
      alt: false,
      meta: false,
    })
    expect(sanitized.hide_child_cards_review).not.toBeNull()
    expect(sanitized.flip_subtree_cards_review).toEqual({
      code: 'KeyA',
      key: 'a',
      shift: false,
      ctrl: false,
      alt: false,
      meta: false,
    })
    expect(sanitized.flip_direct_child_cards_review).toEqual({
      code: 'KeyS',
      key: 's',
      shift: false,
      ctrl: false,
      alt: false,
      meta: false,
    })
  })

  it('defaults include bare A/S for bulk flip actions', () => {
    expect(DEFAULT_MEMORY_ANKI_SHORTCUTS.flip_subtree_cards_review).toEqual({
      code: 'KeyA',
      key: 'a',
      shift: false,
      ctrl: false,
      alt: false,
      meta: false,
    })
    expect(DEFAULT_MEMORY_ANKI_SHORTCUTS.flip_direct_child_cards_practice).toEqual({
      code: 'KeyS',
      key: 's',
      shift: false,
      ctrl: false,
      alt: false,
      meta: false,
    })
  })

  it('writes sanitized settings and resets back to defaults', () => {
    const saved = writeMemoryAnkiShortcuts({
      ...DEFAULT_MEMORY_ANKI_SHORTCUTS,
      hide_child_cards_review: { code: 'KeyZ', key: 'z', shift: true, ctrl: false, alt: false, meta: false },
    })
    expect(saved.hide_child_cards_review).toEqual({ code: 'KeyZ', key: 'z', shift: true, ctrl: false, alt: false, meta: false })
    expect(window.localStorage.getItem(MEMORY_ANKI_SHORTCUTS_STORAGE_KEY)).toBeNull()
    expect(resetMemoryAnkiShortcuts()).toEqual(DEFAULT_MEMORY_ANKI_SHORTCUTS)
  })

  it('invokes the latest handlers after re-render without rebinding gaps', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(
      ({ handler }) =>
        useMemoryAnkiShortcuts(
          'practice',
          { flip_subtree_cards_practice: handler },
          true,
        ),
      { initialProps: { handler: first } },
    )

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true, cancelable: true }),
      )
    })
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()

    rerender({ handler: second })

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true, cancelable: true }),
      )
    })
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('does not preventDefault when handler returns false', () => {
    const handler = vi.fn(() => false)
    renderHook(() =>
      useMemoryAnkiShortcuts('practice', { flip_subtree_cards_practice: handler }, true),
    )

    let event!: KeyboardEvent
    act(() => {
      event = new KeyboardEvent('keydown', {
        key: 'a',
        code: 'KeyA',
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
      useMemoryAnkiShortcuts('practice', { flip_subtree_cards_practice: handler }, true),
    )

    let event!: KeyboardEvent
    act(() => {
      event = new KeyboardEvent('keydown', {
        key: 'a',
        code: 'KeyA',
        bubbles: true,
        cancelable: true,
      })
      window.dispatchEvent(event)
    })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })
})
