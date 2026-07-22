import type { MindMapEditorState } from '@/shared/api/contracts'
export type { MindMapSelection } from '@/modules/content/domain/mindmap-document-entity'
export type {
  MindMapFeedbackEvent,
  MindMapFeedbackFxPayload,
  MindMapFeedbackLevel,
  MindMapFeedbackOrigin,
  MindMapReviewFxPayload,
  MindMapReviewFxType,
} from '@/shared/feedback/feedbackEvents'

export function cloneValue<T>(value: T): T {
  return structuredClone(value)
}

export function normalizeEditorDoc(value: MindMapEditorState['editor_doc']): Record<string, unknown> | string {
  if (value == null) return {}
  return cloneValue(value)
}
