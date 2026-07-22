import { request } from '@/shared/api/http'
import type {
  MindMapNodeManualLabel,
  MindMapNodeMastery,
  MindMapRecallEvent,
  MindMapRecallEventCreate,
} from '@/shared/api/contracts'

export function createMindMapRecallEventApi(data: MindMapRecallEventCreate) {
  return request<{ item: MindMapRecallEvent }>('/mindmap/recall-events', {
    method: 'POST',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `mindmap-recall:${data.id}`,
      description: '保存脑图回忆评分',
      replayMode: 'auto',
    },
  })
}

export function listMindMapSessionEventsApi(studySessionId: string) {
  return request<{ items: MindMapRecallEvent[] }>(`/mindmap/recall-events/session/${encodeURIComponent(studySessionId)}`)
}

export function listMindMapNodeMasteryApi(palaceId: number, weakOnly = false) {
  return request<{ items: MindMapNodeMastery[] }>(`/mindmap/palaces/${palaceId}/node-mastery?weak_only=${weakOnly ? 'true' : 'false'}`)
}

export function setMindMapNodeLabelApi(palaceId: number, nodeUid: string, label: MindMapNodeManualLabel) {
  return request<{ item: { palace_id: number; node_uid: string; label: MindMapNodeManualLabel } }>(
    `/mindmap/palaces/${palaceId}/node-labels/${encodeURIComponent(nodeUid)}`,
    { method: 'PUT', body: JSON.stringify({ label }) },
  )
}

