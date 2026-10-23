import { beforeEach, describe, expect, it } from 'vitest'
import {
  captureShortcutFromKeyboardEvent,
  DEFAULT_ENGLISH_PRACTICE_SETTINGS,
  ENGLISH_PRACTICE_SETTINGS_STORAGE_KEY,
  getShortcutLabel,
  readEnglishPracticeSettings,
  sanitizeEnglishPracticeSettings,
  writeEnglishPracticeSettings,
} from '@/modules/settings/domain/preferences-entity/model/englishPracticeSettings'

describe('englishPracticeSettings', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('returns defaults when storage is empty', () => {
    expect(readEnglishPracticeSettings()).toEqual(DEFAULT_ENGLISH_PRACTICE_SETTINGS)
  })

  it('defaults to single-sentence playback and makes the mode a shortcut', () => {
    expect(DEFAULT_ENGLISH_PRACTICE_SETTINGS.playback.mode).toBe('single')
    expect(getShortcutLabel(DEFAULT_ENGLISH_PRACTICE_SETTINGS.shortcuts.toggle_playback_mode)).toBe('F3')
  })

  it('defaults clear-and-retype to Home and migrates the old Delete default', () => {
    expect(getShortcutLabel(DEFAULT_ENGLISH_PRACTICE_SETTINGS.shortcuts.reset_sentence)).toBe('Home')
    const sanitized = sanitizeEnglishPracticeSettings({
      ...DEFAULT_ENGLISH_PRACTICE_SETTINGS,
      shortcuts: {
        ...DEFAULT_ENGLISH_PRACTICE_SETTINGS.shortcuts,
        reset_sentence: {
          code: 'Delete',
          key: 'delete',
          shift: false,
          ctrl: false,
          alt: false,
          meta: false,
        },
      },
    })
    expect(sanitized.shortcuts.reset_sentence?.key).toBe('home')
  })

  it('ships the no-modifier dictation shortcut scheme', () => {
    expect(getShortcutLabel(DEFAULT_ENGLISH_PRACTICE_SETTINGS.shortcuts.replay_sentence)).toBe('Space')
    expect(getShortcutLabel(DEFAULT_ENGLISH_PRACTICE_SETTINGS.shortcuts.reveal_letter)).toBe('ArrowUp')
    expect(getShortcutLabel(DEFAULT_ENGLISH_PRACTICE_SETTINGS.shortcuts.toggle_mask)).toBe('`')
    expect(getShortcutLabel(DEFAULT_ENGLISH_PRACTICE_SETTINGS.shortcuts.pause_session)).toBe('Escape')
  })

  it('sanitizes duplicate and invalid shortcut values when saving', () => {
    const saved = writeEnglishPracticeSettings({
      ...DEFAULT_ENGLISH_PRACTICE_SETTINGS,
      shortcuts: {
        ...DEFAULT_ENGLISH_PRACTICE_SETTINGS.shortcuts,
        reveal_letter: { code: 'KeyA', key: 'a', shift: false, ctrl: false, alt: false, meta: false },
        previous_sentence: { code: 'Enter', key: 'enter', shift: false, ctrl: false, alt: false, meta: false },
        next_sentence: { code: 'Enter', key: 'enter', shift: false, ctrl: false, alt: false, meta: false },
      },
      sound: {
        enabled: false,
        masterVolume: 0.5,
      },
    })

    expect(saved.shortcuts.reveal_letter).toBeNull()
    expect(saved.shortcuts.previous_sentence).not.toBeNull()
    expect(saved.shortcuts.next_sentence).toBeNull()
    expect(saved.sound.enabled).toBe(false)
    expect(saved.flow.autoAdvanceOnPass).toBe(false)
    expect(window.localStorage.getItem(ENGLISH_PRACTICE_SETTINGS_STORAGE_KEY)).toBeNull()
  })

  it('migrates v2 modifier shortcuts to the new default scheme', () => {
    const sanitized = sanitizeEnglishPracticeSettings({
      shortcuts: {
        replay_sentence: { code: 'Space', key: 'space', shift: true, ctrl: false, alt: false, meta: false },
        reveal_letter: { code: 'ArrowUp', key: 'arrowup', shift: true, ctrl: false, alt: false, meta: false },
      },
      sound: { enabled: true, masterVolume: 0.4 },
      flow: { autoAdvanceOnPass: true },
      replay: { autoReplayOnPass: true, singleSentenceLoopEnabled: true },
    })

    expect(sanitized.shortcuts.replay_sentence?.shift).toBe(false)
    expect(sanitized.shortcuts.reveal_letter?.shift).toBe(false)
    expect(sanitized.shortcuts.toggle_mask?.key).toBe('`')
    expect(sanitized.playback.mode).toBe('single')
    expect(sanitized.sound.masterVolume).toBe(0.4)
    expect(sanitized.flow.autoAdvanceOnPass).toBe(true)
  })

  it('falls back to the default auto advance preference when the saved value is invalid', () => {
    const sanitized = sanitizeEnglishPracticeSettings({
      ...DEFAULT_ENGLISH_PRACTICE_SETTINGS,
      flow: { autoAdvanceOnPass: 'nope' },
    })

    expect(sanitized.flow.autoAdvanceOnPass).toBe(DEFAULT_ENGLISH_PRACTICE_SETTINGS.flow.autoAdvanceOnPass)
  })

  it('rejects bare typing keys during shortcut capture', () => {
    const event = new KeyboardEvent('keydown', { key: 'a', code: 'KeyA' })
    const captured = captureShortcutFromKeyboardEvent(event)
    expect(captured.value).toBeNull()
    expect(captured.error).toContain('答题输入键')
  })

  it('captures bare navigation and control keys', () => {
    for (const [key, code] of [
      [' ', 'Space'],
      ['ArrowLeft', 'ArrowLeft'],
      ['Enter', 'Enter'],
      ['Delete', 'Delete'],
      ['Escape', 'Escape'],
      ['`', 'Backquote'],
      ['F2', 'F2'],
    ]) {
      const captured = captureShortcutFromKeyboardEvent(new KeyboardEvent('keydown', { key, code }))
      expect(captured.error).toBe('')
      expect(captured.value?.key).toBe(key === ' ' ? 'space' : key.toLowerCase())
      expect(captured.value?.shift).toBe(false)
    }
  })

  it('rejects Tab because it must keep moving focus', () => {
    const captured = captureShortcutFromKeyboardEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab' }))
    expect(captured.value).toBeNull()
    expect(captured.error).toContain('焦点')
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

  it('sanitizes the playback mode and keeps a valid continuous choice', () => {
    expect(sanitizeEnglishPracticeSettings({ ...DEFAULT_ENGLISH_PRACTICE_SETTINGS }).playback.mode).toBe('single')
    expect(
      sanitizeEnglishPracticeSettings({
        ...DEFAULT_ENGLISH_PRACTICE_SETTINGS,
        playback: { mode: 'continuous' },
      }).playback.mode,
    ).toBe('continuous')
    expect(
      sanitizeEnglishPracticeSettings({
        ...DEFAULT_ENGLISH_PRACTICE_SETTINGS,
        playback: { mode: 'loop' },
      }).playback.mode,
    ).toBe('single')
  })

  it('sanitizes stage layout, speed, and mask values', () => {
    const sanitized = sanitizeEnglishPracticeSettings({
      ...DEFAULT_ENGLISH_PRACTICE_SETTINGS,
      stage: {
        layout: 'classic',
        playbackSpeed: 9,
        showFilmstrip: false,
        mask: { enabled: true, blur: 100, opacity: 5 },
      },
    })
    expect(sanitized.stage.layout).toBe('classic')
    expect(sanitized.stage.playbackSpeed).toBe(2)
    expect(sanitized.stage.showFilmstrip).toBe(false)
    expect(sanitized.stage.mask.blur).toBe(40)
    expect(sanitized.stage.mask.opacity).toBe(20)
  })

  it('fills in default masterVolume when it is omitted', () => {
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
