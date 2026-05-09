import { API_BASE, request } from '@/shared/api/http'
import type {
  BackupListResponse,
  CreateBackupResponse,
  ImportPalacesResponse,
  RestoreBackupResponse,
  ReviewSettings,
} from '@/shared/api/contracts'

export function getReviewSettingsApi() {
  return request<ReviewSettings>('/settings/review')
}

export function updateReviewSettingsApi(data: Record<string, string>) {
  return request<ReviewSettings>('/settings/review', {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export function exportJsonUrl() {
  return `${API_BASE}/export/json`
}

export function exportMarkdownUrl() {
  return `${API_BASE}/export/markdown`
}

export async function importFileApi(file: File, format: string) {
  const form = new FormData()
  form.append('file', file)
  form.append('format', format)
  const response = await fetch(`${API_BASE}/import`, { method: "POST", body: form })
  return response.json() as Promise<ImportPalacesResponse>
}

export function getBackupsApi() {
  return request<BackupListResponse>('/backups')
}

export function createBackupApi(reason = "manual") {
  return request<CreateBackupResponse>('/backups/create', {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
}

export function restoreBackupApi(path: string) {
  return request<RestoreBackupResponse>('/backups/restore-database', {
    method: 'POST',
    body: JSON.stringify({ path }),
  })
}
