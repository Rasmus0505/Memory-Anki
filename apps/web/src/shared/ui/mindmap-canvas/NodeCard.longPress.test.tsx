import { act, createEvent, fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LONG_PRESS_DELAY_MS } from '@/shared/ui/mindmap-canvas/nodeCardModel'
import { renderNodeCard } from '@/shared/ui/mindmap-canvas/nodeCardTestUtils'

describe('NodeCard long press', () => {
  it('fires a touch long press context action after the delay', async () => {
    vi.useFakeTimers()
    const onTouchLongPress = vi.fn()
    renderNodeCard({
      onTouchLongPress,
    })

    const button = screen.getByRole('button', { name: /第一行/ })
    fireEvent.pointerDown(button, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 48,
      clientY: 72,
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LONG_PRESS_DELAY_MS - 1)
    })
    expect(onTouchLongPress).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(onTouchLongPress).toHaveBeenCalledTimes(1)
    expect(onTouchLongPress.mock.calls[0]?.[0]).toBe('peg-1')
    vi.useRealTimers()
  })

  it('cancels touch long press when the finger lifts early', async () => {
    vi.useFakeTimers()
    const onTouchLongPress = vi.fn()
    renderNodeCard({
      onTouchLongPress,
    })

    const button = screen.getByRole('button', { name: /第一行/ })
    fireEvent.pointerDown(button, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 48,
      clientY: 72,
    })
    fireEvent.pointerUp(button, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 48,
      clientY: 72,
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LONG_PRESS_DELAY_MS + 50)
    })
    expect(onTouchLongPress).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('swallows the next click after a touch long press fires', async () => {
    vi.useFakeTimers()
    const onTouchLongPress = vi.fn()
    const wrapperOnClick = vi.fn()
    renderNodeCard(
      {
        onTouchLongPress,
      },
      wrapperOnClick,
    )

    const button = screen.getByRole('button', { name: /第一行/ })
    fireEvent.pointerDown(button, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 48,
      clientY: 72,
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LONG_PRESS_DELAY_MS)
    })

    fireEvent.pointerUp(button, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 48,
      clientY: 72,
    })
    fireEvent.click(button)

    expect(onTouchLongPress).toHaveBeenCalledTimes(1)
    expect(wrapperOnClick).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('fires long press in editable (non-readonly) edit mode for PWA right-click parity', async () => {
    vi.useFakeTimers()
    const onTouchLongPress = vi.fn()
    renderNodeCard({
      readonly: false,
      onTouchLongPress,
    })

    const button = screen.getByRole('button', { name: /第一行/ })
    fireEvent.pointerDown(button, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 48,
      clientY: 72,
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LONG_PRESS_DELAY_MS)
    })

    expect(onTouchLongPress).toHaveBeenCalledTimes(1)
    expect(onTouchLongPress.mock.calls[0]?.[0]).toBe('peg-1')
    // Point object is always passed (coords come from the pointer event when available).
    expect(onTouchLongPress.mock.calls[0]?.[1]).toMatchObject({})
    vi.useRealTimers()
  })

  it('does not start long press while the node is mid text-edit', async () => {
    vi.useFakeTimers()
    const onTouchLongPress = vi.fn()
    renderNodeCard({
      readonly: false,
      editing: true,
      editText: '编辑中',
      onTouchLongPress,
    })

    const shell = document.querySelector('[data-mindmap-node-id="peg-1"]') as HTMLElement
    fireEvent.pointerDown(shell, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 48,
      clientY: 72,
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LONG_PRESS_DELAY_MS + 50)
    })

    expect(onTouchLongPress).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('lets a desktop context menu from the text button bubble to the node wrapper', () => {
    const wrapperOnContextMenu = vi.fn()
    renderNodeCard(
      {
        onTouchLongPress: vi.fn(),
      },
      undefined,
      wrapperOnContextMenu,
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: /第一行/ }))

    expect(wrapperOnContextMenu).toHaveBeenCalledTimes(1)
  })

  it('suppresses only the synthetic context menu emitted after touch long press', async () => {
    vi.useFakeTimers()
    const onTouchLongPress = vi.fn()
    const wrapperOnContextMenu = vi.fn()
    renderNodeCard(
      {
        onTouchLongPress,
      },
      undefined,
      wrapperOnContextMenu,
    )

    const button = screen.getByRole('button', { name: /第一行/ })
    fireEvent.pointerDown(button, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 48,
      clientY: 72,
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LONG_PRESS_DELAY_MS)
    })
    const syntheticTouchContextMenu = createEvent.contextMenu(button)
    Object.defineProperty(syntheticTouchContextMenu, 'sourceCapabilities', {
      value: { firesTouchEvents: true },
    })
    fireEvent(button, syntheticTouchContextMenu)

    expect(onTouchLongPress).toHaveBeenCalledTimes(1)
    expect(wrapperOnContextMenu).not.toHaveBeenCalled()

    const mouseContextMenu = createEvent.contextMenu(button)
    Object.defineProperty(mouseContextMenu, 'pointerType', { value: 'mouse' })
    fireEvent(button, mouseContextMenu)

    expect(wrapperOnContextMenu).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('stops suppressing context menus after the touch synthesis window expires', async () => {
    vi.useFakeTimers()
    const wrapperOnContextMenu = vi.fn()
    renderNodeCard(
      {
        onTouchLongPress: vi.fn(),
      },
      undefined,
      wrapperOnContextMenu,
    )

    const button = screen.getByRole('button', { name: /第一行/ })
    fireEvent.pointerDown(button, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 48,
      clientY: 72,
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LONG_PRESS_DELAY_MS + 1_001)
    })
    fireEvent.contextMenu(button)

    expect(wrapperOnContextMenu).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
