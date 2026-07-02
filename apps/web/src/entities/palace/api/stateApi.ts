import { request } from '@/shared/api/http'
import type { MiniReviewMode, PalaceListItem } from '@/shared/api/contracts'

export function updatePalacePracticeFlagApi(
  palaceId: number,
  data: {
    needs_practice: boolean
  },
) {
  return request<{ item: PalaceListItem }>(`/palaces/${palaceId}/practice-flag`, {
    method: 'PUT',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `palace:${palaceId}:practice-flag`,
      coalesceKey: `palace:${palaceId}:practice-flag`,
      description: '保存宫殿练习标记',
      replayMode: 'auto',
    },
  })
}

export function updatePalaceMiniReviewModeApi(
  palaceId: number,
  data: {
    mini_review_mode: MiniReviewMode
  },
) {
  return request<{ item: PalaceListItem }>(`/palaces/${palaceId}/mini-review-mode`, {
    method: 'PUT',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `palace:${palaceId}:mini-review-mode`,
      coalesceKey: `palace:${palaceId}:mini-review-mode`,
      description: '保存小宫殿复习归属',
      replayMode: 'auto',
    },
  })
}
