import { API_BASE, request } from '@/shared/api/http'
import type {
  MindMapAiSplitRequest,
  MindMapAiSplitResponse,
  MindMapEditorState,
  PalaceEditorSavePayload,
} from '@/shared/api/contracts'
import { logAppError } from '@/shared/logs/model/appLogs'
import { readImportJson } from './importResponse'

export function savePalaceEditorApi(id: number, data: PalaceEditorSavePayload) {
  return request<{ palace: any } & MindMapEditorState>(`/palaces/${id}/editor`, {
    method: 'PUT',
    body: JSON.stringify({ editor_source: 'palace_edit_autosave', ...data }),
    persistence: {
      resourceKey: `palace:${id}:editor`,
      coalesceKey: `palace:${id}:editor`,
      description: '保存宫殿脑图',
      replayMode: 'auto',
    },
  })
}

export function savePalaceEditorWithOptionsApi(
  id: number,
  data: PalaceEditorSavePayload | Record<string, unknown>,
) {
  return request<{ palace: any } & MindMapEditorState>(`/palaces/${id}/editor`, {
    method: 'PUT',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `palace:${id}:editor`,
      coalesceKey: `palace:${id}:editor`,
      description: '保存宫殿脑图',
      replayMode: 'auto',
    },
  })
}

export async function splitMindMapNodeApi(palaceId: number, data: MindMapAiSplitRequest) {
  const requestUrl = `${API_BASE}/palaces/${palaceId}/editor/ai-split`
  let response: Response
  try {
    response = await fetch(requestUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  } catch (error) {
    logAppError({
      feature: 'AI 分卡',
      stage: 'network_failure',
      error,
      requestSummary: `POST ${requestUrl}`,
      meta: {
        palaceId,
      },
    })
    throw error
  }
  return readImportJson<MindMapAiSplitResponse>(response)
}
