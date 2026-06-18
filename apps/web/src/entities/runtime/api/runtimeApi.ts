import { request } from '@/shared/api/http'
import type { RuntimeInfo } from '@/shared/api/contracts'

export function getRuntimeInfoApi() {
  return request<RuntimeInfo>('/runtime-info')
}
