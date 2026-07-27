import { request } from '@/shared/api/http'
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
  CompiledPromptSnapshot,
} from '@/shared/api/contracts'

/**
 * Prompt, eval and quality endpoints.
 *
 * These used to exist twice: once here in the entity layer and once in the
 * settings UI's own profileApi. The two copies of
 * `saveAiPromptSceneDefaultApi` even behaved differently offline, so the
 * settings page and the in-run dialog queued differently for the same write.
 */
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
      persistence: {
        resourceKey: `settings:ai-prompt-scene:${sceneKey}`,
        // Without a coalesce key the settings page and the in-run dialog each
        // queue their own write for the same scene, and replay order decides
        // which one wins.
        coalesceKey: `settings:ai-prompt-scene:${sceneKey}`,
        description: '保存场景默认提示词组合',
        replayMode: 'manual',
      },
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

export function previewAiPromptCompositionApi(
  sceneKey: string,
  selection: AiPromptRunSelection,
  variables: Record<string, unknown> = {},
) {
  return request<CompiledPromptSnapshot>('/settings/ai-prompt-compose/preview', {
    method: 'POST',
    body: JSON.stringify({ scene_key: sceneKey, selection, variables }),
  })
}
