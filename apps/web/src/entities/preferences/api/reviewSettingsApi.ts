import { request } from '@/shared/api/http'
import type { ReviewSettings } from '@/shared/api/contracts'

export function getReviewSettingsApi() {
  return request<ReviewSettings>('/settings/review')
}

export function updateReviewSettingsApi(data: Record<string, string>) {
  return request<ReviewSettings>('/settings/review', {
    method: 'PUT',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: 'settings:review',
      coalesceKey: 'settings:review',
      description: '保存复习设置',
      replayMode: 'auto',
    },
  })
}
