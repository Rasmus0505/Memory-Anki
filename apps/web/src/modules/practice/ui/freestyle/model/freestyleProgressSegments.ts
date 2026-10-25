import {
  cardPalaceId,
  isRetryOccurrence,
  reviewUnitIdFromCardId,
  sourceCardId,
  type FreestyleUnitEncounterState,
} from '@/modules/practice/domain/queueState'
import {
  isOccurrenceScored,
} from '@/modules/practice/domain/unitProgressState'
import {
  planCardStatus,
  type FreestyleRoundPlanCard,
  type FreestyleRoundPlanCardStatus,
  type FreestyleRoundPlanState,
} from '@/modules/practice/domain/roundPlan'
import { cardSettledOut, settledIdSet } from '@/modules/practice/domain/roundPlanCompress'
import type { FreestyleCard } from '@/shared/api/contracts'
import { FREESTYLE_REVIEW_HINT_ID, isReviewHintCard } from '@/shared/api/contracts'
import { palaceAccentToneClass } from '@/modules/practice/ui/freestyle/model/freestylePalaceAccent'

export type FreestyleSegmentTone = 'done' | 'retry' | 'current' | 'pending'

const EMPTY_UNSAVED_IDS: ReadonlySet<string> = new Set()

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
  /** True on the first source tick of a new entry day, so the rail can cut every day. */
  cohortBoundary?: boolean
  enteredOn?: string
  /** Unit has never passed (新学, blue). Otherwise it is a review (复习, amber). */
  isNew?: boolean
  /** Quiz question tick (题目, green). Overrides the new/review hue. */
  isQuiz?: boolean
  /** 睡前复习 tick: marked with a moon; its grade never reschedules. */
  bedtime?: boolean
}

/**
 * Rail colour is only ever one of two hues: 新学 blue or 复习 amber.
 * Palace identity is not on the rail any more. Tone is fill strength.
 */
const RAIL_ACCENT_CLASS: Record<'new' | 'review', Record<FreestyleSegmentTone, string>> = {
  new: {
    pending: 'bg-[hsl(214_84%_62%)]/25',
    retry: 'bg-[hsl(214_84%_62%)]/60',
    current: 'bg-[hsl(214_90%_76%)]',
    done: 'bg-[hsl(214_84%_62%)]',
  },
  review: {
    pending: 'bg-rate-hard/25',
    retry: 'bg-rate-hard/60',
    current: 'bg-[hsl(40_96%_72%)]',
    done: 'bg-rate-hard',
  },
}

/** Quiz question tick: green, so it reads apart from the blue/amber unit ticks. */
const QUIZ_ACCENT_CLASS: Record<FreestyleSegmentTone, string> = {
  pending: 'bg-rate-good/25',
  retry: 'bg-rate-good/60',
  current: 'bg-[hsl(145_60%_72%)]',
  done: 'bg-rate-good',
}

/**
 * Fill class for one rail tick: green for a quiz question, blue when the unit
 * is new, amber when it is a review.
 */
export function progressSegmentAccentClass(
  isNew: boolean | undefined,
  tone: FreestyleSegmentTone,
  isQuiz = false,
): string {
  if (isQuiz) return QUIZ_ACCENT_CLASS[tone]
  return RAIL_ACCENT_CLASS[isNew ? 'new' : 'review'][tone]
}

/**
 * Retry occurrence circle: same colour as its source tick.
 * Unfinished is faint, completed is solid.
 * Viewing size is separate (`progressSegmentShapeClass` / node size).
 */
export function retryNodeToneClass(
  tone: FreestyleSegmentTone,
  isNew = false,
  isQuiz = false,
): string {
  const fill = progressSegmentAccentClass(isNew, tone === 'done' ? 'done' : 'pending', isQuiz)
  return tone === 'done' ? `${fill} text-stage` : `${fill} text-stage-ink`
}

function isNewUnit(
  card: FreestyleCard | undefined,
  ...entries: Array<{ isNew?: boolean } | undefined>
): boolean {
  if (entries.some((entry) => entry?.isNew === true)) return true
  return Boolean(card && 'is_new' in card && card.is_new === true)
}

function isQuizTick(
  card: FreestyleCard | undefined,
  entry: { kind?: string } | undefined,
): boolean {
  return card?.type === 'quiz_question' || entry?.kind === 'quiz_question'
}

/** Card badge / 本轮安排 row chrome for a retry occurrence. */
export function retryChromeClass(done: boolean): string {
  return done
    ? 'border-rate-good/40 bg-rate-good/12 text-rate-good'
    : 'border-rate-hard/50 bg-rate-hard/90 text-stage'
}

/**
 * 本轮安排 row status pill for source rows. The only status colour map for plan rows: palace
 * colour is never used here. Retry rows use `retryChromeClass` directly, so the amber lives in one place.
 */
export function planStatusChromeClass(status: FreestyleRoundPlanCardStatus): string {
  switch (status) {
    case 'completed':
      return 'border-rate-good/30 bg-rate-good/8 text-rate-good'
    case 'active':
      return 'border-primary/60 bg-primary/10 text-primary'
    case 'retry':
      return retryChromeClass(false)
    case 'stale':
      return 'border-rate-again/35 bg-rate-again/10 text-rate-again'
    case 'excluded':
      return 'border-border/50 bg-muted/50 text-muted-foreground line-through'
    default:
      return 'border-border/60 text-muted-foreground'
  }
}

/**
 * Palace identity stripe: the solid palace colour, the same for every status.
 * Status is shown by the row chrome, never by this stripe.
 */
export function palaceIdentityClass(palaceId: number | null): string {
  return palaceAccentToneClass(palaceId, 'done')
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

export {
  cardAmbientHsl,
  palaceAccent,
  palaceAccentToneClass,
  palaceAmbientHsl,
  type PalaceAccentKey,
} from '@/modules/practice/ui/freestyle/model/freestylePalaceAccent'

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
/** Hit width of a day cut. The drawn stroke is narrower; this keeps it tappable. */
export const PROGRESS_RAIL_DAY_LINE_PX = 12
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
    if (segment.cohortBoundary) fixed += PROGRESS_RAIL_DAY_LINE_PX
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
  // Live cards first, in swipe order. Then walk roundPlan.orderIds so a scored
  // card that left the feed still paints until the learner settles. A 结算
  // drops the source and its retry siblings. An unscored or removed id that
  // already left the feed must not light a tick the learner cannot reach.
  const compressed = settledIdSet(roundPlan?.compressedIds)
  const seen = new Set<string>()
  const ids: string[] = []
  for (const card of cards) {
    const id = String(card.id || '').trim()
    if (!id || seen.has(id) || cardSettledOut(card, compressed)) continue
    seen.add(id)
    ids.push(id)
  }
  const orderIds = roundPlan?.orderIds ?? []
  for (const id of orderIds) {
    if (!id || seen.has(id)) continue
    const entry = roundPlan?.cardsById[id]
    if (!entry) continue
    if (cardSettledOut({ id, source_card_id: entry.sourceCardId }, compressed)) continue
    if (entry.status === 'excluded') continue
    // An unfinished retry that already left the feed is not a score. Only a
    // scored row stays lit until the learner settles.
    const scored = entry.status === 'completed' || entry.lastRating != null
    if (!scored) continue
    let insertAt = ids.length
    const planIndex = orderIds.indexOf(id)
    for (let later = planIndex + 1; later < orderIds.length; later += 1) {
      const at = ids.indexOf(orderIds[later] ?? '')
      if (at >= 0) {
        insertAt = at
        break
      }
    }
    ids.splice(insertAt, 0, id)
    seen.add(id)
  }
  // Seat the yellow hint immediately before the first formal review unit.
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

const DAY_MS = 86_400_000

/** Local calendar day, not an instant. Invalid keys stay unlabeled. */
export function parseDayKey(value: string | undefined): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return date
}

/** How many midnights `today` is after `enteredOn`. Negative means a future stamp. */
export function daysBefore(enteredOn: string | undefined, today: string): number | null {
  const from = parseDayKey(enteredOn)
  const to = parseDayKey(today)
  if (!from || !to) return null
  return Math.round((to.getTime() - from.getTime()) / DAY_MS)
}

/**
 * Spoken day, anchored to the learner's today — not "欠账 / 今天新增".
 * Far days use a date so "12天前" does not have to be counted on the fingers.
 */
export function dayCohortLabel(enteredOn: string | undefined, today: string): string {
  const distance = daysBefore(enteredOn, today)
  const date = parseDayKey(enteredOn)
  if (distance == null || !date) return '更早留下的'
  if (distance === 0) return '今天'
  if (distance === 1) return '昨天'
  if (distance === 2) return '前天'
  if (distance > 2 && distance <= 6) return `${distance}天前`
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

/** Inclusive calendar span from the earliest entry day through today. One day stays 1. */
export function roundDaySpan(enteredOns: Iterable<string | undefined>, today: string): number {
  const todayDate = parseDayKey(today)
  if (!todayDate) return 1
  let earliest: Date | null = null
  for (const value of enteredOns) {
    const date = parseDayKey(value)
    if (!date || date.getTime() > todayDate.getTime()) continue
    if (!earliest || date.getTime() < earliest.getTime()) earliest = date
  }
  if (!earliest) return 1
  return Math.round((todayDate.getTime() - earliest.getTime()) / DAY_MS) + 1
}

export function dayRemainingCount(
  segments: readonly FreestyleProgressSegment[],
  enteredOn: string,
): number {
  return segments.filter((segment) => segment.enteredOn === enteredOn && segment.tone !== 'done').length
}

/** Hover for the day cut itself: which day, what's left, and that a click jumps. */
export function dayCutHoverLabel(
  enteredOn: string | undefined,
  today: string,
  remaining: number,
): string {
  const name = dayCohortLabel(enteredOn, today)
  const left = remaining > 0 ? `还剩 ${remaining} 张` : '都过了'
  return `${name} · ${left} · 点此跳到这一天的第一张`
}

/**
 * A cut wherever the queue steps into another entry day.
 * Retry insertions keep their source day but do not punch a new cut into the middle of a day.
 */
export function markDayCohortBoundaries(segments: FreestyleProgressSegment[]): void {
  let previous = ''
  for (const segment of segments) {
    if (segment.kind === 'retry') continue
    const day = String(segment.enteredOn || '').trim()
    if (!day) continue
    if (previous && day !== previous) segment.cohortBoundary = true
    previous = day
  }
}

/** Hover copy for one rail tick: that card, not the card currently on screen. */
export function progressSegmentHoverLabel(
  segment: FreestyleProgressSegment,
  index: number,
  total: number,
  today = '',
): string {
  const place = total > 0 ? `${index + 1}/${total}` : ''
  const day = today && segment.enteredOn ? dayCohortLabel(segment.enteredOn, today) : ''
  if (segment.kind === 'retry') {
    return [place, retryNodeLabel(segment), segmentStatusLabel(segment), day].filter(Boolean).join(' · ')
  }
  const name = String(segment.sourceLabel || '').trim()
  const titled = name ? `《${name}》` : ''
  return [place, titled, segmentStatusLabel(segment), day].filter(Boolean).join(' · ')
}

/**
 * Fill for one rail tick. A card whose rating was never acknowledged is never
 * filled, whatever the plan echo says: the learner only sees a solid tick for a
 * score the server holds (see `unsavedRatingCardIds`).
 */
function progressTone(
  status: FreestyleRoundPlanCardStatus,
  unsaved: boolean,
): FreestyleSegmentTone | null {
  if (unsaved && status !== 'excluded') return 'pending'
  return segmentTone(status)
}

export function buildFreestyleProgressSummary(
  cards: FreestyleCard[],
  roundPlan: FreestyleRoundPlanState | null,
  completedIds: string[],
  hiddenIds: string[],
  currentCardId: string | null,
  encounters: Record<string, FreestyleUnitEncounterState> = {},
  /** Ratings tapped but not yet saved: unfilled until the outbox acknowledges them. */
  unsavedCardIds: ReadonlySet<string> = EMPTY_UNSAVED_IDS,
): FreestyleProgressSummary {
  const completed = new Set(completedIds.map(String))
  const hidden = new Set(hiddenIds.map(String))
  const liveById = new Map(cards.map((card) => [String(card.id), card]))
  const segments: FreestyleProgressSegment[] = []
  const baseItems: Array<{ id: string; sourceId: string }> = []
  let retryInserted = 0
  const passedSources = new Set<string>()
  const drawnRemovalUnits = new Set<string>()

  // Live cards, plus scored ledger rows that left the feed until 结算.
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
        bedtime: card?.type === 'mindmap_branch' && card.bedtime === true,
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
    if (!card) {
      if (!planEntry || hidden.has(id)) continue
      const retryKind = planEntry.occurrenceKind === 'retry'
      const sourceId = planEntry.sourceCardId || id
      const encounter = encounters[id]
      const scored = isOccurrenceScored(id, { completedIds, encounters, roundPlan })
      const status = visualPlanStatus(planEntry.status, encounter, planEntry.status, scored)
      const unsaved = unsavedCardIds.has(id)
      const tone = progressTone(status, unsaved)
      if (!tone) continue
      segments.push({
        cardId: id,
        tone,
        palaceId: planEntry.palaceId ?? null,
        palaceDone: false,
        viewing: currentCardId === id,
        kind: retryKind ? 'retry' : 'source',
        enteredOn: planEntry.enteredOn,
        sourceLabel: snapshotSourceLabel(id, sourceId, planEntry, roundPlan),
        ...(retryKind
          ? {
              retryAttempt: Math.max(1, Math.round(Number(planEntry.retryAttempt) || 1)),
              sourceCardId: sourceId,
            }
          : {
              waitingRetry: planEntry.status === 'retry' && !scored,
              ...(planEntry.status === 'retry'
                ? { retryAfterCards: Math.max(0, Math.round(Number(planEntry.retryAfterCards) || 0)) }
                : {}),
            }),
      })
      if (retryKind) retryInserted += 1
      else baseItems.push({ id, sourceId })
      if (!unsaved && (tone === 'done' || completed.has(id) || completed.has(sourceId) || scored)) {
        passedSources.add(sourceId || id)
      }
      continue
    }
    if (card) {
      const sourceId = sourceCardId(card)
      const encounter = encounters[card.id]
      const scored = isOccurrenceScored(card.id, { completedIds, encounters, roundPlan })
      const retryKind = isRetryOccurrence(card)
      const status = visualPlanStatus(
        planCardStatus(card, roundPlan, completedIds, hiddenIds, currentCardId),
        encounter,
        planEntry?.status,
        scored,
      )
      const unsaved = unsavedCardIds.has(card.id)
      const tone = progressTone(status, unsaved)
      if (!tone) continue
      const waitingRetry = !retryKind && planEntry?.status === 'retry'
      segments.push({
        cardId: card.id,
        tone,
        palaceId: cardPalaceId(card),
        palaceDone: false,
        viewing: currentCardId === card.id,
        bedtime: card.type === 'mindmap_branch' && card.bedtime === true,
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
        !unsaved
        && (
          tone === 'done'
          || completed.has(card.id)
          || completed.has(sourceId)
        )
      ) {
        passedSources.add(sourceId || card.id)
      }
      continue
    }
  }

  collapseRetrySegments(segments)
  retryInserted = segments.filter((segment) => segment.kind === 'retry').length

  markDayCohortBoundaries(segments)

  // A retry takes its source's newness, so the whole family of one unit shares one hue.
  for (const segment of segments) {
    const live = liveById.get(segment.cardId)
    const entry = roundPlan?.cardsById[segment.cardId]
    segment.isNew = isNewUnit(
      live,
      entry,
      roundPlan?.cardsById[segment.sourceCardId || segment.cardId],
    )
    segment.isQuiz = isQuizTick(live, entry)
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
 * Spoken name for the rail. Segment clicks jump when `canJump`; the count and
 * an empty rail still open 本轮安排, so that action stays in the empty label.
 */
export function progressRailLabel(summary: FreestyleProgressSummary, canJump = false): string {
  if (summary.total === 0) return '本轮暂无安排。点击查看本轮安排'
  const position = summary.position > 0
    ? `本轮进度 ${summary.position}/${summary.total}`
    : `本轮共 ${summary.total} 张`
  const action = canJump ? '点击分段跳转到对应卡片' : '点击查看本轮安排'
  return `${position}。${action}`
}
