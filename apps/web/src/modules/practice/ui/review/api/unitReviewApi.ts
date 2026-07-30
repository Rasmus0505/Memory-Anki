import { request } from '@/shared/api/http'
import { APP_EVENT_NAMES, emitAppEvent } from '@/shared/events/appEvents'
import { detectClientSource } from '@/shared/lib/clientSource'

export type UnitRating = 1 | 2 | 3 | 4

export interface UnitRatingEffectDto {
  rating: UnitRating
  label: string
  passed: boolean
  target_stage_index: number
  target_interval_days: number
  target_due_date: string
  retry_after_cards: number
  stage_action: 'reset' | 'lower' | 'keep' | 'advance'
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
  effective_seconds?: number | null
  closed_at: string | null
  rating_effects: UnitRatingEffectDto[]
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
  } | null
  palace: {
    unit_count: number
    due_count: number
    weakest_stage_index: number | null
    stage_histogram: number[]
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
  const response = await request<{ item: PalaceLadderProgressDto }>(
    `/review/palaces/${palaceId}/ladder-progress?${searchParams.toString()}`,
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

export async function startUnitReviewSessionApi(palaceId: number) {
  const response = await request<{ item: UnitReviewSessionDto }>(`/review/palaces/${palaceId}/sessions`, {
    method: 'POST',
    body: JSON.stringify({
      clientSource: detectClientSource(),
    }),
  })
  return response.item
}

export async function startFreestyleUnitReviewSessionApi(
  unit: Pick<ReviewUnitDto, 'id' | 'revision'>,
  roundId: string,
  encounterId: string,
  options?: { allowNotDue?: boolean },
) {
  const response = await request<{ item: UnitReviewSessionDto }>(`/review/units/${unit.id}/sessions`, {
    method: 'POST',
    body: JSON.stringify({
      unit_revision: unit.revision,
      round_id: roundId,
      encounter_id: encounterId,
      clientSource: detectClientSource(),
      allow_not_due: Boolean(options?.allowNotDue),
    }),
  })
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

export async function getUnitReviewSessionApi(id: string) {
  const response = await request<{ item: UnitReviewSessionDto }>(`/review/session/${id}`)
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
      persistence: { resourceKey: `review-unit-rate:${operationId}`, description: 'Rate review unit', replayMode: 'auto' },
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
  effectiveSeconds?: number,
  roundId?: string,
) {
  const response = await request<{ item: CloseUnitEncounterResultDto }>(
    `/review/session/${sessionId}/units/${unitId}/encounters/${encounterId}/close`,
    {
      method: 'POST',
      body: JSON.stringify({
        operation_id: operationId,
        ...(roundId ? { round_id: roundId } : {}),
        ...(effectiveSeconds == null ? {} : { effective_seconds: Math.max(0, Math.round(effectiveSeconds)) }),
      }),
      persistence: {
        resourceKey: `review-unit-encounter-close:${operationId}`,
        description: 'Close review unit encounter',
        replayMode: 'auto',
      },
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

export async function undoReviewUnitRatingApi(operationId: string, roundId?: string) {
  const response = await request<{ item: UndoUnitRatingResultDto }>(`/review/ratings/${operationId}/undo`, {
    method: 'POST',
    body: JSON.stringify(roundId ? { round_id: roundId } : {}),
  })
  emitAppEvent(APP_EVENT_NAMES.palaceCatalogInvalidated)
  return response.item
}

export async function completeUnitReviewSessionApi(sessionId: string) {
  const response = await request<{ item: UnitReviewCompletionDto }>(`/review/session/${sessionId}/complete`, { method: 'POST' })
  emitAppEvent(APP_EVENT_NAMES.palaceCatalogInvalidated)
  return response.item
}

export async function getUnitReviewCompletionApi(sessionId: string) {
  const response = await request<{ item: UnitReviewCompletionDto }>(`/review/completions/${sessionId}`)
  return response.item
}
