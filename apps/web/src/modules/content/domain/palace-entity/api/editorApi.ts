import { request } from '@/shared/api/http'
import type {
  MindMapAiSplitRequest,
  MindMapAiSplitResponse,
  PalaceEditorResponse,
  PalaceEditorSavePayload,
} from '@/shared/api/contracts'

export function savePalaceEditorApi(id: number, data: PalaceEditorSavePayload) {
  return request<PalaceEditorResponse>(`/palaces/${id}/editor`, {
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
  return request<PalaceEditorResponse>(`/palaces/${id}/editor`, {
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
  return request<MindMapAiSplitResponse>(`/palaces/${palaceId}/editor/ai-split`, {
    method: 'POST',
    body: JSON.stringify(data),
    persistence: false,
  })
}
