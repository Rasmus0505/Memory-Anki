import {
  cardPalaceId,
  isRetryOccurrence,
  reviewUnitIdFromCardId,
  sourceCardId,
  type FreestyleUnitEncounterState,
} from '@/modules/practice/domain/queueState'
import {
  isOccurrenceScored,
  isShadowOfQueueRemoval,
} from '@/modules/practice/domain/unitProgressState'
import {
  planCardStatus,
  type FreestyleRoundPlanCard,
  type FreestyleRoundPlanCardStatus,
  type FreestyleRoundPlanState,
} from '@/modules/practice/domain/roundPlan'
import type { FreestyleCard } from '@/shared/api/contracts'
import { FREESTYLE_REVIEW_HINT_ID, isReviewHintCard } from '@/shared/api/contracts'

export type FreestyleSegmentTone = 'done' | 'retry' | 'current' | 'pending'

export interface FreestyleProgressSegment {
  cardId: string
  tone: FreestyleSegmentTone
  palaceId: number | null
  /** True when every rendered segment of this palace is `done`. */
  palaceDone: boolean
  /** True when this tick is the card currently on screen, even if already rated. */
  viewing?: boolean
  /** Confirmed 移除队列. Solid fill, but not a memory pass and not palace clearance. */
  removed?: boolean
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
  if (tone === 'done') return 'bg-rate-hard text-stage'
  return 'bg-rate-hard/25 text-stage-ink'
}

/** Card badge / 本轮安排 row chrome for a retry occurrence. */
export function retryChromeClass(done: boolean): string {
  return done
    ? 'border-rate-good/40 bg-rate-good/12 text-rate-good'
    : 'border-rate-hard/50 bg-rate-hard/90 text-stage'
}

/**
 * Fill is binary and occurrence-local: scored this round → solid, else faint.
 * Weak and pass look the same on the rail (产品：已评分就填实心). An empty
 * amend glance keeps the this-round score via `unitProgressState`.
 */
export function visualPlanStatus(
  status: FreestyleRoundPlanCardStatus,
  encounter?: FreestyleUnitEncounterState,
  entryStatus?: FreestyleRoundPlanCardStatus,
  scored?: boolean,
): FreestyleRoundPlanCardStatus {
  if (status === 'excluded') return status
  const isScored = scored ?? (encounter?.selectedRating != null || status === 'completed')
  if (isScored) return 'completed'
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
  if (encounter?.selectedRating != null) return true
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
 * current is the playhead. A confirmed 移除队列 stays on the rail as that solid fill.
 * `stale` is too transient for its own treatment.
 */
export function segmentTone(
  status: FreestyleRoundPlanCardStatus,
): FreestyleSegmentTone | null {
  switch (status) {
    case 'excluded':
      return 'done'
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

/** Warm accents readable on the warm-dark stage (~8 slots, one muted cool for contrast). */
const PALACE_ACCENT_KEYS = [
  'honey',
  'terracotta',
  'sage',
  'teal',
  'plum',
  'clay',
  'moss',
  'dusk',
] as const

export type PalaceAccentKey = (typeof PALACE_ACCENT_KEYS)[number] | 'neutral'

type AccentToneClass = Record<FreestyleSegmentTone, string>

/**
 * pending: faint unfilled (~25%) · current: bright playhead · done: solid filled
 * retry: palace + rate-hard amber mix. /70 vs /90 is not readable on a 6px tick.
 * Literal strings so Tailwind can see every class.
 */
const PALACE_ACCENT_TONE_CLASS: Record<(typeof PALACE_ACCENT_KEYS)[number], AccentToneClass> = {
  honey: {
    pending: 'bg-[hsl(38_90%_58%)]/25',
    current: 'bg-[hsl(40_96%_72%)]',
    done: 'bg-[hsl(38_90%_58%)]',
    retry: 'bg-[color-mix(in_srgb,hsl(38_90%_58%)_55%,var(--color-rate-hard)_45%)]',
  },
  terracotta: {
    pending: 'bg-[hsl(12_70%_60%)]/25',
    current: 'bg-[hsl(14_80%_74%)]',
    done: 'bg-[hsl(12_70%_60%)]',
    retry: 'bg-[color-mix(in_srgb,hsl(12_70%_60%)_55%,var(--color-rate-hard)_45%)]',
  },
  sage: {
    pending: 'bg-[hsl(96_30%_56%)]/25',
    current: 'bg-[hsl(96_40%_72%)]',
    done: 'bg-[hsl(96_30%_56%)]',
    retry: 'bg-[color-mix(in_srgb,hsl(96_30%_56%)_55%,var(--color-rate-hard)_45%)]',
  },
  teal: {
    pending: 'bg-[hsl(176_42%_48%)]/25',
    current: 'bg-[hsl(176_50%_66%)]',
    done: 'bg-[hsl(176_42%_48%)]',
    retry: 'bg-[color-mix(in_srgb,hsl(176_42%_48%)_55%,var(--color-rate-hard)_45%)]',
  },
  plum: {
    pending: 'bg-[hsl(322_36%_62%)]/25',
    current: 'bg-[hsl(322_46%_76%)]',
    done: 'bg-[hsl(322_36%_62%)]',
    retry: 'bg-[color-mix(in_srgb,hsl(322_36%_62%)_55%,var(--color-rate-hard)_45%)]',
  },
  clay: {
    pending: 'bg-[hsl(352_62%_68%)]/25',
    current: 'bg-[hsl(352_72%_80%)]',
    done: 'bg-[hsl(352_62%_68%)]',
    retry: 'bg-[color-mix(in_srgb,hsl(352_62%_68%)_55%,var(--color-rate-hard)_45%)]',
  },
  moss: {
    pending: 'bg-[hsl(70_44%_48%)]/25',
    current: 'bg-[hsl(70_52%_66%)]',
    done: 'bg-[hsl(70_44%_48%)]',
    retry: 'bg-[color-mix(in_srgb,hsl(70_44%_48%)_55%,var(--color-rate-hard)_45%)]',
  },
  dusk: {
    pending: 'bg-[hsl(208_40%_60%)]/25',
    current: 'bg-[hsl(208_52%_76%)]',
    done: 'bg-[hsl(208_40%_60%)]',
    retry: 'bg-[color-mix(in_srgb,hsl(208_40%_60%)_55%,var(--color-rate-hard)_45%)]',
  },
}

const NEUTRAL_ACCENT_TONE_CLASS: AccentToneClass = {
  pending: 'bg-stage-ink/20',
  current: 'bg-stage-ink',
  done: 'bg-stage-muted',
  retry: 'bg-rate-hard/90',
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

const PALACE_AMBIENT_HSL: Record<(typeof PALACE_ACCENT_KEYS)[number], string> = {
  honey: '38 90% 58%',
  terracotta: '12 70% 60%',
  sage: '96 30% 56%',
  teal: '176 42% 48%',
  plum: '322 36% 62%',
  clay: '352 62% 68%',
  moss: '70 44% 48%',
  dusk: '208 40% 60%',
}

/** Raw `H S% L%` of the palace accent, for the feed's per-card ambient glow. Neutral = lamp amber. */
export function palaceAmbientHsl(palaceId: number | null): string {
  const accent = palaceAccent(palaceId)
  return accent === 'neutral' ? '32 94% 60%' : PALACE_AMBIENT_HSL[accent]
}

/** Ambient glow for any feed card; cards without a palace fall back to the lamp amber. */
export function cardAmbientHsl(card: object): string {
  const value = (card as { palace_id?: unknown }).palace_id
  return palaceAmbientHsl(typeof value === 'number' ? value : null)
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
 *
 * The static `shadow-[...]` glow is deliberately absent: `progress-rail-breath`
 * animates `filter`/`transform` to own the glow radius, and a static box-shadow
 * cannot breathe with it.
 */
export function progressSegmentShapeClass(
  tone: FreestyleSegmentTone,
  viewing = false,
): string {
  if (viewing || tone === 'current') {
    return 'h-3.5 min-w-[6px] ring-2 ring-stage-ink'
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
  if (isReviewHintCard(card)) return '提示'
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
  const compressed = new Set((roundPlan.compressedIds ?? []).map((id) => String(id || '').trim()).filter(Boolean))
  const seen = new Set<string>()
  const ids: string[] = []
  for (const raw of roundPlan.orderIds) {
    const id = String(raw || '').trim()
    if (!id || seen.has(id) || compressed.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  for (const card of cards) {
    const id = String(card.id || '').trim()
    if (!id || seen.has(id) || compressed.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  // Plan-first ordering parks the plan-external yellow hint at the tail —
  // seat it immediately before the first formal review unit instead.
  const hintIndex = ids.indexOf(FREESTYLE_REVIEW_HINT_ID)
  if (hintIndex >= 0) {
    const firstReview = cards.find(
      (card) => card.type === 'mindmap_branch' && 'unit_id' in card && Boolean(card.unit_id),
    )
    const reviewIndex = firstReview ? ids.indexOf(String(firstReview.id)) : -1
    if (reviewIndex >= 0 && hintIndex > reviewIndex) {
      ids.splice(hintIndex, 1)
      ids.splice(ids.indexOf(String(firstReview?.id || '')), 0, FREESTYLE_REVIEW_HINT_ID)
    }
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
  if (segment.removed) {
    return segment.viewing || segment.tone === 'current' ? '当前 · 已移出队列' : '已移出队列'
  }
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
  const drawnRemovalUnits = new Set<string>()

  // Visual only: keep completed/retry/removed ticks after the live feed drops them.
  for (const id of progressIds(cards, roundPlan)) {
    const planEntry = roundPlan?.cardsById[id]
    if (planEntry?.status === 'excluded') {
      const card = liveById.get(id)
      const retryKind = card ? isRetryOccurrence(card) : planEntry.occurrenceKind === 'retry'
      const sourceId = card ? sourceCardId(card) : (planEntry.sourceCardId || id)
      if (!retryKind) {
        const unit = reviewUnitIdFromCardId(id)
        if (unit && drawnRemovalUnits.has(unit)) continue
        if (unit) drawnRemovalUnits.add(unit)
      }
      segments.push({
        cardId: id,
        tone: 'done',
        palaceId: card ? cardPalaceId(card) : (planEntry.palaceId ?? null),
        palaceDone: false,
        viewing: currentCardId === id,
        removed: true,
        kind: retryKind ? 'retry' : 'source',
        enteredOn: planEntry.enteredOn,
        sourceLabel: card
          ? progressCardLabel(card, cards, roundPlan)
          : snapshotSourceLabel(id, sourceId, planEntry, roundPlan),
        ...(retryKind
          ? {
              retryAttempt: Math.max(
                1,
                Math.round(Number(card && 'retry_attempt' in card ? card.retry_attempt : planEntry.retryAttempt) || 1),
              ),
              sourceCardId: sourceId,
            }
          : {}),
      })
      continue
    }
    if (hidden.has(id)) continue

    const card = liveById.get(id)
    if (card) {
      const sourceId = sourceCardId(card)
      const encounter = encounters[card.id]
      const scored = isOccurrenceScored(card.id, { completedIds, encounters, roundPlan })
      const retryKind = isRetryOccurrence(card)
      if (
        !retryKind
        && !scored
        && isShadowOfQueueRemoval(card.id, roundPlan, 'unit_id' in card ? String(card.unit_id || '') : '')
      ) continue
      const status = visualPlanStatus(
        planCardStatus(card, roundPlan, completedIds, hiddenIds, currentCardId),
        encounter,
        planEntry?.status,
        scored,
      )
      const tone = segmentTone(status)
      if (!tone) continue
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
      } else if (!isReviewHintCard(card)) {
        // The hint counts on the HUD rail but never in scheduledBase plan math.
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

    // A scored card that left the live feed still fills solid. Excluded is handled above.
    const scoredOffFeed = isOccurrenceScored(id, { completedIds, encounters, roundPlan })
    const offFeedRetry = planEntry?.occurrenceKind === 'retry'
    if (!offFeedRetry && !scoredOffFeed && isShadowOfQueueRemoval(id, roundPlan)) continue
    const status = scoredOffFeed ? 'completed' : snapshotPlanStatus(id, planEntry, completed)
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
