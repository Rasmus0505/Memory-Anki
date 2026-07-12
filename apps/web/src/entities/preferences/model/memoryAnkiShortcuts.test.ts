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
  beforeEach(() => window.localStorage.clear())

  it('returns defaults when storage is empty', () => {
    expect(readMemoryAnkiShortcuts()).toEqual(DEFAULT_MEMORY_ANKI_SHORTCUTS)
  })

  it('rejects invalid bare typing keys', () => {
    const sanitized = sanitizeMemoryAnkiShortcutMap({
      hide_child_cards_practice: { code: 'KeyH', key: 'h', shift: false, ctrl: false, alt: false, meta: false },
      hide_child_cards_review: { code: 'KeyH', key: 'h', shift: true, ctrl: false, alt: false, meta: false },
    })
    expect(sanitized.hide_child_cards_practice).toBeNull()
    expect(sanitized.hide_child_cards_review).not.toBeNull()
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
})
