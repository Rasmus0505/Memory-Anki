import {
  cardPalaceId,
  isRetryOccurrence,
  planCardStatus,
  sourceCardId,
  type FreestyleRoundPlanCardStatus,
  type FreestyleRoundPlanState,
} from '@/modules/practice/public'
import type { FreestyleCard } from '@/shared/api/contracts'

export type FreestyleSegmentTone = 'done' | 'retry' | 'current' | 'pending'

export interface FreestyleProgressSegment {
  cardId: string
  tone: FreestyleSegmentTone
  palaceId: number | null
  /** True when every rendered segment of this palace is `done`. */
  palaceDone: boolean
}

export interface FreestyleProgressSummary {
  segments: FreestyleProgressSegment[]
  /** 1-based index among rendered segments; 0 when no card is current. */
  position: number
  total: number
  doneCount: number
  retryCount: number
  /**
   * Original scheduled cards in the feed, excluding retry insertions and
   * excluded cards. This is the denominator the learner planned for (`20` in
   * `3/20 · 重练 +1`).
   */
  scheduledBase: number
  /** 1-based index among scheduledBase cards; 0 when the current card is unknown. */
  positionBase: number
  /** Retry occurrence cards currently in the feed (the `+N` in the HUD). */
  retryInserted: number
  /** Source-deduped units that have already passed this round. */
  passedCount: number
}

/**
 * Palace identity is the primary rail hue; tone only modulates opacity / overlay.
 * Plan statuses still collapse: `excluded` leaves the rail (not part of the round),
 * and `stale` is too transient for its own treatment. `current` stays distinct
 * because restudy re-insertion reorders the feed mid-round.
 */
export function segmentTone(
  status: FreestyleRoundPlanCardStatus,
): FreestyleSegmentTone | null {
  switch (status) {
    case 'excluded':
      return null
    case 'active':
      return 'current'
    case 'completed':
      return 'done'
    case 'retry':
      return 'retry'
    default:
      return 'pending'
  }
}

/** Fixed accents readable on the dark immersive chrome (~8 slots). */
const PALACE_ACCENT_KEYS = [
  'sky',
  'violet',
  'rose',
  'teal',
  'indigo',
  'green',
  'fuchsia',
  'pink',
] as const

export type PalaceAccentKey = (typeof PALACE_ACCENT_KEYS)[number] | 'neutral'

type AccentToneClass = Record<FreestyleSegmentTone, string>

/** pending: dim · current: bright · done: strong fill · retry: palace + amber mix */
const PALACE_ACCENT_TONE_CLASS: Record<(typeof PALACE_ACCENT_KEYS)[number], AccentToneClass> = {
  sky: {
    pending: 'bg-sky-400/32',
    current: 'bg-sky-300',
    done: 'bg-sky-400/90',
    retry: 'bg-[color-mix(in_srgb,#38bdf8_55%,#fcd34d_45%)]',
  },
  violet: {
    pending: 'bg-violet-400/32',
    current: 'bg-violet-300',
    done: 'bg-violet-400/90',
    retry: 'bg-[color-mix(in_srgb,#a78bfa_55%,#fcd34d_45%)]',
  },
  rose: {
    pending: 'bg-rose-400/32',
    current: 'bg-rose-300',
    done: 'bg-rose-400/90',
    retry: 'bg-[color-mix(in_srgb,#fb7185_55%,#fcd34d_45%)]',
  },
  teal: {
    pending: 'bg-teal-400/32',
    current: 'bg-teal-300',
    done: 'bg-teal-400/90',
    retry: 'bg-[color-mix(in_srgb,#2dd4bf_55%,#fcd34d_45%)]',
  },
  indigo: {
    pending: 'bg-indigo-400/32',
    current: 'bg-indigo-300',
    done: 'bg-indigo-400/90',
    retry: 'bg-[color-mix(in_srgb,#818cf8_55%,#fcd34d_45%)]',
  },
  green: {
    pending: 'bg-green-400/32',
    current: 'bg-green-300',
    done: 'bg-green-400/90',
    retry: 'bg-[color-mix(in_srgb,#4ade80_55%,#fcd34d_45%)]',
  },
  fuchsia: {
    pending: 'bg-fuchsia-400/32',
    current: 'bg-fuchsia-300',
    done: 'bg-fuchsia-400/90',
    retry: 'bg-[color-mix(in_srgb,#e879f9_55%,#fcd34d_45%)]',
  },
  pink: {
    pending: 'bg-pink-400/32',
    current: 'bg-pink-300',
    done: 'bg-pink-400/90',
    retry: 'bg-[color-mix(in_srgb,#f472b6_55%,#fcd34d_45%)]',
  },
}

const NEUTRAL_ACCENT_TONE_CLASS: AccentToneClass = {
  pending: 'bg-white/14',
  current: 'bg-zinc-100',
  done: 'bg-zinc-400/85',
  retry: 'bg-amber-300/90',
}

/**
 * Stable palaceId → fixed palette slot. null → neutral fallback.
 * Same id always maps to the same accent; different ids prefer different slots.
 */
export function palaceAccent(palaceId: number | null): PalaceAccentKey {
  if (palaceId == null) return 'neutral'
  const slot = ((palaceId % PALACE_ACCENT_KEYS.length) + PALACE_ACCENT_KEYS.length) % PALACE_ACCENT_KEYS.length
  return PALACE_ACCENT_KEYS[slot]
}

/** Tailwind fill for a segment: palace accent modulated by tone. */
export function palaceAccentToneClass(
  palaceId: number | null,
  tone: FreestyleSegmentTone,
): string {
  const accent = palaceAccent(palaceId)
  if (accent === 'neutral') return NEUTRAL_ACCENT_TONE_CLASS[tone]
  return PALACE_ACCENT_TONE_CLASS[accent][tone]
}

export function buildFreestyleProgressSummary(
  cards: FreestyleCard[],
  roundPlan: FreestyleRoundPlanState | null,
  completedIds: string[],
  hiddenIds: string[],
  currentCardId: string | null,
): FreestyleProgressSummary {
  const completed = new Set(completedIds.map(String))
  const segments: FreestyleProgressSegment[] = []
  const baseCards: FreestyleCard[] = []
  let retryInserted = 0
  const passedSources = new Set<string>()

  for (const card of cards) {
    const tone = segmentTone(
      planCardStatus(card, roundPlan, completedIds, hiddenIds, currentCardId),
    )
    if (!tone) continue
    segments.push({ cardId: card.id, tone, palaceId: cardPalaceId(card), palaceDone: false })
    if (isRetryOccurrence(card)) {
      retryInserted += 1
    } else {
      baseCards.push(card)
    }
    const sourceId = sourceCardId(card)
    if (
      tone === 'done'
      || completed.has(card.id)
      || completed.has(sourceId)
    ) {
      passedSources.add(sourceId || card.id)
    }
  }

  const unfinishedPalaces = new Set(
    segments
      .filter((segment) => segment.palaceId != null && segment.tone !== 'done')
      .map((segment) => segment.palaceId as number),
  )
  for (const segment of segments) {
    segment.palaceDone = segment.palaceId != null && !unfinishedPalaces.has(segment.palaceId)
  }

  const currentIndex = segments.findIndex((segment) => segment.tone === 'current')
  const current = currentCardId
    ? cards.find((card) => card.id === currentCardId)
    : null
  const currentSourceId = current ? sourceCardId(current) : ''
  const baseIndex = currentSourceId
    ? baseCards.findIndex((card) => sourceCardId(card) === currentSourceId || card.id === currentSourceId)
    : -1

  return {
    segments,
    position: currentIndex >= 0 ? currentIndex + 1 : 0,
    total: segments.length,
    doneCount: segments.filter((segment) => segment.tone === 'done').length,
    retryCount: segments.filter((segment) => segment.tone === 'retry').length,
    scheduledBase: baseCards.length,
    positionBase: baseIndex >= 0 ? baseIndex + 1 : 0,
    retryInserted,
    passedCount: passedSources.size,
  }
}

export function progressHudText(summary: FreestyleProgressSummary): string {
  if (summary.scheduledBase === 0 && summary.retryInserted === 0) return ''
  const position = summary.positionBase > 0 ? summary.positionBase : 0
  const parts = [`${position || '–'}/${summary.scheduledBase}`]
  if (summary.retryInserted > 0) parts.push(`重练 +${summary.retryInserted}`)
  if (summary.passedCount > 0) parts.push(`过 ${summary.passedCount}`)
  return parts.join(' · ')
}

/**
 * The rail is decorative, so every count it draws has to be spoken here instead.
 */
export function progressRailLabel(summary: FreestyleProgressSummary): string {
  if (summary.scheduledBase === 0 && summary.total === 0) return '本轮暂无安排。点击查看本轮安排'
  const parts = [
    summary.positionBase > 0
      ? `本轮进度 ${summary.positionBase}/${summary.scheduledBase}`
      : `本轮共 ${summary.scheduledBase} 张`,
  ]
  if (summary.retryInserted > 0) parts.push(`重练 ${summary.retryInserted} 张`)
  if (summary.passedCount > 0) parts.push(`已通过 ${summary.passedCount}`)
  return `${parts.join('，')}。点击查看本轮安排`
}
