import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PANE_DOUBLE_CLICK_WINDOW_MS,
  createPaneModeGestureMachine,
  isMindMapPaneTarget,
} from './paneModeGestures'
import { LONG_PRESS_DELAY_MS } from './nodeCardModel'

function makePane(className: string, parent?: HTMLElement) {
  const element = document.createElement('div')
  element.className = className
  ;(parent ?? document.body).append(element)
  return element
}

describe('isMindMapPaneTarget', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('accepts the React Flow pane and background', () => {
    const pane = makePane('react-flow__pane')
    const background = makePane('react-flow__background', pane)
    expect(isMindMapPaneTarget(pane)).toBe(true)
    expect(isMindMapPaneTarget(background)).toBe(true)
  })

  it('rejects nodes, edges, and controls even when they sit on the pane', () => {
    const pane = makePane('react-flow__pane')
    const node = makePane('react-flow__node', pane)
    const edge = makePane('react-flow__edge', pane)
    const controls = makePane('react-flow__controls', pane)
    expect(isMindMapPaneTarget(node)).toBe(false)
    expect(isMindMapPaneTarget(edge)).toBe(false)
    expect(isMindMapPaneTarget(controls)).toBe(false)
  })
})

describe('createPaneModeGestureMachine', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires double-click for two pane taps inside the window', () => {
    const onDoubleClick = vi.fn()
    const machine = createPaneModeGestureMachine({
      getOnDoubleClick: () => onDoubleClick,
    })
    machine.pointerDown({ pointerId: 1, x: 10, y: 10, isPrimary: true, isPane: true })
    machine.pointerUp({ pointerId: 1, x: 10, y: 10, isPane: true })
    machine.pointerDown({ pointerId: 1, x: 12, y: 11, isPrimary: true, isPane: true })
    machine.pointerUp({ pointerId: 1, x: 12, y: 11, isPane: true })
    expect(onDoubleClick).toHaveBeenCalledTimes(1)
    machine.dispose()
  })

  it('does not treat a node tap as the second click', () => {
    const onDoubleClick = vi.fn()
    const machine = createPaneModeGestureMachine({
      getOnDoubleClick: () => onDoubleClick,
    })
    machine.pointerDown({ pointerId: 1, x: 10, y: 10, isPrimary: true, isPane: true })
    machine.pointerUp({ pointerId: 1, x: 10, y: 10, isPane: true })
    machine.pointerDown({ pointerId: 1, x: 10, y: 10, isPrimary: true, isPane: false })
    machine.pointerUp({ pointerId: 1, x: 10, y: 10, isPane: false })
    expect(onDoubleClick).not.toHaveBeenCalled()
    machine.dispose()
  })

  it('ignores a second tap that moved too far', () => {
    const onDoubleClick = vi.fn()
    const machine = createPaneModeGestureMachine({
      getOnDoubleClick: () => onDoubleClick,
    })
    machine.pointerDown({ pointerId: 1, x: 10, y: 10, isPrimary: true, isPane: true })
    machine.pointerUp({ pointerId: 1, x: 10, y: 10, isPane: true })
    machine.pointerDown({ pointerId: 1, x: 80, y: 80, isPrimary: true, isPane: true })
    machine.pointerUp({ pointerId: 1, x: 80, y: 80, isPane: true })
    expect(onDoubleClick).not.toHaveBeenCalled()
    machine.dispose()
  })

  it('fires long-press after 550ms on a still pane hold', () => {
    vi.useFakeTimers()
    const onLongPress = vi.fn()
    const machine = createPaneModeGestureMachine({
      getOnLongPress: () => onLongPress,
    })
    machine.pointerDown({ pointerId: 1, x: 20, y: 20, isPrimary: true, isPane: true })
    vi.advanceTimersByTime(LONG_PRESS_DELAY_MS - 1)
    expect(onLongPress).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onLongPress).toHaveBeenCalledTimes(1)
    machine.dispose()
  })

  it('cancels long-press when the pointer moves beyond the tolerance', () => {
    vi.useFakeTimers()
    const onLongPress = vi.fn()
    const machine = createPaneModeGestureMachine({
      getOnLongPress: () => onLongPress,
    })
    machine.pointerDown({ pointerId: 1, x: 20, y: 20, isPrimary: true, isPane: true })
    machine.pointerMove({ pointerId: 1, x: 20, y: 50 })
    vi.advanceTimersByTime(LONG_PRESS_DELAY_MS)
    expect(onLongPress).not.toHaveBeenCalled()
    machine.dispose()
  })

  it('does not fire double-click after a moved hold', () => {
    const onDoubleClick = vi.fn()
    const machine = createPaneModeGestureMachine({
      getOnDoubleClick: () => onDoubleClick,
    })
    machine.pointerDown({ pointerId: 1, x: 10, y: 10, isPrimary: true, isPane: true })
    machine.pointerMove({ pointerId: 1, x: 40, y: 10 })
    machine.pointerUp({ pointerId: 1, x: 40, y: 10, isPane: true })
    machine.pointerDown({ pointerId: 1, x: 40, y: 10, isPrimary: true, isPane: true })
    machine.pointerUp({ pointerId: 1, x: 40, y: 10, isPane: true })
    expect(onDoubleClick).not.toHaveBeenCalled()
    machine.dispose()
  })

  it('does not fire double-click after a long-press', () => {
    vi.useFakeTimers()
    const onDoubleClick = vi.fn()
    const onLongPress = vi.fn()
    const machine = createPaneModeGestureMachine({
      getOnDoubleClick: () => onDoubleClick,
      getOnLongPress: () => onLongPress,
    })
    machine.pointerDown({ pointerId: 1, x: 20, y: 20, isPrimary: true, isPane: true })
    vi.advanceTimersByTime(LONG_PRESS_DELAY_MS)
    machine.pointerUp({ pointerId: 1, x: 20, y: 20, isPane: true })
    machine.pointerDown({ pointerId: 1, x: 20, y: 20, isPrimary: true, isPane: true })
    machine.pointerUp({ pointerId: 1, x: 20, y: 20, isPane: true })
    expect(onLongPress).toHaveBeenCalledTimes(1)
    expect(onDoubleClick).not.toHaveBeenCalled()
    machine.dispose()
  })

  it('does not count a tap after the double-click window', () => {
    let now = 1_000
    const onDoubleClick = vi.fn()
    const machine = createPaneModeGestureMachine({
      getOnDoubleClick: () => onDoubleClick,
      now: () => now,
    })
    machine.pointerDown({ pointerId: 1, x: 10, y: 10, isPrimary: true, isPane: true })
    machine.pointerUp({ pointerId: 1, x: 10, y: 10, isPane: true })
    now += PANE_DOUBLE_CLICK_WINDOW_MS + 1
    machine.pointerDown({ pointerId: 1, x: 10, y: 10, isPrimary: true, isPane: true })
    machine.pointerUp({ pointerId: 1, x: 10, y: 10, isPane: true })
    expect(onDoubleClick).not.toHaveBeenCalled()
    machine.dispose()
  })
})
