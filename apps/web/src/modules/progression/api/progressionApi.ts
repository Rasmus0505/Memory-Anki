import { request } from '@/shared/api/http'
import type { ProgressionOverview } from '@/shared/api/contracts'

function isOverview(value: unknown): value is ProgressionOverview {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ProgressionOverview>
  return (
    typeof candidate.level?.level === 'number'
    && typeof candidate.level.xp === 'number'
    && Array.isArray(candidate.quests)
    && Array.isArray(candidate.stamps)
    && Boolean(candidate.starmap)
  )
}

export async function getProgressionOverviewApi(): Promise<ProgressionOverview> {
  const payload = await request<unknown>('/progression/overview')
  // A service-worker fallback or proxy page must surface as an error, not a half-shaped HUD.
  if (!isOverview(payload)) throw new Error('成长数据格式不完整。')
  return payload
}
