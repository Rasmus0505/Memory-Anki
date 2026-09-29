import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openPlayback, pendingPlaybackCount, retireOwner } from './owner'

const gate = vi.hoisted(() => ({ motion: true, sound: true, haptic: true, volume: 1 }))
vi.mock('./policy', () => ({ resolveFxGate: () => ({ ...gate }) }))

import { __clearCuesForTests, cue, defineCue, listCues, onCue, replayCue } from './director'

declare module './director' {
  interface FxCueMap {
    'test.cue': { value: number }
  }
}

describe('fx owner playback', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('runs scheduled steps while the owner is alive', () => {
    const step = vi.fn()
    openPlayback('card:a').at(100, step)
    vi.advanceTimersByTime(100)
    expect(step).toHaveBeenCalledTimes(1)
    expect(pendingPlaybackCount('card:a')).toBe(0)
  })

  it('retiring an owner cancels pending steps and runs teardown', () => {
    const step = vi.fn()
    const teardown = vi.fn()
    const playback = openPlayback('card:b')
    playback.at(200, step)
    playback.onCancel(teardown)
    retireOwner('card:b')
    vi.advanceTimersByTime(500)
    expect(step).not.toHaveBeenCalled()
    expect(teardown).toHaveBeenCalledTimes(1)
    expect(playback.alive()).toBe(false)
  })

  it('a stale playback stays dead after the owner comes back', () => {
    const stale = openPlayback('card:c')
    retireOwner('card:c')
    const fresh = openPlayback('card:c')
    const step = vi.fn()
    stale.at(10, step)
    fresh.at(10, step)
    vi.advanceTimersByTime(10)
    expect(step).toHaveBeenCalledTimes(1)
  })
})

describe('fx director', () => {
  const play = vi.fn()
  beforeEach(() => {
    __clearCuesForTests()
    Object.assign(gate, { motion: true, sound: true, haptic: true })
    play.mockReset()
    defineCue('test.cue', { scene: 'review', label: '测试', group: 'T', sample: () => ({ value: 7 }), play })
  })

  it('hands the payload and resolved gate to the recipe', () => {
    cue('test.cue', { value: 1 })
    expect(play).toHaveBeenCalledWith({ value: 1 }, expect.objectContaining({ gate: expect.objectContaining({ motion: true }), forced: false }))
  })

  it('skips the recipe when every channel is off, but still notifies listeners', () => {
    Object.assign(gate, { motion: false, sound: false, haptic: false })
    const listener = vi.fn()
    const off = onCue(listener)
    expect(cue('test.cue', { value: 2 })).toBeNull()
    expect(play).not.toHaveBeenCalled()
    expect(listener).toHaveBeenCalledWith('test.cue', { value: 2 })
    off()
  })

  it('replays with the sample payload on every channel', () => {
    Object.assign(gate, { motion: false, sound: false, haptic: false })
    replayCue('test.cue')
    expect(play).toHaveBeenCalledWith({ value: 7 }, expect.objectContaining({ forced: true, gate: expect.objectContaining({ motion: true, sound: true }) }))
  })

  it('lists registered cues for the lab', () => {
    expect(listCues()).toEqual([expect.objectContaining({ name: 'test.cue', label: '测试', hasSample: true })])
  })
})
