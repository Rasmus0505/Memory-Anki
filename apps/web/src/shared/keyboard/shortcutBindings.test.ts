import { beforeEach, describe, expect, it } from 'vitest'
import {
  captureShortcutFromKeyboardEvent,
  getShortcutLabel,
  getShortcutSignature,
  isShortcutPressed,
  normalizeShortcutBindingValue,
} from '@/shared/keyboard/shortcutBindings'

describe('shortcutBindings', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('normalizes spacebar-style values and infers codes', () => {
    expect(
      normalizeShortcutBindingValue({
        key: 'Spacebar',
        shift: true,
      }),
    ).toEqual({
      code: 'Space',
      key: 'space',
      shift: true,
      ctrl: false,
      alt: false,
      meta: false,
    })
  })

  it('formats labels from key codes', () => {
    expect(getShortcutLabel({ code: 'KeyA', key: 'a', shift: false, ctrl: false, alt: false, meta: false })).toBe(
      'A',
    )
    expect(getShortcutLabel({ code: 'Digit1', key: '1', shift: false, ctrl: false, alt: false, meta: false })).toBe(
      '1',
    )
    expect(getShortcutLabel({ code: 'F1', key: 'F1', shift: false, ctrl: false, alt: false, meta: false })).toBe(
      'F1',
    )
  })

  it('builds stable signatures with modifiers in canonical order', () => {
    expect(
      getShortcutSignature({
        code: 'KeyA',
        key: 'a',
        shift: true,
        ctrl: true,
        alt: true,
        meta: true,
      }),
    ).toBe('ctrl+alt+shift+meta+KeyA')
  })

  it('allows bare letter keys and rejects reserved keys during capture', () => {
    const typed = captureShortcutFromKeyboardEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA' }))
    expect(typed.error).toBe('')
    expect(typed.value).toEqual({
      code: 'KeyA',
      key: 'a',
      shift: false,
      ctrl: false,
      alt: false,
      meta: false,
    })

    const digit = captureShortcutFromKeyboardEvent(new KeyboardEvent('keydown', { key: '1', code: 'Digit1' }))
    expect(digit.value).toBeNull()
    expect(digit.error).toContain('输入冲突')

    const escaped = captureShortcutFromKeyboardEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }))
    expect(escaped.value).toBeNull()
    expect(escaped.error).toContain('Esc')
  })

  it('captures valid shortcuts and matches modifier state precisely', () => {
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
    expect(isShortcutPressed(event, captured.value)).toBe(true)
    expect(isShortcutPressed(new KeyboardEvent('keydown', { key: ' ', code: 'Space' }), captured.value)).toBe(false)
  })
})
