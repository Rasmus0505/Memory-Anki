import { request } from '@/shared/api/http'
import type {
  MindMapAiSplitRequest,
  MindMapAiSplitResponse,
  PalaceEditorSaveAckResponse,
  PalaceEditorResponse,
  PalaceEditorSavePayload,
} from '@/shared/api/contracts'

export function savePalaceEditorApi(
  id: number,
  data: PalaceEditorSavePayload,
  responseMode: 'ack',
): Promise<PalaceEditorSaveAckResponse>
export function savePalaceEditorApi(
  id: number,
  data: PalaceEditorSavePayload,
  responseMode?: 'full',
): Promise<PalaceEditorResponse>
export function savePalaceEditorApi(
  id: number,
  data: PalaceEditorSavePayload,
  responseMode: 'full' | 'ack' = 'full',
) {
  return request<PalaceEditorResponse | PalaceEditorSaveAckResponse>(`/palaces/${id}/editor`, {
    method: 'PUT',
    body: JSON.stringify({
      editor_source: 'palace_edit_autosave',
      ...data,
      ...(responseMode === 'ack' ? { response_mode: 'ack' } : {}),
    }),
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
