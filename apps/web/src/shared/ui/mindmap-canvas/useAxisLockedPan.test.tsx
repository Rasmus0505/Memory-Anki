import { render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveAxisLock, useAxisLockedPan } from './useAxisLockedPan'

describe('resolveAxisLock', () => {
  it('stays pending inside the slop', () => {
    expect(resolveAxisLock(3, 4)).toBe('pending')
  })

  it('locks clear vertical swipes to the page', () => {
    expect(resolveAxisLock(2, 30)).toBe('page')
  })

  it('locks horizontal and diagonal swipes to the map', () => {
    expect(resolveAxisLock(30, 2)).toBe('map')
    expect(resolveAxisLock(20, 20)).toBe('map')
  })
})

function touchEvent(type: string, points: Array<[number, number]>) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent
  const touches = points.map(([clientX, clientY]) => ({ clientX, clientY }))
  Object.defineProperty(event, 'touches', { value: touches })
  return event
}

function Harness({ onPan, onPanEnd }: { onPan: (dx: number, dy: number) => void; onPanEnd: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useAxisLockedPan(ref, { enabled: true, nodesDraggable: false, onPan, onPanEnd })
  return <div ref={ref} data-testid="frame" />
}

describe('useAxisLockedPan', () => {
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('pans the map on a horizontal swipe and swallows the trailing click', () => {
    const onPan = vi.fn()
    const onPanEnd = vi.fn()
    const { getByTestId } = render(<Harness onPan={onPan} onPanEnd={onPanEnd} />)
    const frame = getByTestId('frame')

    frame.dispatchEvent(touchEvent('touchstart', [[100, 100]]))
    const move = touchEvent('touchmove', [[130, 104]])
    frame.dispatchEvent(move)
    frame.dispatchEvent(touchEvent('touchend', []))

    expect(move.defaultPrevented).toBe(true)
    expect(onPan).toHaveBeenCalledWith(30, 4)
    expect(onPanEnd).toHaveBeenCalledTimes(1)

    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    frame.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
  })

  it('leaves vertical swipes to the parent scroller', () => {
    const onPan = vi.fn()
    const { getByTestId } = render(<Harness onPan={onPan} onPanEnd={vi.fn()} />)
    const frame = getByTestId('frame')

    frame.dispatchEvent(touchEvent('touchstart', [[100, 100]]))
    const move = touchEvent('touchmove', [[102, 140]])
    frame.dispatchEvent(move)

    expect(move.defaultPrevented).toBe(false)
    expect(onPan).not.toHaveBeenCalled()
  })

  it('yields to pinch when a second finger lands', () => {
    const onPan = vi.fn()
    const { getByTestId } = render(<Harness onPan={onPan} onPanEnd={vi.fn()} />)
    const frame = getByTestId('frame')

    frame.dispatchEvent(touchEvent('touchstart', [[100, 100]]))
    const pinch = touchEvent('touchmove', [[130, 100], [200, 200]])
    frame.dispatchEvent(pinch)

    expect(pinch.defaultPrevented).toBe(false)
    expect(onPan).not.toHaveBeenCalled()
  })
})
