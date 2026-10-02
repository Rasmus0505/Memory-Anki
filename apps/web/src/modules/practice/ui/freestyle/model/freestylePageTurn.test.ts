import { afterEach, describe, expect, it, vi } from 'vitest'
import { animateScrollTop, easeOutQuart } from './freestyleAnimatedScroll'
import { createFreestyleScrollChannel, scrollFrameFromPosition } from './freestyleScrollChannel'
import { rubberBand } from '../hooks/useFreestyleEdgeRubberBand'
import { pageTurnAttenuation } from '../hooks/useFreestyleFlowFeedback'

describe('freestyle page turn model', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('maps a fractional scroll position onto the leaving and entering card', () => {
    const ids = ['a', 'b', 'c']
    expect(scrollFrameFromPosition(0, ids, true)).toEqual({ fromCardId: 'a', toCardId: null, t: 0, settled: true })
    expect(scrollFrameFromPosition(1.25, ids, false)).toEqual({ fromCardId: 'b', toCardId: 'c', t: 0.25, settled: false })
    // Scrolling into the closing slot has no entering card id.
    expect(scrollFrameFromPosition(2.5, ids, false)).toMatchObject({ fromCardId: 'c', toCardId: null, t: 0 })
    expect(scrollFrameFromPosition(3, ids, true)).toMatchObject({ fromCardId: null, toCardId: null })
  })

  it('scopes scroll frames to one channel instance', () => {
    const first = createFreestyleScrollChannel()
    const second = createFreestyleScrollChannel()
    const seen = vi.fn()
    const unsubscribe = first.subscribe(seen)
    first.publish({ fromCardId: 'a', toCardId: 'b', t: 0.5, settled: false })
    second.publish({ fromCardId: 'x', toCardId: null, t: 0, settled: true })
    expect(seen).toHaveBeenCalledTimes(1)
    expect(first.read()?.fromCardId).toBe('a')
    unsubscribe()
    first.publish({ fromCardId: 'b', toCardId: null, t: 0, settled: true })
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('damps overscroll so it approaches but never exceeds the limit', () => {
    expect(rubberBand(0)).toBe(0)
    expect(rubberBand(60)).toBeGreaterThan(0)
    expect(rubberBand(60)).toBeLessThan(60)
    expect(rubberBand(-60)).toBeCloseTo(-rubberBand(60))
    expect(rubberBand(10_000)).toBeLessThan(120)
    expect(rubberBand(400)).toBeGreaterThan(rubberBand(200))
  })

  it('eases paging with a fast departure and a soft landing', () => {
    expect(easeOutQuart(0)).toBe(0)
    expect(easeOutQuart(1)).toBe(1)
    expect(easeOutQuart(0.25)).toBeGreaterThan(0.6)
  })

  it('thins page-turn sound during a fast flick-through', () => {
    expect(pageTurnAttenuation(110)).toBeCloseTo(0.45)
    expect(pageTurnAttenuation(265)).toBeGreaterThan(0.45)
    expect(pageTurnAttenuation(265)).toBeLessThan(1)
    expect(pageTurnAttenuation(2000)).toBe(1)
  })

  it('suspends scroll snap during an animated page and lands exactly on target', () => {
    let now = 0
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
    const node = document.createElement('div')
    node.style.scrollSnapType = 'y mandatory'
    const onFinish = vi.fn()
    animateScrollTop(node, 800, { durationMs: 380, onFinish })
    expect(node.style.scrollSnapType).toBe('none')
    while (frames.length) {
      const frame = frames.shift()!
      frame(now)
      now += 16
    }
    expect(onFinish).toHaveBeenCalledWith(true)
    expect(node.scrollTop).toBe(800)
    expect(node.style.scrollSnapType).toBe('y mandatory')
  })

  it('hands control back immediately when the finger interrupts the flight', () => {
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
    const node = document.createElement('div')
    const onFinish = vi.fn()
    animateScrollTop(node, 800, { onFinish })
    node.dispatchEvent(new Event('touchstart'))
    expect(onFinish).toHaveBeenCalledWith(false)
    expect(node.style.scrollSnapType).toBe('')
  })
})
