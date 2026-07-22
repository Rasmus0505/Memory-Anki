import { request } from '@/shared/api/http'
import type { PalaceListItem } from '@/shared/api/contracts'

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
