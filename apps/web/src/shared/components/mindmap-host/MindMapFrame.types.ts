import type {
  BilinkItem,
  MindMapEditorState,
  MindMapHostSegmentRangeDraft,
  MindMapHostSegmentSummary,
} from '@/shared/api/contracts'
import type {
  MindMapAiSplitRequestPayload,
  MindMapFeedbackFxPayload,
  MindMapReviewFxPayload,
  MindMapSelection,
} from '@/shared/components/mindmap-host/hostBridgeUtils'
import { normalizeEditorDoc } from '@/shared/components/mindmap-host/hostBridgeUtils'

export const HOST_FRAME_RUNTIME_VERSION = '2026-06-10-card-width-drag-fix'
const MIND_MAP_FRAME_BASE_CLASS = 'memory-anki-mindmap-frame'

export function buildMindMapFrameClassName(className?: string) {
  return `${MIND_MAP_FRAME_BASE_CLASS} ${className ?? 'h-full w-full border-0'}`
}

export function buildLocalEditorStateFingerprint(editorState: MindMapEditorState) {
  return JSON.stringify({
    editor_doc: normalizeEditorDoc(editorState.editor_doc),
    editor_config: editorState.editor_config,
    editor_local_config: editorState.editor_local_config,
    lang: editorState.lang || 'zh',
  })
}

export interface MindMapFrameProps {
  editorState: MindMapEditorState
  readonly?: boolean
  practiceModeActive?: boolean
  viewMemoryScope?: string | null
  immersiveModeActive?: boolean
  aiSplitBusy?: boolean
  syncOnPropChange?: boolean
  syncIntent?: 'soft' | 'replace'
  syncReason?: string | null
  externalSyncKey?: string | number | null
  forceSyncKey?: string | number | null
  forceSyncIntent?: 'soft' | 'replace'
  preserveViewOnSync?: boolean
  initialViewPolicy?: 'preserve' | 'reset'
  className?: string
  segments?: MindMapHostSegmentSummary[]
  activeSegmentId?: number | null
  segmentColorMode?: 'all' | 'active-only' | 'all-with-active-emphasis'
  segmentRangeDraft?: MindMapHostSegmentRangeDraft
  bilinkCounts?: Record<string, number>
  bilinkItems?: BilinkItem[]
  bilinkCurrentPalaceId?: number | null
  focusNodeUids?: string[]
  focusRequestNodeUid?: string | null
  focusRequestNonce?: number
  miniPalaceDraft?: {
    active: boolean
    selectedNodeUids: string[]
  }
  miniPalacePracticeActive?: boolean
  bilinkInsertionText?: string | null
  bilinkInsertionNonce?: number
  reviewFxSignal?: MindMapReviewFxPayload | null
  feedbackFxSignal?: MindMapFeedbackFxPayload | null
  onEditorStateChange: (nextState: MindMapEditorState) => void
  onNodeActive?: (nodes: MindMapSelection[]) => void
  onNodeClick?: (nodes: MindMapSelection[]) => void
  onNodeContextMenu?: (nodes: MindMapSelection[]) => void
  onNodeHover?: (nodes: MindMapSelection[]) => void
  onSegmentSelect?: (segmentId: number | null) => void
  onCreateSegmentFromSelection?: () => void
  onSegmentRangeDraftChange?: (payload: {
    selectedNodeUids: string[]
    overriddenConflictNodeUids: string[]
  }) => void
  onSegmentRangeModeToggle?: (payload: {
    active: boolean
    targetSegmentId: number | 'new' | null
  }) => void
  onSegmentRangeConfirm?: () => void
  onAiSplitRequest?: (payload: MindMapAiSplitRequestPayload) => void
  onFullscreenChange?: (active: boolean) => void
  onFullscreenToggle?: (active?: boolean) => void
  onUiClearedChange?: (active: boolean) => void
  onBilinkTrigger?: (payload: {
    nodeUid: string | null
    left: number
    top: number
    query: string
  }) => void
  onBilinkNodeClick?: (payload: {
    palaceId: number | null
    nodeUid: string | null
    trigger: 'badge' | 'mark'
  }) => void
  onMiniPalacePour?: () => void
  onReady?: () => void
}

export interface MindMapFrameHandle {
  setUiCleared: (nextValue: boolean) => void
  toggleUiCleared: () => void
  enterNativeFullscreen: () => Promise<void>
  exitNativeFullscreen: () => Promise<void>
}
