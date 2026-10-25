import { request } from '@/shared/api/http'
import { retryWhileBusy } from '@/shared/api/busyRetry'
import { shareInFlightRequest } from '@/shared/api/inFlightRequest'
import { APP_EVENT_NAMES, emitAppEvent } from '@/shared/events/appEvents'
import { detectClientSource } from '@/shared/lib/clientSource'

export type UnitRating = 1 | 2 | 3 | 4

export interface UnitRatingEffectDto {
  rating: UnitRating
  label: string
  passed: boolean
  target_stage_index: number
  /** The real booked gap after this rating, in days. */
  target_interval_days: number
  /** Real gap to target_due_date, including per-unit spread. Optional so a
   * cached PWA client predating this field degrades instead of showing NaN. */
  target_actual_interval_days?: number
  target_due_date: string
  retry_after_cards: number
  /** Same-day wait before the next appearance; null when nothing waits today. */
  retry_after_minutes?: number | null
  /** "retry" for a failed grade, "step" for a first-pass re-check. */
  intraday_kind?: 'retry' | 'step' | null
  intraday_due_at?: string | null
  /** True when the day's retries are used up and the unit moved to tomorrow. */
  intraday_exhausted?: boolean
  stage_action: 'reset' | 'lower' | 'keep' | 'advance'
  /** False when a fill / not-due pass was recorded without moving the schedule. */
  schedule_changed?: boolean
}

export interface UnitReviewEncounterDto {
  id: string
  round_id: string
  sequence: number
  status: 'open' | 'closed'
  selected_rating: UnitRating | null
  passed: boolean | null
  retry_after_cards: number
  effective_operation_id: string | null
  closed_at: string | null
  rating_effects: UnitRatingEffectDto[]
  /** False after another real practice attempt supersedes this one. */
  rating_editable?: boolean
}

export interface ReviewUnitDto {
  id: string
  palace_id: number
  palace_title?: string
  anchor_uid: string
  unit_kind: string
  title: string
  node_uids: string[]
  revision: number
  stage_index: number
  /** Real FSRS interval for this unit, not the retired ladder's nominal value. */
  interval_days: number
  has_passed: boolean
  due_date: string
  due: boolean
  session_status: 'pending' | 'retry' | 'passed'
  retry_count: number
  hard_count: number
  again_count: number
  final_rating: UnitRating | null
  encounter: UnitReviewEncounterDto | null
}

export interface UnitReviewSessionDto {
  id: string
  palace_id: number
  title: string
  status: string
  palace: { id: number; title: string; editor_doc: unknown } | null
  units: ReviewUnitDto[]
  pending_unit_count: number
  completed_unit_count: number
}

export interface UnitRatingResultDto {
  operation_id: string
  study_session_id: string
  encounter_id: string
  amended: boolean
  unit: ReviewUnitDto
  passed: boolean
  retry_after_cards: number
  rating: UnitRating
  rating_label: string
  session_status: ReviewUnitDto['session_status']
  schedule_changed?: boolean
  encounter: UnitReviewEncounterDto
}

export interface CloseUnitEncounterResultDto {
  operation_id: string
  encounter: UnitReviewEncounterDto
  passed: boolean
  retry_after_cards: number
  session_status: string
  completion: UnitReviewCompletionDto | null
}

export interface UndoUnitRatingResultDto {
  operation_id: string
  unit: ReviewUnitDto
  session_status: ReviewUnitDto['session_status']
  encounter: UnitReviewEncounterDto
}

export interface UnitReviewCompletionDto {
  study_session_id: string
  palace_id: number
  completed_unit_count: number
  duration_seconds: number
  hard_retry_count: number
  again_retry_count: number
  next_review_date: string | null
  completed_at: string
}

export interface UnitScheduleSnapshotDto {
  stage_index: number
  interval_days: number
  due_date: string
  has_passed: boolean
}

export interface PalaceUnitProjectionDto {
  palace_id: number
  title: string
  mark_required: boolean
  permanent_mark_count?: number
  unit_count: number
  due_unit_count: number
  next_review_date: string | null
  review_status: string
  units: Array<
    Pick<
      ReviewUnitDto,
      | 'id'
      | 'palace_id'
      | 'anchor_uid'
      | 'unit_kind'
      | 'title'
      | 'node_uids'
      | 'revision'
      | 'stage_index'
      | 'interval_days'
      | 'has_passed'
      | 'due_date'
      | 'due'
    > & { active?: boolean }
  >
}

export interface ReconcilePalaceUnitsResultDto {
  palace_id: number
  mark_required: boolean
  unit_count: number
  changed: boolean
  invalidated_session_count: number
  title?: string
  changes: Array<{
    unit_id: string
    anchor_uid: string
    title: string
    action: string
    before: UnitScheduleSnapshotDto | null
    after: UnitScheduleSnapshotDto | null
  }>
  undo_token: string | null
  schedule_batch_id: string | null
}

export interface AdjustUnitSchedulePayload {
  operation_id: string
  stage_index?: number
  due_date?: string
  has_passed?: boolean
  reason?: string
}

export interface AdjustUnitScheduleResultDto {
  operation_id: string
  reason: string
  unit: PalaceUnitProjectionDto['units'][number]
  before: UnitScheduleSnapshotDto
  after: UnitScheduleSnapshotDto
  invalidated_session_count: number
  palace: {
    palace_id: number
    title: string
    unit_count: number
    due_unit_count: number
    next_review_date: string | null
    review_status: string
    mark_required: boolean
  }
}

export interface UndoContentScheduleBatchResultDto {
  batch_id: string
  undo_token: string
  palace_id: number
  operation_id: string | null
  restored_count: number
  restored: Array<{
    unit_id: string
    anchor_uid: string
    after: UnitScheduleSnapshotDto
  }>
  invalidated_session_count: number
}

export async function getDueReviewUnitsApi() {
  const response = await request<{ items: ReviewUnitDto[] }>('/review/queue')
  return response.items
}

export async function getPalaceReviewUnitsApi(palaceId: number) {
  const response = await request<{ item: PalaceUnitProjectionDto }>(`/review/palaces/${palaceId}/units`)
  return response.item
}

export type LadderProgressRange = 'today' | 'last3days' | 'week' | 'all'

export interface LadderStageStatsDto {
  stage_index: number
  interval_days: number
  pass_count: number
  last_at: string | null
  seconds: number
}

export interface LadderRangeStatsDto {
  range: LadderProgressRange
  per_stage: LadderStageStatsDto[]
  total_reviews: number
  total_seconds: number
  rating_share: {
    forgot: number
    hard: number
    remember: number
    easy: number
  }
}

export interface LadderLearningSummaryDto {
  range: LadderProgressRange
  unit_count: number
  total_seconds: number
  freestyle_rating_count: number
  quiz_count: number
}

/** Due-date buckets shown in the toolbar strip; ordered nearest-first. */
export type DueHorizonKey = 'today' | 'd3' | 'week' | 'month' | 'later'

export interface PalaceLadderProgressDto {
  palace_id: number
  title: string
  ladder: number[]
  scope: 'unit' | 'palace'
  current: {
    unit_id: string
    title: string
    stage_index: number
    interval_days: number
    due_date: string | null
    due: boolean
    has_passed: boolean
    /** Due-horizon bucket of this unit, computed against the server study day. */
    horizon?: DueHorizonKey | null
  } | null
  palace: {
    unit_count: number
    due_count: number
    weakest_stage_index: number | null
    stage_histogram: number[]
    /** Active units per due-date horizon; the toolbar's distribution strip. */
    due_horizon?: Record<DueHorizonKey, number>
    next_review_date: string | null
    review_status: string
    mark_required: boolean
  }
  unit_range_stats: LadderRangeStatsDto
  palace_range_stats: LadderRangeStatsDto
  selected_range_summary: LadderLearningSummaryDto
  palace_all_time_summary: LadderLearningSummaryDto
}

export async function getPalaceLadderProgressApi(
  palaceId: number,
  options?: { range?: LadderProgressRange; unitId?: string | null },
) {
  const searchParams = new URLSearchParams()
  searchParams.set('range', options?.range ?? 'all')
  if (options?.unitId) searchParams.set('unit_id', options.unitId)
  const query = searchParams.toString()
  // Several cards and panels mount this widget for the same palace+range during a
  // feed open; sharing the identical request keeps each duplicate from holding a
  // pooled database connection at the same time.
  const response = await shareInFlightRequest(
    `palace:${palaceId}:ladder-progress:${query}`,
    () =>
      request<{ item: PalaceLadderProgressDto }>(
        `/review/palaces/${palaceId}/ladder-progress?${query}`,
      ),
  )
  return response.item
}

export async function reconcilePalaceUnitsApi(palaceId: number) {
  const response = await request<{ item: ReconcilePalaceUnitsResultDto }>(
    `/review/palaces/${palaceId}/units/reconcile`,
    { method: 'POST' },
  )
  emitAppEvent(APP_EVENT_NAMES.palaceCatalogInvalidated)
  emitAppEvent(APP_EVENT_NAMES.reviewStateChanged)
  return response.item
}

export async function adjustUnitScheduleApi(unitId: string, payload: AdjustUnitSchedulePayload) {
  const response = await request<{ item: AdjustUnitScheduleResultDto }>(`/review/units/${unitId}/schedule`, {
    method: 'PATCH',
    body: JSON.stringify({
      operation_id: payload.operation_id,
      stage_index: payload.stage_index,
      due_date: payload.due_date,
      has_passed: payload.has_passed,
      reason: payload.reason ?? 'manual_adjust',
    }),
    persistence: {
      resourceKey: `review-unit-schedule-adjust:${payload.operation_id}`,
      description: 'Adjust review unit schedule',
      replayMode: 'auto',
    },
  })
  emitAppEvent(APP_EVENT_NAMES.palaceCatalogInvalidated)
  emitAppEvent(APP_EVENT_NAMES.reviewStateChanged)
  return response.item
}

export async function undoContentScheduleBatchApi(
  palaceId: number,
  batchId: string,
  operationId?: string,
) {
  const response = await request<{ item: UndoContentScheduleBatchResultDto }>(
    `/review/palaces/${palaceId}/schedule-batches/${batchId}/undo`,
    {
      method: 'POST',
      body: JSON.stringify(operationId ? { operation_id: operationId } : {}),
      persistence: operationId
        ? {
            resourceKey: `review-schedule-batch-undo:${operationId}`,
            description: 'Undo content schedule batch',
            replayMode: 'auto',
          }
        : undefined,
    },
  )
  emitAppEvent(APP_EVENT_NAMES.palaceCatalogInvalidated)
  emitAppEvent(APP_EVENT_NAMES.reviewStateChanged)
  return response.item
}

/**
 * A lock wait on this machine can outlast 15s and still succeed. Aborting at
 * 15s threw that work away, then the card started a second glance and showed a
 * red error. 45s covers the server's busy wait; the card keeps the map up.
 * Scoring does not wait on this call.
 */
export const SESSION_START_TIMEOUT_MS = 45_000

export async function startFreestyleUnitReviewSessionApi(
  unit: Pick<ReviewUnitDto, 'id' | 'revision'>,
  roundId: string,
  encounterId: string,
  options?: {
    allowNotDue?: boolean
    cardId?: string
    occurrenceId?: string
    retryAttempt?: number
    onBusyRetry?: (attempt: number) => void
  },
) {
  // Opening the encounter is idempotent server-side: the same encounter_id
  // returns the existing open encounter instead of stacking a second one. That
  // makes a bounded retry safe, and it is what keeps a contended card from
  // becoming a dead banner the learner has to repair by hand.
  //
  // Measured 2026-10-07: this exact endpoint answered `database is locked` (500)
  // and `storage busy` (503) while the write lock was held elsewhere. Previously
  // every one of those ended at the same 重试 button, and retrying by hand
  // re-entered the same contention.
  //
  // One X-Request-ID spans every attempt, so the server log shows one action
  // rather than N unrelated requests.
  const payload = JSON.stringify({
    unit_revision: unit.revision,
    round_id: roundId,
    encounter_id: encounterId,
    clientSource: detectClientSource(),
    allow_not_due: Boolean(options?.allowNotDue),
    card_id: options?.cardId,
    occurrence_id: options?.occurrenceId,
    retry_attempt: options?.retryAttempt,
  })
  const response = await retryWhileBusy(
    (headers) => request<{ item: UnitReviewSessionDto }>(`/review/units/${unit.id}/sessions`, {
      method: 'POST',
      body: payload,
      headers,
      // Deliberately not queued as a mutation: a stale replay would reopen an
      // encounter the user moved past. The bounded retry above covers the busy
      // case without that risk.
      timeoutMs: SESSION_START_TIMEOUT_MS,
      persistence: false,
    }),
    { onRetry: options?.onBusyRetry },
  )
  return response.item
}

export async function openUnitReviewEncounterApi(
  sessionId: string,
  unit: Pick<ReviewUnitDto, 'id' | 'revision'>,
  roundId: string,
  encounterId: string,
) {
  const response = await request<{ item: UnitReviewSessionDto }>(
    `/review/session/${sessionId}/units/${unit.id}/encounters`,
    {
      method: 'POST',
      body: JSON.stringify({
        unit_revision: unit.revision,
        round_id: roundId,
        encounter_id: encounterId,
      }),
    },
  )
  return response.item
}

export async function getUnitReviewSessionApi(id: string, encounterId?: string) {
  const query = encounterId ? `?encounter_id=${encodeURIComponent(encounterId)}` : ''
  const response = await request<{ item: UnitReviewSessionDto }>(`/review/session/${id}${query}`)
  return response.item
}

/** Read-only: same shape as a session, `encounter: null`, never opens anything server-side. */
export async function getUnitReviewPreviewApi(unitId: string, options?: { signal?: AbortSignal }) {
  const response = await request<{ item: UnitReviewSessionDto }>(
    `/review/units/${encodeURIComponent(unitId)}/preview`,
    { signal: options?.signal },
  )
  return response.item
}

export interface PalaceDueRatingCurrentPayload {
  study_session_id: string
  unit_id: string
  unit_revision: number
  encounter_id: string
}

export interface PalaceDueRatingResultDto {
  batch_id: string
  palace_id: number
  rating: UnitRating
  items: UnitRatingResultDto[]
  rated_unit_ids: string[]
  remaining_due_count: number
  current: UnitRatingResultDto | null
}

export async function ratePalaceDueUnitsApi(
  palaceId: number,
  payload: {
    operationId: string
    rating: UnitRating
    roundId: string
    current: PalaceDueRatingCurrentPayload
    excludeUnitIds: string[]
    includeUnitIds?: string[]
  },
) {
  const response = await request<{ item: PalaceDueRatingResultDto }>(
    `/review/palaces/${palaceId}/due-units/ratings`,
    {
      method: 'POST',
      body: JSON.stringify({
        operation_id: payload.operationId,
        rating: payload.rating,
        round_id: payload.roundId,
        current: payload.current,
        exclude_unit_ids: payload.excludeUnitIds,
        include_unit_ids: payload.includeUnitIds ?? [],
      }),
      // A rating is never replayed in the background: a failure is shown to the
      // learner immediately and they decide whether to press again.
      persistence: false,
    },
  )
  emitAppEvent(APP_EVENT_NAMES.palaceCatalogInvalidated)
  emitAppEvent(APP_EVENT_NAMES.reviewStateChanged)
  return response.item
}

export async function rateReviewUnitApi(
  sessionId: string,
  unit: Pick<ReviewUnitDto, 'id' | 'revision'>,
  encounterId: string,
  rating: UnitRating,
  operationId: string,
  roundId?: string,
) {
  const response = await request<{ item: UnitRatingResultDto }>(
    `/review/session/${sessionId}/units/${unit.id}/ratings`,
    {
      method: 'POST',
      body: JSON.stringify({
        unit_revision: unit.revision,
        encounter_id: encounterId,
        operation_id: operationId,
        ...(roundId ? { round_id: roundId } : {}),
        rating,
      }),
      persistence: false,
    },
  )
  emitAppEvent(APP_EVENT_NAMES.palaceCatalogInvalidated)
  emitAppEvent(APP_EVENT_NAMES.reviewStateChanged)
  return response.item
}

export async function closeUnitReviewEncounterApi(
  sessionId: string,
  unitId: string,
  encounterId: string,
  operationId: string,
  roundId?: string,
) {
  const response = await request<{ item: CloseUnitEncounterResultDto }>(
    `/review/session/${sessionId}/units/${unitId}/encounters/${encounterId}/close`,
    {
      method: 'POST',
      body: JSON.stringify({
        operation_id: operationId,
        ...(roundId ? { round_id: roundId } : {}),
      }),
      persistence: false,
    },
  )
  emitAppEvent(APP_EVENT_NAMES.palaceCatalogInvalidated)
  emitAppEvent(APP_EVENT_NAMES.reviewStateChanged)
  return response.item
}

export async function cancelUnratedUnitReviewEncounterApi(
  sessionId: string,
  unitId: string,
  encounterId: string,
) {
  const response = await request<{
    item: {
      session_status: string
      cancelled: boolean
      abandoned?: boolean
      study_session_id?: string
      reason?: string
    }
  }>(
    `/review/session/${sessionId}/units/${unitId}/encounters/${encounterId}/cancel`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
  )
  return response.item
}

export async function removeReviewUnitPermanentlyApi(unitId: string) {
  const response = await request<{ item: { unit_id: string } }>(
    `/review/units/${encodeURIComponent(unitId)}/remove-permanently`,
    {
      method: 'POST',
      persistence: {
        resourceKey: `review-unit-remove-permanently:${unitId}`,
        description: 'Remove review unit permanently',
        replayMode: 'auto',
      },
    },
  )
  emitAppEvent(APP_EVENT_NAMES.palaceCatalogInvalidated)
  emitAppEvent(APP_EVENT_NAMES.reviewStateChanged)
  return response.item
}

export async function undoReviewUnitRatingApi(operationId: string, roundId?: string) {
  const response = await request<{ item: UndoUnitRatingResultDto }>(`/review/ratings/${operationId}/undo`, {
    method: 'POST',
    body: JSON.stringify(roundId ? { round_id: roundId } : {}),
  })
  emitAppEvent(APP_EVENT_NAMES.palaceCatalogInvalidated)
  return response.item
}

export type PalaceUnitRatingDto = { rating: number; operation_id: string; revision: number }

/** Each active unit's current live rating, keyed by unit id. Read-only. */
export function listPalaceUnitRatingsApi(palaceId: number) {
  return request<{ items: Record<string, PalaceUnitRatingDto> }>(
    `/review/palaces/${palaceId}/unit-ratings`,
  ).then((response) => response.items ?? {})
}

/**
 * Change a unit's one rating (the same rating 正式复习 and 随心 share), rescheduling it.
 * `expectedRevision` is the revision the learner saw; a stale one is refused.
 */
/**
 * Set one rating on several units of a palace, all or nothing. Used by the L1 →
 * descendant-mark cascade. The 随心 queue is told to refresh (`roundRefresh`), since
 * these due dates are what the queue is built from.
 */
export async function rerateReviewUnitsApi(
  palaceId: number,
  rating: UnitRating,
  items: Array<{ unitId: string; expectedRevision: number; operationId: string }>,
) {
  const response = await request<{ item: { items: UnitRatingResultDto[] } }>(
    `/review/palaces/${palaceId}/unit-ratings/rerate`,
    {
      method: 'POST',
      body: JSON.stringify({
        rating,
        items: items.map((item) => ({
          unit_id: item.unitId,
          expected_revision: item.expectedRevision,
          operation_id: item.operationId,
        })),
      }),
      persistence: false,
    },
  )
  emitAppEvent(APP_EVENT_NAMES.palaceCatalogInvalidated)
  emitAppEvent(APP_EVENT_NAMES.reviewStateChanged, { roundRefresh: true })
  return response.item.items
}
