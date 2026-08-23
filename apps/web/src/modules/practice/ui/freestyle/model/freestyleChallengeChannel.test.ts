import { describe, expect, it } from 'vitest'
import { DEFAULT_FREESTYLE_FEED_CONFIG } from '@/modules/practice/public'
import {
  CHANNEL_MIN_SAMPLES,
  EMPTY_CHANNEL_LOG,
  channelAdjustment,
  channelLogSamples,
  freestylePalaceScopeUnchanged,
  readChallengeChannel,
  recordChannelRating,
  shouldSurfaceChannelHint,
  type ChannelSample,
} from './freestyleChallengeChannel'

function samples(ratings: Array<1 | 2 | 3 | 4>): ChannelSample[] {
  return ratings.map((rating) => ({ rating }))
}

describe('readChallengeChannel', () => {
  it('stays unknown until there is enough to be a pattern', () => {
    const reading = readChallengeChannel(samples([1, 1, 1]))
    expect(reading.state).toBe('unknown')
    expect(reading.sampleCount).toBeLessThan(CHANNEL_MIN_SAMPLES)
  })

  it('reads mostly 忘记/困难 as the anxiety exit', () => {
    expect(readChallengeChannel(samples([1, 2, 1, 2, 3])).state).toBe('anxious')
  })

  it('reads an unbroken run of 轻松 as the boredom exit', () => {
    expect(readChallengeChannel(samples([4, 4, 4, 4, 4])).state).toBe('bored')
  })

  it('reads a mixed run as in-channel', () => {
    expect(readChallengeChannel(samples([3, 4, 2, 3, 4])).state).toBe('flow')
  })

  it('reflects now, not the whole round', () => {
    // Ten easy cards then a hard patch: the reading must follow the recent window.
    const reading = readChallengeChannel(
      samples([4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 1, 2, 1, 2, 1]),
    )
    expect(reading.state).toBe('anxious')
  })
})

describe('recordChannelRating', () => {
  it('appends each newly rated card in the order it was answered', () => {
    let log = EMPTY_CHANNEL_LOG
    log = recordChannelRating(log, 'a', 3)
    log = recordChannelRating(log, 'b', 1)

    expect(log.order).toEqual(['a', 'b'])
    expect(channelLogSamples(log)).toEqual([{ rating: 3 }, { rating: 1 }])
  })

  /**
   * Undo-then-rerate is a correction, not a second data point. Counting it twice would
   * let one revisited hard card make a balanced round read as anxious.
   */
  it('corrects a re-rated card in place instead of counting it twice', () => {
    let log = EMPTY_CHANNEL_LOG
    log = recordChannelRating(log, 'a', 1)
    log = recordChannelRating(log, 'b', 3)
    log = recordChannelRating(log, 'a', 4)

    expect(log.order).toEqual(['a', 'b'])
    expect(channelLogSamples(log)).toEqual([{ rating: 4 }, { rating: 3 }])
  })

  it('leaves the previous log untouched', () => {
    const first = recordChannelRating(EMPTY_CHANNEL_LOG, 'a', 3)
    const second = recordChannelRating(first, 'b', 1)

    expect(first.order).toEqual(['a'])
    expect(second.order).toEqual(['a', 'b'])
  })
})

describe('shouldSurfaceChannelHint', () => {
  it('speaks only at the two exits', () => {
    expect(shouldSurfaceChannelHint({ state: 'anxious', sampleCount: 8 })).toBe(true)
    expect(shouldSurfaceChannelHint({ state: 'bored', sampleCount: 8 })).toBe(true)
  })

  it('stays silent while in flow, so flow is not turned into a thing to notice', () => {
    expect(shouldSurfaceChannelHint({ state: 'flow', sampleCount: 8 })).toBe(false)
    expect(shouldSurfaceChannelHint({ state: 'unknown', sampleCount: 2 })).toBe(false)
  })
})

describe('channelAdjustment', () => {
  it('tightens to due-only when anxious', () => {
    const adjustment = channelAdjustment(
      { state: 'anxious', sampleCount: 8 },
      DEFAULT_FREESTYLE_FEED_CONFIG,
    )
    expect(adjustment).not.toBeNull()
    const next = adjustment!.apply(DEFAULT_FREESTYLE_FEED_CONFIG)
    expect(next.streams.memory_palace.due_policy).toBe('due_only')
    expect(next.streams.quiz.mastery_buckets).not.toContain('unseen')
  })

  it('widens the pool when bored', () => {
    const adjustment = channelAdjustment(
      { state: 'bored', sampleCount: 8 },
      DEFAULT_FREESTYLE_FEED_CONFIG,
    )
    expect(adjustment).not.toBeNull()
    const next = adjustment!.apply(DEFAULT_FREESTYLE_FEED_CONFIG)
    expect(next.streams.memory_palace.due_policy).toBe('all_content_due_weighted')
    expect(next.streams.quiz.weak_priority).toBe(true)
  })

  /**
   * The load-bearing one. A scope change makes useImmersiveQueue start a new round and
   * drop completedIds / encounters / plan, so a "rescue" would wipe the session.
   */
  it('never changes palace scope, so the round it rescues survives', () => {
    for (const state of ['anxious', 'bored'] as const) {
      const adjustment = channelAdjustment({ state, sampleCount: 8 }, DEFAULT_FREESTYLE_FEED_CONFIG)
      const next = adjustment!.apply(DEFAULT_FREESTYLE_FEED_CONFIG)
      expect(freestylePalaceScopeUnchanged(DEFAULT_FREESTYLE_FEED_CONFIG, next)).toBe(true)
      expect(next.streams.memory_palace.specific_palace_ids)
        .toEqual(DEFAULT_FREESTYLE_FEED_CONFIG.streams.memory_palace.specific_palace_ids)
      expect(next.streams.memory_palace.subject_scope)
        .toBe(DEFAULT_FREESTYLE_FEED_CONFIG.streams.memory_palace.subject_scope)
    }
  })

  it('offers nothing when in flow or when the lever is already at its end', () => {
    expect(channelAdjustment({ state: 'flow', sampleCount: 8 }, DEFAULT_FREESTYLE_FEED_CONFIG))
      .toBeNull()

    const tightest = channelAdjustment(
      { state: 'anxious', sampleCount: 8 },
      DEFAULT_FREESTYLE_FEED_CONFIG,
    )!.apply(DEFAULT_FREESTYLE_FEED_CONFIG)
    expect(channelAdjustment({ state: 'anxious', sampleCount: 8 }, tightest)).toBeNull()
  })
})
