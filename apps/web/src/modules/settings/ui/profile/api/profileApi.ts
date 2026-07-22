import { API_BASE, request, uploadWithFormData } from '@/shared/api/http'
import type {
  AiEvalRun,
  AiPromptBlock,
  AiPromptBlockVersion,
  AiPromptRunSelection,
  AiPromptSceneDefault,
  AiPromptSceneVersion,
  AiPromptTemplateListResponse,
  AiPromptVersionSummary,
  AiQualitySummary,
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

export function getAiPromptBlocksApi() {
  return request<{ items: AiPromptBlock[] }>('/settings/ai-prompt-blocks')
}

export function saveAiPromptBlockApi(block: AiPromptBlock) {
  return request<AiPromptBlock>(`/settings/ai-prompt-blocks/${encodeURIComponent(block.key)}`, {
    method: 'PUT',
    body: JSON.stringify({
      label: block.label,
      description: block.description,
      layer: block.layer,
      sort_order: block.sort_order,
      template: block.template,
      is_active: block.is_active,
      applicable_scene_keys: block.applicable_scene_keys,
      acknowledged_scene_keys: block.affected_scene_keys,
    }),
  })
}

export function getAiPromptBlockVersionsApi(blockKey: string) {
  return request<{ items: AiPromptBlockVersion[] }>(
    `/settings/ai-prompt-blocks/${encodeURIComponent(blockKey)}/versions`,
  )
}

export function activateAiPromptBlockVersionApi(blockKey: string, versionId: string) {
  return request<AiPromptBlock>(
    `/settings/ai-prompt-blocks/${encodeURIComponent(blockKey)}/versions/${encodeURIComponent(versionId)}/activate`,
    { method: 'POST' },
  )
}

export function getAiPromptScenesApi() {
  return request<{ items: AiPromptSceneDefault[] }>('/settings/ai-prompt-scenes')
}

export function saveAiPromptSceneDefaultApi(sceneKey: string, selection: AiPromptRunSelection) {
  return request<AiPromptSceneDefault>(
    `/settings/ai-prompt-scenes/${encodeURIComponent(sceneKey)}/default`,
    {
      method: 'PUT',
      body: JSON.stringify({
        block_keys: selection.block_keys ?? [],
        scene_instruction: selection.scene_instruction ?? '',
      }),
    },
  )
}

export function getAiPromptSceneVersionsApi(sceneKey: string) {
  return request<{ items: AiPromptSceneVersion[] }>(
    `/settings/ai-prompt-scenes/${encodeURIComponent(sceneKey)}/versions`,
  )
}

export function activateAiPromptSceneVersionApi(sceneKey: string, versionId: string) {
  return request<AiPromptSceneDefault>(
    `/settings/ai-prompt-scenes/${encodeURIComponent(sceneKey)}/versions/${encodeURIComponent(versionId)}/activate`,
    { method: 'POST' },
  )
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

export function getAiPromptVersionsApi(promptKey: string) {
  return request<{ items: AiPromptVersionSummary[] }>(
    `/settings/ai-prompts/${encodeURIComponent(promptKey)}/versions`,
  )
}

export function runAiPromptEvalApi(promptKey: string, candidateVersionId: string) {
  return request<AiEvalRun>('/settings/ai-evals/runs', {
    method: 'POST',
    body: JSON.stringify({ prompt_key: promptKey, candidate_version_id: candidateVersionId }),
  })
}

export function activateAiPromptVersionApi(promptKey: string, versionId: string) {
  return request<AiPromptVersionSummary>(
    `/settings/ai-prompts/${encodeURIComponent(promptKey)}/versions/${encodeURIComponent(versionId)}/activate`,
    { method: 'POST' },
  )
}

export function getAiQualitySummaryApi(params: {
  days?: number
  scene?: string
  provider?: string
  model?: string
} = {}) {
  const query = new URLSearchParams()
  if (params.days) query.set('days', String(params.days))
  if (params.scene) query.set('scene', params.scene)
  if (params.provider) query.set('provider', params.provider)
  if (params.model) query.set('model', params.model)
  const suffix = query.toString()
  return request<AiQualitySummary>(`/settings/ai-quality/summary${suffix ? `?${suffix}` : ''}`)
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
