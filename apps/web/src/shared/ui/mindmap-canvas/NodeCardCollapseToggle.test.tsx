import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COLLAPSE_DOUBLE_TAP_MS,
  NodeCardCollapseToggle,
} from './NodeCardCollapseToggle'

/**
 * jsdom has no PointerEvent, so `fireEvent.pointerDown` drops `pointerType`.
 * Dispatch a bubbling Event carrying the field the component reads.
 */
function touchPointerDown(element: HTMLElement) {
  const event = new Event('pointerdown', { bubbles: true })
  Object.defineProperty(event, 'pointerType', { value: 'touch' })
  act(() => {
    element.dispatchEvent(event)
  })
}

function renderToggle(overrides: {
  collapsed?: boolean
  onExpandSubtree?: (nodeId: string) => void
} = {}) {
  const onToggleCollapse = vi.fn()
  const onExpandSubtree = overrides.onExpandSubtree ?? vi.fn()
  render(
    <NodeCardCollapseToggle
      nodeId="node-1"
      collapsed={overrides.collapsed ?? true}
      descendantCount={3}
      onToggleCollapse={onToggleCollapse}
      onExpandSubtree={onExpandSubtree}
    />,
  )
  return {
    button: screen.getByRole('button'),
    onToggleCollapse,
    onExpandSubtree,
  }
}

describe('NodeCardCollapseToggle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('expands the whole subtree on a touch double tap', () => {
    const { button, onToggleCollapse, onExpandSubtree } = renderToggle()

    touchPointerDown(button)
    act(() => {
      vi.advanceTimersByTime(120)
    })
    touchPointerDown(button)

    expect(onExpandSubtree).toHaveBeenCalledWith('node-1')
    expect(onToggleCollapse).not.toHaveBeenCalled()

    // The click pair the browser still delivers for that gesture must not fold
    // the branch back one level.
    fireEvent.click(button, { detail: 1 })
    fireEvent.click(button, { detail: 2 })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(onToggleCollapse).not.toHaveBeenCalled()
    expect(onExpandSubtree).toHaveBeenCalledTimes(1)
  })

  it('treats a tap slower than the window as its own single fold', () => {
    const { button, onToggleCollapse, onExpandSubtree } = renderToggle()

    touchPointerDown(button)
    act(() => {
      vi.advanceTimersByTime(COLLAPSE_DOUBLE_TAP_MS + 80)
    })
    touchPointerDown(button)

    expect(onExpandSubtree).not.toHaveBeenCalled()
    expect(onToggleCollapse).not.toHaveBeenCalled()

    fireEvent.click(button, { detail: 1 })
    expect(onToggleCollapse).toHaveBeenCalledTimes(1)
  })

  it('folds one level on a single touch tap without waiting for the mouse window', () => {
    const { button, onToggleCollapse, onExpandSubtree } = renderToggle()

    touchPointerDown(button)
    fireEvent.click(button, { detail: 1 })

    expect(onToggleCollapse).toHaveBeenCalledWith('node-1')
    expect(onExpandSubtree).not.toHaveBeenCalled()
  })

  it('expands the subtree from the second click of a mouse double click', () => {
    const { button, onToggleCollapse, onExpandSubtree } = renderToggle()

    fireEvent.pointerDown(button, { pointerId: 1, pointerType: 'mouse' })
    fireEvent.click(button, { detail: 1 })
    fireEvent.click(button, { detail: 2 })

    expect(onExpandSubtree).toHaveBeenCalledWith('node-1')
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(onToggleCollapse).not.toHaveBeenCalled()
  })

  it('folds one level on a single mouse click after the double-click window', () => {
    const { button, onToggleCollapse, onExpandSubtree } = renderToggle()

    fireEvent.pointerDown(button, { pointerId: 1, pointerType: 'mouse' })
    fireEvent.click(button, { detail: 1 })
    expect(onToggleCollapse).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(260)
    })

    expect(onToggleCollapse).toHaveBeenCalledWith('node-1')
    expect(onExpandSubtree).not.toHaveBeenCalled()
  })
})
