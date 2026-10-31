import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearMicroBubbles, showMicroBubble } from './microBubble'

function makeAnchor(): HTMLButtonElement {
  const anchor = document.createElement('button')
  anchor.textContent = '记得'
  anchor.getBoundingClientRect = () =>
    ({
      x: 100,
      y: 200,
      top: 200,
      left: 100,
      right: 180,
      bottom: 240,
      width: 80,
      height: 40,
      toJSON: () => ({}),
    }) as DOMRect
  document.body.appendChild(anchor)
  return anchor
}

describe('showMicroBubble', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    document.body.replaceChildren()
  })

  afterEach(() => {
    clearMicroBubbles()
    vi.useRealTimers()
  })

  it('mounts on the body-level top layer, not inside the anchor stacking context', () => {
    const anchor = makeAnchor()

    const bubble = showMicroBubble(anchor, {
      tone: 'good',
      parts: [{ text: '1.6s', strong: true }],
    })

    expect(bubble).not.toBeNull()
    const layer = document.querySelector('.ma-micro-bubble-layer')
    expect(layer?.parentElement).toBe(document.body)
    expect(layer?.contains(bubble!)).toBe(true)
    expect(anchor.contains(bubble!)).toBe(false)
    expect(bubble?.className).toContain('ma-micro-bubble--good')
    expect(bubble?.textContent).toBe('1.6s')
  })

  it('retires the previous bubble in the same zone', () => {
    const anchor = makeAnchor()

    const first = showMicroBubble(anchor, { zone: 'rating', parts: [{ text: '4d → 11d' }] })
    const second = showMicroBubble(anchor, { zone: 'rating', parts: [{ text: '11d → 30d' }] })

    expect(first?.classList.contains('is-retiring')).toBe(true)
    expect(second?.classList.contains('is-retiring')).toBe(false)
  })

  it('does not spawn for an anchor that is not laid out', () => {
    const anchor = document.createElement('button')
    anchor.getBoundingClientRect = () =>
      ({ width: 0, height: 0 }) as DOMRect
    document.body.appendChild(anchor)

    expect(showMicroBubble(anchor, { parts: [{ text: '0s' }] })).toBeNull()
  })

  it('removes a pill even when animationend never fires', () => {
    const anchor = makeAnchor()

    showMicroBubble(anchor, { parts: [{ text: '1.6s' }], duration: 1050 })
    expect(document.querySelector('.ma-micro-bubble')).not.toBeNull()

    vi.advanceTimersByTime(1700)
    expect(document.querySelector('.ma-micro-bubble')).toBeNull()
  })
})
