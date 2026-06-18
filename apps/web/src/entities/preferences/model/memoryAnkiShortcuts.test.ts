import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_MEMORY_ANKI_SHORTCUTS,
  MEMORY_ANKI_SHORTCUTS_STORAGE_KEY,
  readMemoryAnkiShortcuts,
  resetMemoryAnkiShortcuts,
  sanitizeMemoryAnkiShortcutMap,
  writeMemoryAnkiShortcuts,
} from '@/entities/preferences/model/memoryAnkiShortcuts'

describe('memoryAnkiShortcuts', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('returns defaults when storage is empty', () => {
    expect(readMemoryAnkiShortcuts()).toEqual(DEFAULT_MEMORY_ANKI_SHORTCUTS)
  })

  it('keeps the same shortcut across different scenes but not within one scene', () => {
    const sanitized = sanitizeMemoryAnkiShortcutMap({
      toggle_focus_node: { code: 'KeyF', key: 'f', shift: true, ctrl: false, alt: false, meta: false },
      hide_child_cards_practice: { code: 'KeyH', key: 'h', shift: true, ctrl: false, alt: false, meta: false },
      hide_child_cards_review: { code: 'KeyH', key: 'h', shift: true, ctrl: false, alt: false, meta: false },
    })

    expect(sanitized.toggle_focus_node).toEqual(DEFAULT_MEMORY_ANKI_SHORTCUTS.toggle_focus_node)
    expect(sanitized.hide_child_cards_practice).not.toBeNull()
    expect(sanitized.hide_child_cards_review).not.toBeNull()
  })

  it('rejects invalid bare typing keys', () => {
    const sanitized = sanitizeMemoryAnkiShortcutMap({
      toggle_focus_node: { code: 'KeyF', key: 'f', shift: false, ctrl: false, alt: false, meta: false },
      hide_child_cards_practice: { code: 'KeyH', key: 'h', shift: true, ctrl: false, alt: false, meta: false },
      hide_child_cards_review: { code: 'KeyH', key: 'h', shift: true, ctrl: false, alt: false, meta: false },
    })

    expect(sanitized.toggle_focus_node).toBeNull()
    expect(sanitized.hide_child_cards_practice).not.toBeNull()
    expect(sanitized.hide_child_cards_review).not.toBeNull()
  })

  it('writes sanitized settings and resets back to defaults', () => {
    const saved = writeMemoryAnkiShortcuts({
      ...DEFAULT_MEMORY_ANKI_SHORTCUTS,
      toggle_focus_node: { code: 'KeyZ', key: 'z', shift: true, ctrl: false, alt: false, meta: false },
    })

    expect(saved.toggle_focus_node).toEqual({ code: 'KeyZ', key: 'z', shift: true, ctrl: false, alt: false, meta: false })
    expect(window.localStorage.getItem(MEMORY_ANKI_SHORTCUTS_STORAGE_KEY)).toBeNull()

    const reset = resetMemoryAnkiShortcuts()
    expect(reset).toEqual(DEFAULT_MEMORY_ANKI_SHORTCUTS)
    expect(window.localStorage.getItem(MEMORY_ANKI_SHORTCUTS_STORAGE_KEY)).toBeNull()
  })
})
