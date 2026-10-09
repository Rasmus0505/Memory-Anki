import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  armCardEditPress,
  isCardEditControlTarget,
  pointInsideCardRect,
  registerCardEditCompleter,
  resetCardEditGestureState,
} from './cardEditGesture'

describe('cardEditGesture', () => {
  afterEach(() => {
    resetCardEditGestureState()
  })

  it('treats fold controls, badges, and toolbars as not the edit surface', () => {
    document.body.innerHTML = `
      <button data-mindmap-collapse-toggle="true"><span id="fold">fold</span></button>
      <button data-quiz-count-badge="count"><span id="badge">3</span></button>
      <button data-mindmap-card-control="true" id="tool">tool</button>
      <span id="text">yellow</span>
    `
    expect(isCardEditControlTarget(document.getElementById('fold'))).toBe(true)
    expect(isCardEditControlTarget(document.getElementById('badge'))).toBe(true)
    expect(isCardEditControlTarget(document.getElementById('tool'))).toBe(true)
    expect(isCardEditControlTarget(document.getElementById('text'))).toBe(false)
  })

  it('completes a second press that missed the card but stayed inside its box', () => {
    const done = vi.fn()
    const unregister = registerCardEditCompleter('peg-1', done)
    armCardEditPress('peg-1', { left: 10, top: 20, right: 120, bottom: 80 })

    const missed = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 40,
      clientY: 50,
    })
    window.dispatchEvent(missed)

    expect(done).toHaveBeenCalledWith({ x: 40, y: 50 })
    expect(missed.defaultPrevented).toBe(true)
    expect(pointInsideCardRect(4, 20, { left: 10, top: 20, right: 120, bottom: 80 })).toBe(false)
    unregister()
  })

  it('does not steal a press that already hit the card', () => {
    document.body.innerHTML = '<div data-mindmap-node-id="peg-1" id="card">text</div>'
    const done = vi.fn()
    const unregister = registerCardEditCompleter('peg-1', done)
    armCardEditPress('peg-1', { left: 0, top: 0, right: 100, bottom: 40 })

    document.getElementById('card')?.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 8,
      clientY: 8,
    }))

    expect(done).not.toHaveBeenCalled()
    unregister()
  })
})
