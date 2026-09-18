import {
  cardPalaceId,
  isRetryOccurrence,
  planCardStatus,
  sourceCardId,
  type FreestyleRoundPlanCard,
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
  /** True when this tick is the card currently on screen, even if already rated. */
  viewing?: boolean
  kind?: 'source' | 'retry'
  retryAttempt?: number
  sourceCardId?: string
  sourceLabel?: string
  waitingRetry?: boolean
  retryAfterCards?: number
}

/** High-contrast amber fill for retry occurrence circles (not palace-mixed bars). */
export const retryNodeClass = 'bg-amber-400 text-zinc-950'

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
 * Palace identity is the primary rail hue. Tone is fill strength, not a second hue:
 * pending is a faint unfilled tick, done is a solid fill of the same palace color,
 * current is the playhead. Plan statuses still collapse: `excluded` leaves the rail
 * (not part of the round), and `stale` is too transient for its own treatment.
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

/**
 * pending: faint unfilled (~25%) · current: bright playhead · done: solid filled
 * retry: palace + amber mix. /70 vs /90 is not readable on a 6px tick.
 */
const PALACE_ACCENT_TONE_CLASS: Record<(typeof PALACE_ACCENT_KEYS)[number], AccentToneClass> = {
  sky: {
    pending: 'bg-sky-400/25',
    current: 'bg-sky-300',
    done: 'bg-sky-400',
    retry: 'bg-[color-mix(in_srgb,#38bdf8_55%,#fcd34d_45%)]',
  },
  violet: {
    pending: 'bg-violet-400/25',
    current: 'bg-violet-300',
    done: 'bg-violet-400',
    retry: 'bg-[color-mix(in_srgb,#a78bfa_55%,#fcd34d_45%)]',
  },
  rose: {
    pending: 'bg-rose-400/25',
    current: 'bg-rose-300',
    done: 'bg-rose-400',
    retry: 'bg-[color-mix(in_srgb,#fb7185_55%,#fcd34d_45%)]',
  },
  teal: {
    pending: 'bg-teal-400/25',
    current: 'bg-teal-300',
    done: 'bg-teal-400',
    retry: 'bg-[color-mix(in_srgb,#2dd4bf_55%,#fcd34d_45%)]',
  },
  indigo: {
    pending: 'bg-indigo-400/25',
    current: 'bg-indigo-300',
    done: 'bg-indigo-400',
    retry: 'bg-[color-mix(in_srgb,#818cf8_55%,#fcd34d_45%)]',
  },
  green: {
    pending: 'bg-green-400/25',
    current: 'bg-green-300',
    done: 'bg-green-400',
    retry: 'bg-[color-mix(in_srgb,#4ade80_55%,#fcd34d_45%)]',
  },
  fuchsia: {
    pending: 'bg-fuchsia-400/25',
    current: 'bg-fuchsia-300',
    done: 'bg-fuchsia-400',
    retry: 'bg-[color-mix(in_srgb,#e879f9_55%,#fcd34d_45%)]',
  },
  pink: {
    pending: 'bg-pink-400/25',
    current: 'bg-pink-300',
    done: 'bg-pink-400',
    retry: 'bg-[color-mix(in_srgb,#f472b6_55%,#fcd34d_45%)]',
  },
}

const NEUTRAL_ACCENT_TONE_CLASS: AccentToneClass = {
  pending: 'bg-white/20',
  current: 'bg-zinc-100',
  done: 'bg-zinc-200',
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

/**
 * Viewing playhead is independent of rating fill: a rated card still grows when
 * it is on screen, and cancelling a rating only changes fill, not the playhead.
 */
export function progressSegmentShapeClass(
  tone: FreestyleSegmentTone,
  viewing = false,
): string {
  if (viewing || tone === 'current') {
    return 'h-3.5 min-w-[6px] ring-2 ring-white shadow-[0_0_8px_rgba(255,255,255,0.45)]'
  }
  return 'h-1.5'
}

function progressCardLabel(
  card: FreestyleCard,
  cards: FreestyleCard[],
  roundPlan: FreestyleRoundPlanState | null,
): string {
  const sourceId = sourceCardId(card)
  const fromPlan = roundPlan?.cardsById[sourceId]?.label || roundPlan?.cardsById[card.id]?.label
  if (fromPlan) return fromPlan
  const source = cards.find((item) => item.id === sourceId) ?? card
  if ('context_path' in source && source.context_path?.length) {
    const text = String(source.context_path.at(-1)?.text || '').trim()
    if (text) return text
  }
  return sourceId || card.id
}

function progressIds(
  cards: FreestyleCard[],
  roundPlan: FreestyleRoundPlanState | null,
): string[] {
  if (!roundPlan) return cards.map((card) => String(card.id || '')).filter(Boolean)
  const seen = new Set<string>()
  const ids: string[] = []
  for (const raw of roundPlan.orderIds) {
    const id = String(raw || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  for (const card of cards) {
    const id = String(card.id || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

function snapshotPlanStatus(
  id: string,
  planEntry: FreestyleRoundPlanCard | undefined,
  completed: Set<string>,
): FreestyleRoundPlanCardStatus | null {
  if (completed.has(id) || planEntry?.status === 'completed') return 'completed'
  if (planEntry?.status === 'retry' || planEntry?.status === 'pending') return planEntry.status
  return null
}

function snapshotSourceLabel(
  id: string,
  sourceId: string,
  planEntry: FreestyleRoundPlanCard | undefined,
  roundPlan: FreestyleRoundPlanState | null,
): string {
  return roundPlan?.cardsById[sourceId]?.label || planEntry?.label || sourceId || id
}

export function retryNodeLabel(segment: FreestyleProgressSegment): string {
  const attempt = Math.max(1, Math.round(segment.retryAttempt || 1))
  const label = String(segment.sourceLabel || '').trim()
  return label ? `重练《${label}》第 ${attempt} 次` : `重练第 ${attempt} 次`
}

function segmentStatusLabel(segment: FreestyleProgressSegment): string {
  if (segment.kind === 'retry') return retryNodeLabel(segment)
  if (segment.viewing || segment.tone === 'current') {
    if (segment.tone === 'done') return '当前 · 已过'
    return '当前'
  }
  if (segment.tone === 'done') return '已过'
  if (segment.waitingRetry || segment.tone === 'retry') return '稍后重练'
  return '待练'
}

/** Hover copy for one rail tick: that card, not the card currently on screen. */
export function progressSegmentHoverLabel(
  segment: FreestyleProgressSegment,
  index: number,
  total: number,
): string {
  const place = total > 0 ? `${index + 1}/${total}` : ''
  if (segment.kind === 'retry') {
    return [place, retryNodeLabel(segment)].filter(Boolean).join(' · ')
  }
  const name = String(segment.sourceLabel || '').trim()
  const titled = name ? `《${name}》` : ''
  return [place, titled, segmentStatusLabel(segment)].filter(Boolean).join(' · ')
}

export function buildFreestyleProgressSummary(
  cards: FreestyleCard[],
  roundPlan: FreestyleRoundPlanState | null,
  completedIds: string[],
  hiddenIds: string[],
  currentCardId: string | null,
): FreestyleProgressSummary {
  const completed = new Set(completedIds.map(String))
  const hidden = new Set(hiddenIds.map(String))
  const liveById = new Map(cards.map((card) => [String(card.id), card]))
  const segments: FreestyleProgressSegment[] = []
  const baseItems: Array<{ id: string; sourceId: string }> = []
  let retryInserted = 0
  const passedSources = new Set<string>()

  // Visual only: keep completed/retry ticks after the live feed drops them.
  for (const id of progressIds(cards, roundPlan)) {
    if (hidden.has(id)) continue
    const planEntry = roundPlan?.cardsById[id]
    if (planEntry?.status === 'excluded') continue

    const card = liveById.get(id)
    if (card) {
      const tone = segmentTone(
        planCardStatus(card, roundPlan, completedIds, hiddenIds, currentCardId),
      )
      if (!tone) continue
      const retryKind = isRetryOccurrence(card)
      const waitingRetry = !retryKind && planEntry?.status === 'retry'
      const sourceId = sourceCardId(card)
      segments.push({
        cardId: card.id,
        tone,
        palaceId: cardPalaceId(card),
        palaceDone: false,
        viewing: currentCardId === card.id,
        kind: retryKind ? 'retry' : 'source',
        sourceLabel: progressCardLabel(card, cards, roundPlan),
        ...(retryKind
          ? {
              retryAttempt: Math.max(1, Math.round(Number(card.retry_attempt) || 1)),
              sourceCardId: sourceId,
            }
          : {
              waitingRetry,
              ...(waitingRetry
                ? { retryAfterCards: Math.max(0, Math.round(Number(planEntry?.retryAfterCards) || 0)) }
                : {}),
            }),
      })
      if (retryKind) {
        retryInserted += 1
      } else {
        baseItems.push({ id: card.id, sourceId })
      }
      if (
        tone === 'done'
        || completed.has(card.id)
        || completed.has(sourceId)
      ) {
        passedSources.add(sourceId || card.id)
      }
      continue
    }

    const status = snapshotPlanStatus(id, planEntry, completed)
    const tone = status ? segmentTone(status) : null
    if (!tone) continue
    const retryKind = planEntry?.occurrenceKind === 'retry'
    const sourceId = planEntry?.sourceCardId || id
    const waitingRetry = !retryKind && planEntry?.status === 'retry'
    segments.push({
      cardId: id,
      tone,
      palaceId: planEntry?.palaceId ?? null,
      palaceDone: false,
      viewing: currentCardId === id,
      kind: retryKind ? 'retry' : 'source',
      sourceLabel: snapshotSourceLabel(id, sourceId, planEntry, roundPlan),
      ...(retryKind
        ? {
            retryAttempt: Math.max(1, Math.round(Number(planEntry?.retryAttempt) || 1)),
            sourceCardId: sourceId,
          }
        : {
            waitingRetry,
            ...(waitingRetry
              ? { retryAfterCards: Math.max(0, Math.round(Number(planEntry?.retryAfterCards) || 0)) }
              : {}),
          }),
    })
    if (retryKind) {
      retryInserted += 1
    } else {
      baseItems.push({ id, sourceId })
    }
    if (
      tone === 'done'
      || completed.has(id)
      || completed.has(sourceId)
    ) {
      passedSources.add(sourceId || id)
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

  const currentIndex = segments.findIndex(
    (segment) => segment.viewing || segment.tone === 'current',
  )
  const current = currentCardId ? liveById.get(currentCardId) ?? null : null
  const currentSourceId = current ? sourceCardId(current) : ''
  const baseIndex = currentSourceId
    ? baseItems.findIndex((item) => item.sourceId === currentSourceId || item.id === currentSourceId)
    : -1

  return {
    segments,
    position: currentIndex >= 0 ? currentIndex + 1 : 0,
    total: segments.length,
    doneCount: segments.filter((segment) => segment.tone === 'done').length,
    retryCount: segments.filter((segment) => segment.tone === 'retry').length,
    scheduledBase: baseItems.length,
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
