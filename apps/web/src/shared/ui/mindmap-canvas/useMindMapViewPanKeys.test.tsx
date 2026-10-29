import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MINDMAP_KEYBOARD_PAN_MAX_FRAME_MS,
  MINDMAP_KEYBOARD_PAN_SPEED_PX_PER_SEC,
  resolveMindMapKeyboardPanDelta,
  useMindMapViewPanKeys,
} from './useMindMapViewPanKeys'

describe('resolveMindMapKeyboardPanDelta', () => {
  it('moves the camera in the key direction, not the content', () => {
    const frameMs = 20
    expect(resolveMindMapKeyboardPanDelta(['KeyW'], frameMs)).toEqual({
      x: 0,
      y: (MINDMAP_KEYBOARD_PAN_SPEED_PX_PER_SEC * frameMs) / 1000,
    })
    expect(resolveMindMapKeyboardPanDelta(['KeyS'], frameMs).y).toBeLessThan(0)
    expect(resolveMindMapKeyboardPanDelta(['KeyA'], frameMs).x).toBeGreaterThan(0)
    expect(resolveMindMapKeyboardPanDelta(['KeyD'], frameMs).x).toBeLessThan(0)
  })

  it('cancels opposing keys and ignores unrelated codes', () => {
    expect(resolveMindMapKeyboardPanDelta(['KeyW', 'KeyS'], 100)).toEqual({ x: 0, y: 0 })
    expect(resolveMindMapKeyboardPanDelta(['KeyQ'], 100)).toEqual({ x: 0, y: 0 })
    expect(resolveMindMapKeyboardPanDelta([], 100)).toEqual({ x: 0, y: 0 })
  })

  it('diagonals move both axes at full speed each', () => {
    const delta = resolveMindMapKeyboardPanDelta(['KeyW', 'KeyA'], 100)
    expect(delta.x).toBeGreaterThan(0)
    expect(delta.y).toBeGreaterThan(0)
  })

  it('never teleports the camera after a stalled frame', () => {
    const stalled = resolveMindMapKeyboardPanDelta(['KeyW'], 10_000)
    const capped = resolveMindMapKeyboardPanDelta(['KeyW'], MINDMAP_KEYBOARD_PAN_MAX_FRAME_MS)
    expect(stalled).toEqual(capped)
  })
})

describe('useMindMapViewPanKeys', () => {
  let frames: FrameRequestCallback[] = []
  let clock = 1_000

  beforeEach(() => {
    frames = []
    clock = 1_000
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  function flushFrame(elapsedMs: number) {
    clock += elapsedMs
    const pending = frames
    frames = []
    act(() => {
      pending.forEach((callback) => callback(clock))
    })
  }

  function pressKey(init: KeyboardEventInit) {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    act(() => {
      window.dispatchEvent(event)
    })
    return event
  }

  function releaseKey(init: KeyboardEventInit) {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, ...init }))
    })
  }

  it('pans on hold and stops on release', () => {
    const panBy = vi.fn()
    const endPan = vi.fn()
    renderHook(() => useMindMapViewPanKeys({ enabled: true, panBy, endPan }))

    const down = pressKey({ key: 'w', code: 'KeyW' })
    expect(down.defaultPrevented).toBe(true)
    expect(panBy).not.toHaveBeenCalled()

    flushFrame(16)
    expect(panBy).toHaveBeenCalledTimes(1)
    const [dx, dy] = panBy.mock.calls[0]
    expect(dx).toBe(0)
    expect(dy).toBeCloseTo((MINDMAP_KEYBOARD_PAN_SPEED_PX_PER_SEC * 16) / 1000, 5)

    releaseKey({ key: 'w', code: 'KeyW' })
    expect(endPan).toHaveBeenCalledTimes(1)
    flushFrame(16)
    expect(panBy).toHaveBeenCalledTimes(1)
  })

  it('does not restart the loop on OS auto-repeat keydowns', () => {
    const panBy = vi.fn()
    renderHook(() => useMindMapViewPanKeys({ enabled: true, panBy, endPan: vi.fn() }))

    pressKey({ key: 'd', code: 'KeyD' })
    pressKey({ key: 'd', code: 'KeyD' })
    expect(frames).toHaveLength(1)

    flushFrame(16)
    expect(panBy).toHaveBeenCalledTimes(1)
    flushFrame(16)
    expect(panBy).toHaveBeenCalledTimes(2)
  })

  it('stays quiet while disabled, while typing, or while a dialog owns the keys', () => {
    const panBy = vi.fn()
    const { unmount } = renderHook(() =>
      useMindMapViewPanKeys({ enabled: false, panBy, endPan: vi.fn() }),
    )
    expect(pressKey({ key: 'w', code: 'KeyW' }).defaultPrevented).toBe(false)
    flushFrame(16)
    expect(panBy).not.toHaveBeenCalled()
    unmount()

    renderHook(() => useMindMapViewPanKeys({ enabled: true, panBy, endPan: vi.fn() }))

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', bubbles: true, cancelable: true }),
    )
    flushFrame(16)
    expect(panBy).not.toHaveBeenCalled()

    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)
    expect(pressKey({ key: 'w', code: 'KeyW' }).defaultPrevented).toBe(false)
    flushFrame(16)
    expect(panBy).not.toHaveBeenCalled()
  })

  it('leaves modifier chords to the browser and to other tools', () => {
    const panBy = vi.fn()
    renderHook(() => useMindMapViewPanKeys({ enabled: true, panBy, endPan: vi.fn() }))

    const event = pressKey({ key: 's', code: 'KeyS', ctrlKey: true })
    expect(event.defaultPrevented).toBe(false)
    flushFrame(16)
    expect(panBy).not.toHaveBeenCalled()
  })
})
