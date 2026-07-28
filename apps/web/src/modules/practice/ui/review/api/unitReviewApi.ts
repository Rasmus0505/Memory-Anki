import { request } from '@/shared/api/http'
import { APP_EVENT_NAMES, emitAppEvent } from '@/shared/events/appEvents'

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

export async function getDueReviewUnitsApi() {
  const response = await request<{ items: ReviewUnitDto[] }>('/review/queue')
  return response.items
}

export async function startUnitReviewSessionApi(palaceId: number) {
  const response = await request<{ item: UnitReviewSessionDto }>(`/review/palaces/${palaceId}/sessions`, { method: 'POST' })
  return response.item
}

export async function startFreestyleUnitReviewSessionApi(
  unit: Pick<ReviewUnitDto, 'id' | 'revision'>,
  roundId: string,
  encounterId: string,
) {
  const response = await request<{ item: UnitReviewSessionDto }>(`/review/units/${unit.id}/sessions`, {
    method: 'POST',
    body: JSON.stringify({
      unit_revision: unit.revision,
      round_id: roundId,
      encounter_id: encounterId,
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
) {
  const response = await request<{ item: UnitRatingResultDto }>(
    `/review/session/${sessionId}/units/${unit.id}/ratings`,
    {
      method: 'POST',
      body: JSON.stringify({
        unit_revision: unit.revision,
        encounter_id: encounterId,
        operation_id: operationId,
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
) {
  const response = await request<{ item: CloseUnitEncounterResultDto }>(
    `/review/session/${sessionId}/units/${unitId}/encounters/${encounterId}/close`,
    {
      method: 'POST',
      body: JSON.stringify({ operation_id: operationId }),
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

export async function undoReviewUnitRatingApi(operationId: string) {
  const response = await request<{ item: UndoUnitRatingResultDto }>(`/review/ratings/${operationId}/undo`, { method: 'POST' })
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
