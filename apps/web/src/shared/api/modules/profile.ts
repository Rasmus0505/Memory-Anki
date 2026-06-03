import { API_BASE, request } from '@/shared/api/http'
import type {
  BackupListResponse,
  CreateBackupResponse,
  ImportPalacesResponse,
  PdfImportOptions,
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

export function buildPdfImportOptionsFromSettings(settings: ReviewSettings | null | undefined): PdfImportOptions {
  return {
    quote_original_text_only: String(settings?.import_pdf_quote_original_default ?? 'true') === 'true',
    mount_on_original_leaf_only: String(settings?.import_pdf_mount_leaf_only_default ?? 'true') === 'true',
    preserve_emphasis_marks: String(settings?.import_pdf_preserve_emphasis_default ?? 'true') === 'true',
    semantic_split_long_paragraphs: String(settings?.import_pdf_semantic_split_default ?? 'true') === 'true',
    preserve_line_breaks: String(settings?.import_pdf_preserve_line_breaks_default ?? 'true') === 'true',
  }
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
