import { beforeEach, describe, expect, it } from 'vitest'
import {
  captureShortcutFromKeyboardEvent,
  DEFAULT_ENGLISH_PRACTICE_SETTINGS,
  ENGLISH_PRACTICE_SETTINGS_STORAGE_KEY,
  getShortcutLabel,
  readEnglishPracticeSettings,
  sanitizeEnglishPracticeSettings,
  writeEnglishPracticeSettings,
} from '@/entities/preferences/model/englishPracticeSettings'

const LEGACY_V1_STORAGE_KEY = 'memory-anki-english-practice-settings-v1'

describe('englishPracticeSettings', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('returns defaults when storage is empty', () => {
    expect(readEnglishPracticeSettings()).toEqual(DEFAULT_ENGLISH_PRACTICE_SETTINGS)
  })

  it('uses the v2 storage key and ignores legacy v1 local settings', () => {
    window.localStorage.setItem(
      LEGACY_V1_STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_ENGLISH_PRACTICE_SETTINGS,
        sound: { enabled: false, masterVolume: 0 },
      }),
    )

    expect(ENGLISH_PRACTICE_SETTINGS_STORAGE_KEY).toBe('memory-anki-english-practice-settings-v2')
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
        masterVolume: 0.5,
      },
    })

    expect(saved.shortcuts.replay_sentence).toBeNull()
    expect(saved.shortcuts.previous_sentence).not.toBeNull()
    expect(saved.shortcuts.next_sentence).toBeNull()
    expect(saved.sound.enabled).toBe(false)
    expect(saved.flow.autoAdvanceOnPass).toBe(true)
    expect(window.localStorage.getItem(ENGLISH_PRACTICE_SETTINGS_STORAGE_KEY)).toBeNull()
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

  it('returns default masterVolume when storage is empty', () => {
    const settings = readEnglishPracticeSettings()
    expect(settings.sound.masterVolume).toBe(0.5)
  })

  it('sanitizes masterVolume to be within 0-1 range', () => {
    const sanitized = sanitizeEnglishPracticeSettings({
      ...DEFAULT_ENGLISH_PRACTICE_SETTINGS,
      sound: { enabled: true, masterVolume: 2.5 },
    })
    expect(sanitized.sound.masterVolume).toBe(1)

    const sanitizedLow = sanitizeEnglishPracticeSettings({
      ...DEFAULT_ENGLISH_PRACTICE_SETTINGS,
      sound: { enabled: true, masterVolume: -1 },
    })
    expect(sanitizedLow.sound.masterVolume).toBe(0)
  })

  it('preserves masterVolume when saving settings', () => {
    const saved = writeEnglishPracticeSettings({
      ...DEFAULT_ENGLISH_PRACTICE_SETTINGS,
      sound: { enabled: true, masterVolume: 0.3 },
    })
    expect(saved.sound.masterVolume).toBe(0.3)
    expect(window.localStorage.getItem(ENGLISH_PRACTICE_SETTINGS_STORAGE_KEY)).toBeNull()
  })

  it('fills in default masterVolume for legacy settings that lack it', () => {
    const sanitized = sanitizeEnglishPracticeSettings({
      shortcuts: DEFAULT_ENGLISH_PRACTICE_SETTINGS.shortcuts,
      sound: { enabled: false },
      flow: { autoAdvanceOnPass: true },
      replay: { autoReplayOnPass: false, singleSentenceLoopEnabled: false },
    })
    expect(sanitized.sound.masterVolume).toBe(0.5)
    expect(sanitized.sound.enabled).toBe(false)
  })
})
