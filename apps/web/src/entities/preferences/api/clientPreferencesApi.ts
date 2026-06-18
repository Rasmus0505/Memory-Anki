import { request } from '@/shared/api/http'
import type { ClientPreferencesResponse } from '@/shared/api/contracts'

export function getClientPreferencesApi() {
  return request<ClientPreferencesResponse>('/profile/client-preferences')
}

export function updateClientPreferencesApi(data: Record<string, unknown>) {
  return request<ClientPreferencesResponse>('/profile/client-preferences', {
    method: 'PUT',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: 'profile:client-preferences',
      coalesceKey: 'profile:client-preferences',
      description: '保存客户端偏好',
      replayMode: 'auto',
    },
  })
}
