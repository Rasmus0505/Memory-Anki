import {
  freestylePalaceScopeSignature,
  sanitizeFreestyleFeedConfig,
} from '@/modules/practice/public'
import type { FreestyleFeedConfig } from '@/shared/api/contracts'

/**
 * The challenge–skill channel from 《心流》.
 *
 * Flow lives in a narrow band: challenge above skill exits into anxiety, skill above
 * challenge exits into boredom. The book's practical claim is that a person in flow
 * keeps adjusting difficulty to stay in the band — a tennis player picks a harder
 * opponent, an easier one, a different shot.
 *
 * Freestyle had no channel signal at all, so the only way to correct a round that was
 * too hard or too dull was to leave the feed and open configuration — which ends the
 * session it was meant to save.
 *
 * This model reads the channel from what the learner just did, and offers one
 * adjustment that can be applied without leaving the feed.
 */

export type ChannelState = 'anxious' | 'flow' | 'bored' | 'unknown'

/** One rating the learner gave, newest last. Quiz correctness maps in as pass/fail. */
export interface ChannelSample {
  /** 1 忘记 · 2 困难 · 3 记得 · 4 轻松 */
  rating: 1 | 2 | 3 | 4
}

/**
 * Session-local rating log. Keyed by cardId with a separate order list so that an
 * undo-then-rerate corrects the learner's answer in place rather than counting the
 * same card twice — the window must describe distinct cards, not repeated attempts
 * at one, or a single hard card revisited three times would read as a hard round.
 */
export interface ChannelLog {
  byCardId: Record<string, 1 | 2 | 3 | 4>
  order: string[]
}

export const EMPTY_CHANNEL_LOG: ChannelLog = { byCardId: {}, order: [] }

export function recordChannelRating(
  log: ChannelLog,
  cardId: string,
  rating: 1 | 2 | 3 | 4,
): ChannelLog {
  const known = log.byCardId[cardId] != null
  return {
    byCardId: { ...log.byCardId, [cardId]: rating },
    order: known ? log.order : [...log.order, cardId],
  }
}

export function channelLogSamples(log: ChannelLog): ChannelSample[] {
  return log.order
    .map((cardId) => log.byCardId[cardId])
    .filter((rating): rating is 1 | 2 | 3 | 4 => rating != null)
    .map((rating) => ({ rating }))
}

export interface ChannelReading {
  state: ChannelState
  /** How many samples the reading used, so the hint can be honest about its basis. */
  sampleCount: number
}

/** Enough to be a pattern, few enough to reflect *now* rather than the whole round. */
export const CHANNEL_WINDOW = 8
export const CHANNEL_MIN_SAMPLES = 5
const ANXIOUS_STRUGGLE_RATIO = 0.6
const BORED_EASY_RATIO = 0.8

export function readChallengeChannel(samples: ChannelSample[]): ChannelReading {
  const window = samples.slice(-CHANNEL_WINDOW)
  if (window.length < CHANNEL_MIN_SAMPLES) {
    return { state: 'unknown', sampleCount: window.length }
  }
  const struggleCount = window.filter((item) => item.rating <= 2).length
  const easyCount = window.filter((item) => item.rating === 4).length
  const struggleRatio = struggleCount / window.length
  const easyRatio = easyCount / window.length

  if (struggleRatio >= ANXIOUS_STRUGGLE_RATIO) {
    return { state: 'anxious', sampleCount: window.length }
  }
  if (easyRatio >= BORED_EASY_RATIO) {
    return { state: 'bored', sampleCount: window.length }
  }
  return { state: 'flow', sampleCount: window.length }
}

export interface ChannelAdjustment {
  /** What the learner is agreeing to, in their own terms. */
  actionLabel: string
  hint: string
  apply: (config: FreestyleFeedConfig) => FreestyleFeedConfig
}

/**
 * Adjustments deliberately never touch palace scope (`specific_palace_ids` /
 * `subject_scope` / `subject_ids`). An in-feed hint must not swap the palace
 * filter under the card the learner is reading. Difficulty is moved through
 * `due_policy` for palace cards only. Question mastery is not a lever.
 */
export function channelAdjustment(
  reading: ChannelReading,
  config: FreestyleFeedConfig,
): ChannelAdjustment | null {
  if (reading.state === 'anxious') {
    if (config.streams.memory_palace.due_policy === 'due_only') return null
    return {
      actionLabel: '只留到期的',
      hint: `最近 ${reading.sampleCount} 张偏难`,
      apply: (current) =>
        sanitizeFreestyleFeedConfig({
          ...current,
          due_policy: 'due_only',
          streams: {
            ...current.streams,
            memory_palace: { ...current.streams.memory_palace, due_policy: 'due_only' },
          },
        }),
    }
  }

  if (reading.state === 'bored') {
    return null
  }

  return null
}

/**
 * Being told you are in flow is itself a reason to think about being in flow, which
 * is the one thing that reliably ends it. So the hint speaks only at the two exits,
 * never to confirm that things are going well.
 */
export function shouldSurfaceChannelHint(reading: ChannelReading) {
  return reading.state === 'anxious' || reading.state === 'bored'
}

/**
 * Guard for the scope rule above, exported so the regression test can assert it
 * directly instead of trusting a comment to hold.
 */
export function freestylePalaceScopeUnchanged(
  before: FreestyleFeedConfig,
  after: FreestyleFeedConfig,
) {
  return freestylePalaceScopeSignature(before) === freestylePalaceScopeSignature(after)
}

/** Once dismissed, stay quiet: a repeating suggestion is an interruption. */
export const CHANNEL_HINT_COOLDOWN_MS = 180_000
