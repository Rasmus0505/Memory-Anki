import type { MindMapEditorSurfaceProps } from '../MindMapEditorSurface.types'

/**
 * Stable empty values: they are dependencies of several memos, so rebuilding
 * them per render would invalidate the whole canvas graph.
 */
export const EMPTY_SEGMENTS: NonNullable<MindMapEditorSurfaceProps['segments']> = []
export const EMPTY_UIDS: string[] = []
export const EMPTY_MASTERY_BY_UID: NonNullable<MindMapEditorSurfaceProps['masteryByNodeUid']> = {}
export const EMPTY_SEGMENT_RANGE_DRAFT: NonNullable<MindMapEditorSurfaceProps['segmentRangeDraft']> = {
  active: false,
  targetSegmentId: null,
  selectedNodeUids: [],
  overriddenConflictNodeUids: [],
}
