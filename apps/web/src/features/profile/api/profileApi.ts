import { API_BASE, request, uploadWithFormData } from '@/shared/api/http'
import type {
  AiPromptTemplateListResponse,
  BackupListResponse,
  CreateBackupResponse,
  FullImportPreviewResponse,
  FullImportResponse,
  ImportPalacesResponse,
  RestoreBackupResponse,
} from '@/shared/api/contracts'

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

export function exportJsonUrl() {
  return `${API_BASE}/export/json`
}

export function exportMarkdownUrl() {
  return `${API_BASE}/export/markdown`
}

export function fullExportUrl() {
  return `${API_BASE}/export/full`
}

export async function importFileApi(file: File, format: string) {
  const form = new FormData()
  form.append('file', file)
  form.append('format', format)
  return uploadWithFormData<ImportPalacesResponse>('/import', form, {
    resourceKey: `import:file:${file.name}:${format}`,
    description: `导入文件：${file.name}`,
  })
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

export function previewFullImportApi(file: File) {
  const form = new FormData()
  form.append('file', file)
  return uploadWithFormData<FullImportPreviewResponse>('/import/full/preview', form, {
    resourceKey: 'backup:full-import-preview',
    description: '校验全量导入包',
  })
}

export function runFullImportApi(file: File) {
  const form = new FormData()
  form.append('file', file)
  return uploadWithFormData<FullImportResponse>('/import/full', form, {
    resourceKey: 'backup:full-import',
    description: '执行全量导入',
  })
}
