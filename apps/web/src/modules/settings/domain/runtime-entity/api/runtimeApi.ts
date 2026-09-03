import { request } from '@/shared/api/http'
import type { RuntimeInfo } from '@/shared/api/contracts'

export function getRuntimeInfoApi() {
  return request<RuntimeInfo>('/runtime-info')
}

export function updateRuntimeConfigApi(localAppHome: string) {
  return request<{ local_app_home: string; restart_required: boolean }>('/runtime-config', {
    method: 'PUT',
    body: JSON.stringify({ local_app_home: localAppHome }),
  })
}
