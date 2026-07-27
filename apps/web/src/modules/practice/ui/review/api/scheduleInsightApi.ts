import { request } from '@/shared/api/http'
import type {
  PalaceAggregationPreview,
  PalaceReviewScheduleSettings,
  ReviewLoadSimulation,
  ReviewNodeIntervalPreviews,
  ReviewNodeScheduleDetail,
  ReviewTodayPlan,
  ReviewConsolidateToday,
  UnitRegroupPreview,
} from '@/shared/api/contracts'

/**
 * 调度透明层 API：今日任务、四键间隔预览、"为什么是今天"、负载模拟、
 * 宫殿聚合复习日设置。全部只读或幂等，无本地乐观状态。
 */

export function getReviewTodayPlanApi() {
  return request<{ item: ReviewTodayPlan }>('/review/today-plan')
}

export function previewReviewIntervalsApi(
  items: Array<{ palace_id: number; node_uid: string }>,
) {
  return request<{ items: ReviewNodeIntervalPreviews[] }>('/review/preview-intervals', {
    method: 'POST',
    body: JSON.stringify({ items }),
  })
}

export function getNodeScheduleDetailApi(palaceId: number, nodeUid: string) {
  return request<{ item: ReviewNodeScheduleDetail }>(
    `/review/palaces/${palaceId}/nodes/${encodeURIComponent(nodeUid)}/schedule-detail`,
  )
}

export function simulateReviewLoadApi(desiredRetention: number, days = 30) {
  return request<{ item: ReviewLoadSimulation }>('/review/simulate-load', {
    method: 'POST',
    body: JSON.stringify({ desired_retention: desiredRetention, days }),
  })
}

export function getPalaceReviewScheduleSettingsApi(palaceId: number) {
  return request<{ item: PalaceReviewScheduleSettings }>(`/review/palaces/${palaceId}/settings`)
}

export function updatePalaceReviewScheduleSettingsApi(
  palaceId: number,
  data: Partial<Omit<PalaceReviewScheduleSettings, 'palace_id'>>,
) {
  return request<{ item: PalaceReviewScheduleSettings & { aggregation_cleared_count?: number } }>(
    `/review/palaces/${palaceId}/settings`,
    { method: 'PUT', body: JSON.stringify(data) },
  )
}

export function previewPalaceAggregationApi(palaceId: number, horizonDays = 30) {
  return request<{ item: PalaceAggregationPreview }>(
    `/review/palaces/${palaceId}/aggregation/preview`,
    { method: 'POST', body: JSON.stringify({ horizon_days: horizonDays }) },
  )
}

export function applyPalaceAggregationApi(palaceId: number, horizonDays = 30) {
  return request<{ item: PalaceAggregationPreview }>(
    `/review/palaces/${palaceId}/aggregation/apply`,
    { method: 'POST', body: JSON.stringify({ horizon_days: horizonDays }) },
  )
}

export function clearPalaceAggregationApi(palaceId: number) {
  return request<{ item: { palace_id: number; cleared_count: number } }>(
    `/review/palaces/${palaceId}/aggregation/clear`,
    { method: 'POST', body: '{}' },
  )
}

export function getConsolidateTodayApi() {
  return request<{ item: ReviewConsolidateToday }>('/review/consolidate/today')
}
export function previewUnitRegroupApi(palaceId: number) {
  return request<{ item: UnitRegroupPreview }>('/review/units/regroup/preview', { method: 'POST', body: JSON.stringify({ palace_id: palaceId }) })
}
export function executeUnitRegroupApi(palaceId: number, palaceRevision: string, operationId: string) {
  return request<{ item: { operation_id: string; affected_node_count: number } }>('/review/units/regroup/execute', { method: 'POST', body: JSON.stringify({ palace_id: palaceId, palace_revision: palaceRevision, operation_id: operationId }) })
}
export function rollbackUnitRegroupApi(operationId: string) {
  return request<{ item: { operation_id: string; restored_node_count: number } }>('/review/units/regroup/rollback', { method: 'POST', body: JSON.stringify({ operation_id: operationId }) })
}
export function simulateUnitCohesionApi(palaceId: number) {
  return request<{ item: UnitRegroupPreview }>('/review/units/simulate-cohesion', { method: 'POST', body: JSON.stringify({ palace_id: palaceId }) })
}
