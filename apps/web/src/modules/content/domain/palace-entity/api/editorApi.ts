import { request } from '@/shared/api/http'
import { rememberPalaceEditor } from '@/shared/study-text/studyTextLibrary'
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
  }).then((saved) => {
    if (responseMode !== 'ack' && saved && typeof saved === 'object' && 'editor_doc' in saved) {
      rememberPalaceEditor(id, saved)
    }
    return saved
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
  }).then((saved) => {
    if (saved && typeof saved === 'object' && 'editor_doc' in saved) rememberPalaceEditor(id, saved)
    return saved
  })
}

export async function splitMindMapNodeApi(palaceId: number, data: MindMapAiSplitRequest) {
  return request<MindMapAiSplitResponse>(`/palaces/${palaceId}/editor/ai-split`, {
    method: 'POST',
    body: JSON.stringify(data),
    persistence: false,
  })
}
