import { API_BASE, fetchWithMutationQueue, request } from '@/shared/api/http'
import type {
  AiModelScenariosResponse,
  AiPromptTemplateListResponse,
  BackupListResponse,
  ClientPreferencesResponse,
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
    persistence: {
      resourceKey: 'settings:review',
      coalesceKey: 'settings:review',
      description: '保存复习设置',
      replayMode: 'auto',
    },
  })
}

export function getAiPromptTemplatesApi() {
  return request<AiPromptTemplateListResponse>('/settings/ai-prompts')
}

export function updateAiPromptTemplatesApi(templates: Record<string, string>) {
  return request<AiPromptTemplateListResponse>('/settings/ai-prompts', {
    method: 'PUT',
    body: JSON.stringify({ templates }),
    persistence: {
      resourceKey: 'settings:ai-prompts',
      coalesceKey: 'settings:ai-prompts',
      description: '保存 AI Prompt 模板',
      replayMode: 'auto',
    },
  })
}

export function resetAiPromptTemplatesApi(keys?: string[]) {
  return request<AiPromptTemplateListResponse>('/settings/ai-prompts/reset', {
    method: 'POST',
    body: JSON.stringify(keys && keys.length > 0 ? { keys } : {}),
    persistence: {
      resourceKey: 'settings:ai-prompts:reset',
      description: '重置 AI Prompt 模板',
      replayMode: 'manual',
    },
  })
}

export function getAiModelScenariosApi() {
  return request<AiModelScenariosResponse>('/settings/ai-models')
}

export function updateAiModelScenariosApi(updates: Record<string, string>) {
  return request<AiModelScenariosResponse>('/settings/ai-models', {
    method: 'PUT',
    body: JSON.stringify({ updates }),
    persistence: {
      resourceKey: 'settings:ai-models',
      coalesceKey: 'settings:ai-models',
      description: '保存 AI 模型配置',
      replayMode: 'auto',
    },
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
  const response = await fetchWithMutationQueue(
    `${API_BASE}/import`,
    { method: "POST", body: form },
    {
      resourceKey: `import:file:${file.name}:${format}`,
      description: `导入文件：${file.name}`,
      replayMode: 'manual',
    },
  )
  return response.json() as Promise<ImportPalacesResponse>
}

export function getBackupsApi() {
  return request<BackupListResponse>('/backups')
}

export function createBackupApi(reason = "manual") {
  return request<CreateBackupResponse>('/backups/create', {
    method: 'POST',
    body: JSON.stringify({ reason }),
    persistence: {
      resourceKey: `backup:create:${reason}`,
      description: '创建备份',
      replayMode: 'manual',
    },
  })
}

export function restoreBackupApi(path: string) {
  return request<RestoreBackupResponse>('/backups/restore-database', {
    method: 'POST',
    body: JSON.stringify({ path }),
    persistence: {
      resourceKey: `backup:restore:${path}`,
      description: '恢复数据库备份',
      replayMode: 'manual',
    },
  })
}

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
