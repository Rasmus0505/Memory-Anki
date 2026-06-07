import { beforeEach, describe, expect, it } from 'vitest'
import {
  captureShortcutFromKeyboardEvent,
  DEFAULT_ENGLISH_PRACTICE_SETTINGS,
  ENGLISH_PRACTICE_SETTINGS_STORAGE_KEY,
  getShortcutLabel,
  readEnglishPracticeSettings,
  sanitizeEnglishPracticeSettings,
  writeEnglishPracticeSettings,
} from '@/features/english/englishPracticeSettings'

describe('englishPracticeSettings', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('returns defaults when storage is empty', () => {
    expect(readEnglishPracticeSettings()).toEqual(DEFAULT_ENGLISH_PRACTICE_SETTINGS)
  })

  it('sanitizes duplicate and invalid shortcut values when saving', () => {
    const saved = writeEnglishPracticeSettings({
      ...DEFAULT_ENGLISH_PRACTICE_SETTINGS,
      shortcuts: {
        ...DEFAULT_ENGLISH_PRACTICE_SETTINGS.shortcuts,
        replay_sentence: { code: 'KeyA', key: 'a', shift: false, ctrl: false, alt: false, meta: false },
        previous_sentence: { code: 'Space', key: 'space', shift: true, ctrl: false, alt: false, meta: false },
        next_sentence: { code: 'Space', key: 'space', shift: true, ctrl: false, alt: false, meta: false },
      },
      sound: {
        enabled: false,
      },
    })

    expect(saved.shortcuts.replay_sentence).toBeNull()
    expect(saved.shortcuts.previous_sentence).not.toBeNull()
    expect(saved.shortcuts.next_sentence).toBeNull()
    expect(saved.sound.enabled).toBe(false)
    expect(saved.flow.autoAdvanceOnPass).toBe(true)
    expect(window.localStorage.getItem(ENGLISH_PRACTICE_SETTINGS_STORAGE_KEY)).toContain('"enabled":false')
  })

  it('forces translation timing back to after_answer', () => {
    const sanitized = sanitizeEnglishPracticeSettings({
      ...DEFAULT_ENGLISH_PRACTICE_SETTINGS,
      ui: { translationTiming: 'always' },
    })

    expect(sanitized.ui.translationTiming).toBe('after_answer')
  })

  it('falls back to the default auto advance preference when the saved value is invalid', () => {
    const sanitized = sanitizeEnglishPracticeSettings({
      ...DEFAULT_ENGLISH_PRACTICE_SETTINGS,
      flow: { autoAdvanceOnPass: 'nope' },
    })

    expect(sanitized.flow.autoAdvanceOnPass).toBe(DEFAULT_ENGLISH_PRACTICE_SETTINGS.flow.autoAdvanceOnPass)
  })

  it('formats shortcut labels for saved bindings', () => {
    expect(getShortcutLabel(DEFAULT_ENGLISH_PRACTICE_SETTINGS.shortcuts.replay_sentence)).toBe('Shift+Space')
  })

  it('rejects bare typing keys during shortcut capture', () => {
    const event = new KeyboardEvent('keydown', { key: 'a', code: 'KeyA' })
    const captured = captureShortcutFromKeyboardEvent(event)
    expect(captured.value).toBeNull()
    expect(captured.error).toContain('答题输入键')
  })

  it('captures valid shortcut combinations', () => {
    const event = new KeyboardEvent('keydown', { key: ' ', code: 'Space', shiftKey: true })
    const captured = captureShortcutFromKeyboardEvent(event)
    expect(captured.error).toBe('')
    expect(captured.value).toEqual({
      code: 'Space',
      key: 'space',
      shift: true,
      ctrl: false,
      alt: false,
      meta: false,
    })
  })
})
