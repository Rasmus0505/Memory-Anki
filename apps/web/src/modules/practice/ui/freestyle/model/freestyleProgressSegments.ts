import {
  cardPalaceId,
  isRetryOccurrence,
  planCardStatus,
  sourceCardId,
  type FreestyleRoundPlanCard,
  type FreestyleRoundPlanCardStatus,
  type FreestyleRoundPlanState,
  type FreestyleUnitEncounterState,
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
  /** True on the first today-source tick so the rail can draw 欠账 | 今天. */
  cohortBoundary?: boolean
  enteredOn?: string
}

/**
 * Retry occurrence fill on the rail: unfinished is faint amber, completed is solid.
 * Viewing size is separate (`progressSegmentShapeClass` / node size).
 */
export function retryNodeToneClass(tone: FreestyleSegmentTone): string {
  if (tone === 'done') return 'bg-amber-400 text-zinc-950'
  return 'bg-amber-400/25 text-amber-50'
}

/** Card badge / 本轮安排 row chrome for a retry occurrence. */
export function retryChromeClass(done: boolean): string {
  return done
    ? 'border-emerald-500/40 bg-emerald-500/12 text-emerald-800 dark:border-emerald-400/35 dark:bg-emerald-500/15 dark:text-emerald-200'
    : 'border-amber-500/50 bg-amber-400/90 text-zinc-950 dark:border-amber-300/50 dark:bg-amber-400 dark:text-zinc-950'
}

/**
 * Fill follows this-round recorded rating. A live selectedRating can upgrade
 * pending → completed/retry immediately; an empty amend glance keeps the plan
 * status so swipe-back does not look unrated.
 */
export function visualPlanStatus(
  status: FreestyleRoundPlanCardStatus,
  encounter?: FreestyleUnitEncounterState,
  entryStatus?: FreestyleRoundPlanCardStatus,
): FreestyleRoundPlanCardStatus {
  if (status === 'excluded') return status
  if (encounter?.selectedRating != null) {
    if (encounter.passed === true) return 'completed'
    if (encounter.passed === false) return 'retry'
  }
  // `planCardStatus` uses `active` as the playhead. Fill should keep this-round
  // completed/retry instead of looking unrated just because the card is on screen.
  if (
    status === 'active'
    && entryStatus
    && entryStatus !== 'active'
    && entryStatus !== 'excluded'
  ) {
    return entryStatus
  }
  return status
}

export function liveEncounterFillDone(
  encounter: FreestyleUnitEncounterState | undefined,
  completed: boolean,
): boolean {
  if (encounter?.selectedRating != null) return encounter.passed === true
  return completed
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
      // Playhead size is `viewing`, not fill. An unrated card on screen stays faint.
      return 'pending'
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

/** Preferred width of a non-viewing retry circle (`size-3.5`). */
export const PROGRESS_RAIL_RETRY_SLOT_PX = 14
/** Preferred width of the retry circle on the card currently on screen (`size-5`). */
export const PROGRESS_RAIL_RETRY_VIEWING_SLOT_PX = 20
export const PROGRESS_RAIL_GAP_PX = 1
export const PROGRESS_RAIL_TICK_MIN_PX = 2
export const PROGRESS_RAIL_VIEWING_TICK_MIN_PX = 6
/** When the rail is too narrow, only this many cards on each side of the playhead keep a retry count. */
export const PROGRESS_RAIL_NEARBY_RADIUS = 2

export function progressRailAnchorIndex(segments: readonly FreestyleProgressSegment[]): number {
  const viewing = segments.findIndex((segment) => segment.viewing || segment.tone === 'current')
  return viewing >= 0 ? viewing : 0
}

/**
 * True when every retry circle can keep its count without pushing the round past the rail.
 * A non-positive width means the rail has not been measured yet.
 */
export function freestyleProgressRailFits(
  segments: readonly FreestyleProgressSegment[],
  railWidthPx: number,
): boolean {
  if (!(railWidthPx > 0) || segments.length === 0) return true
  let fixed = 0
  let flexMin = 0
  for (const segment of segments) {
    const viewing = Boolean(segment.viewing || segment.tone === 'current')
    if (segment.kind === 'retry') {
      fixed += viewing ? PROGRESS_RAIL_RETRY_VIEWING_SLOT_PX : PROGRESS_RAIL_RETRY_SLOT_PX
    } else {
      flexMin += viewing ? PROGRESS_RAIL_VIEWING_TICK_MIN_PX : PROGRESS_RAIL_TICK_MIN_PX
    }
  }
  const gaps = Math.max(0, segments.length - 1) * PROGRESS_RAIL_GAP_PX
  return fixed + flexMin + gaps <= railWidthPx
}

/**
 * The circle glyph is this card's retry attempt in the current round.
 * Far from the playhead it is dropped once the circles no longer fit, and the tick stays.
 */
export function progressRailRetryCountVisible(
  segments: readonly FreestyleProgressSegment[],
  index: number,
  railWidthPx: number,
): boolean {
  const segment = segments[index]
  if (segment?.kind !== 'retry') return false
  if (!(railWidthPx > 0) || freestyleProgressRailFits(segments, railWidthPx)) return true
  const anchor = progressRailAnchorIndex(segments)
  return Math.abs(index - anchor) <= PROGRESS_RAIL_NEARBY_RADIUS
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

function collapseRetrySegments(segments: FreestyleProgressSegment[]) {
  const bySource = new Map<string, FreestyleProgressSegment[]>()
  segments.forEach((segment) => {
    if (segment.kind !== 'retry') return
    const source = segment.sourceCardId || segment.cardId
    const list = bySource.get(source) ?? []
    list.push(segment)
    bySource.set(source, list)
  })
  const drop = new Set<string>()
  bySource.forEach((list) => {
    if (list.length <= 1) return
    const unfinished = list.filter((segment) => segment.tone !== 'done')
    const ranked = unfinished.length ? unfinished : list
    const keep = list.find((segment) => segment.viewing)
      || ranked.reduce((best, segment) => (
        Math.max(1, segment.retryAttempt || 1) >= Math.max(1, best.retryAttempt || 1) ? segment : best
      ))
    list.forEach((segment) => {
      if (segment.cardId !== keep.cardId) drop.add(segment.cardId)
    })
  })
  if (!drop.size) return
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (drop.has(segments[index].cardId)) segments.splice(index, 1)
  }
}

export function retryNodeLabel(segment: FreestyleProgressSegment): string {
  const attempt = Math.max(1, Math.round(segment.retryAttempt || 1))
  const label = String(segment.sourceLabel || '').trim()
  return label ? `重练《${label}》第 ${attempt} 次` : `重练第 ${attempt} 次`
}

function segmentStatusLabel(segment: FreestyleProgressSegment): string {
  if (segment.viewing || segment.tone === 'current') {
    if (segment.tone === 'done') return '当前 · 已过'
    return '当前'
  }
  if (segment.tone === 'done') return '已过'
  if (segment.kind === 'retry') return '待重练'
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
    return [place, retryNodeLabel(segment), segmentStatusLabel(segment)].filter(Boolean).join(' · ')
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
  encounters: Record<string, FreestyleUnitEncounterState> = {},
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
      const sourceId = sourceCardId(card)
      const encounter = encounters[card.id] ?? (sourceId !== card.id ? encounters[sourceId] : undefined)
      const status = visualPlanStatus(
        planCardStatus(card, roundPlan, completedIds, hiddenIds, currentCardId),
        encounter,
        planEntry?.status,
      )
      const tone = segmentTone(status)
      if (!tone) continue
      const retryKind = isRetryOccurrence(card)
      const waitingRetry = !retryKind && planEntry?.status === 'retry'
      segments.push({
        cardId: card.id,
        tone,
        palaceId: cardPalaceId(card),
        palaceDone: false,
        viewing: currentCardId === card.id,
        kind: retryKind ? 'retry' : 'source',
        enteredOn: planEntry?.enteredOn,
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
      enteredOn: planEntry?.enteredOn,
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

  collapseRetrySegments(segments)
  retryInserted = segments.filter((segment) => segment.kind === 'retry').length

  const today = String(roundPlan?.today || '').trim()
  if (today) {
    const firstToday = segments.findIndex(
      (segment) => segment.kind !== 'retry' && segment.enteredOn === today,
    )
    if (firstToday > 0) {
      const hasCarried = segments.slice(0, firstToday).some(
        (segment) => segment.enteredOn && segment.enteredOn !== today,
      )
      if (hasCarried) segments[firstToday].cohortBoundary = true
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
  if (summary.total === 0) return ''
  const position = summary.position > 0 ? summary.position : 0
  return `${position || '–'}/${summary.total}`
}

/**
 * The rail is decorative, so every count it draws has to be spoken here instead.
 */
export function progressRailLabel(summary: FreestyleProgressSummary): string {
  if (summary.total === 0) return '本轮暂无安排。点击查看本轮安排'
  const parts = [
    summary.position > 0
      ? `本轮进度 ${summary.position}/${summary.total}`
      : `本轮共 ${summary.total} 张`,
  ]
  return `${parts.join('，')}。点击查看本轮安排`
}
