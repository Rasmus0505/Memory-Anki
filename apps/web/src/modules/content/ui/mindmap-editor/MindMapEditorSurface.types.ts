import type { ReactNode } from 'react'
import type {
  MindMapEditorState,
  MindMapHostSegmentRangeDraft,
  MindMapHostSegmentSummary,
} from '@/shared/api/contracts'
import type { MindMapSelection } from '@/modules/content/domain/mindmap-document-entity'
import type { MindMapAiSplitRequestPayload } from '@/shared/ui/mindmap-canvas/capabilities'
import type { MindMapFeedbackFxPayload, MindMapReviewFxPayload } from './hostBridgeUtils'
import type {
  MindMapContentChangeViewportPolicy,
  MindMapMobileViewPolicy,
  MindMapNodeClickViewportPolicy,
} from '@/shared/ui/mindmap-canvas'
import { normalizeEditorDoc } from './hostBridgeUtils'
import type { MindMapCapability } from './capabilities'
import type { MindMapPresentationStrategy } from './useMindMapFullscreen'

export const HOST_FRAME_RUNTIME_VERSION = '2026-07-10-editor-interactions-v2'
const MIND_MAP_FRAME_BASE_CLASS = 'memory-anki-mindmap-frame relative'

export function buildMindMapEditorSurfaceClassName(className?: string) {
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

export interface MindMapEditorSurfaceProps {
  editorState: MindMapEditorState
  capabilities?: readonly MindMapCapability[]
  readonly?: boolean
  practiceModeActive?: boolean
  /** Host English interaction mode: clickable words + long-press selection (no flip). */
  englishInteractionActive?: boolean
  onEnglishWordClick?: (word: string, event: import('react').MouseEvent<HTMLElement>) => void
  viewMemoryScope?: string | null
  immersiveModeActive?: boolean
  presentationStrategy?: MindMapPresentationStrategy
  aiSplitBusy?: boolean
  syncOnPropChange?: boolean
  syncIntent?: 'soft' | 'replace'
  syncReason?: string | null
  externalSyncKey?: string | number | null
  forceSyncKey?: string | number | null
  forceSyncIntent?: 'soft' | 'replace'
  preserveViewOnSync?: boolean
  initialViewPolicy?: 'preserve' | 'reset'
  mobileViewPolicy?: MindMapMobileViewPolicy
  nodeClickViewportPolicy?: MindMapNodeClickViewportPolicy
  contentChangeViewportPolicy?: MindMapContentChangeViewportPolicy
  className?: string
  /** Generic frame chrome key; hosts map product modes (edit/review/practice/rating). */
  sceneChrome?: 'default' | 'edit' | 'review' | 'practice' | 'rating'
  /**
   * Optional explicit scene identity for viewport re-anchor.
   * Defaults to sceneChrome + practice/edit flags when omitted.
   */
  sceneTransitionKey?: string | null
  toolbarContent?: ReactNode
  segments?: MindMapHostSegmentSummary[]
  activeSegmentId?: number | null
  segmentColorMode?: 'all' | 'active-only' | 'all-with-active-emphasis'
  segmentRangeDraft?: MindMapHostSegmentRangeDraft
  highlightedNodeUids?: string[]
  /** Color nodes / edges by Anki front/back roles while editing. */
  ankiEditMode?: boolean
  mutedNodeUids?: string[]
  masteryByNodeUid?: Record<string, { status: string; manualLabel?: string | null; masteryScore?: number | null }>
  statusChipsByNodeUid?: Record<
    string,
    Array<{ text: string; tone: 'danger' | 'success' | 'warning' | 'info' | 'neutral'; style: 'filled' | 'outline' }>
  >
  countBadgeByNodeUid?: Record<
    string,
    { text: string; tone: 'success' | 'danger' | 'warning' | 'neutral'; title?: string }
  >
  onCountBadgeClick?: (nodeUid: string) => void
  focusRequestNodeUid?: string | null
  focusRequestNonce?: number
  reviewFxSignal?: MindMapReviewFxPayload | null
  feedbackFxSignal?: MindMapFeedbackFxPayload | null
  buildSelectionToolbarActions?: (
    nodeId: string,
  ) => Array<{
    id: string
    label: string
    variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost'
    disabled?: boolean
    onClick: () => void
  }>
  selectionToolbarPreferPosition?: 'top' | 'bottom' | 'auto'
  /** Rendered inside the fullscreen frame root so overlays remain visible under native fullscreen. */
  frameOverlay?: ReactNode
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
  onReady?: () => void
  onReadyTimeout?: () => void
}

export interface MindMapEditorSurfaceHandle {
  setUiCleared: (nextValue: boolean) => void
  toggleUiCleared: () => void
  focusNode: (nodeUid: string | null) => void
  fitView: () => void
  enterFullscreen: () => Promise<void>
  exitFullscreen: () => Promise<void>
  enterNativeFullscreen: () => Promise<void>
  exitNativeFullscreen: () => Promise<void>
}
