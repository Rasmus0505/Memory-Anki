import type { MindMapEditorState } from '@/shared/api/contracts'
import type {
  BilinkItem,
  MindMapHostSegmentRangeDraft,
  MindMapHostSegmentSummary,
} from '@/shared/api/contracts'

export interface MindMapSelection {
  uid: string | null
  text: string
  note: string
  memoryAnkiId: number | null
  memoryAnkiNodeType: string | null
  rawData: Record<string, unknown>
}

export interface MindMapAiSplitRequestPayload {
  target_node_uid: string | null
  target_node_text: string
  target_node_note: string
  target_node_type: string | null
  is_root: boolean
}

export type MindMapReviewFxType =
  | 'category_expand'
  | 'next_level_expand'
  | 'card_reveal'
  | 'branch_clear'
  | 'all_clear_ready'
  | 'session_complete'
  | 'session_reset'

export type MindMapFeedbackEvent =
  | MindMapReviewFxType
  | 'pointer_down'
  | 'pointer_click'
  | 'hover_pulse'
  | 'key_press'
  | 'shortcut_trigger'
  | 'navigation'
  | 'field_focus'
  | 'field_commit'
  | 'toggle_on'
  | 'toggle_off'
  | 'text_commit'
  | 'node_select'
  | 'node_edit_start'
  | 'node_create'
  | 'node_delete'
  | 'node_move'
  | 'drag_start'
  | 'drag_drop'
  | 'context_menu'
  | 'toolbar_action'
  | 'mode_switch'
  | 'save_success'
  | 'save_error'
  | 'import_apply'
  | 'bilink_action'
  | 'segment_action'

export type MindMapFeedbackLevel = 'micro' | 'action' | 'milestone'

export type MindMapFeedbackOrigin =
  | 'keyboard'
  | 'pointer'
  | 'node'
  | 'edge'
  | 'toolbar'
  | 'review'
  | 'system'

export interface MindMapReviewFxPayload {
  type: MindMapReviewFxType
  nodeUid: string | null
  relatedNodeUids: string[]
  intensity: 'full' | 'soft' | 'none'
  lineMode?: 'spawn' | 'trace' | 'confirm' | 'clear'
  depthHint?: 0 | 1 | 2
  targetRole?: 'parent' | 'placeholder' | 'revealed'
  isBranchCompletion?: boolean
  nonce: number
}

export interface MindMapFeedbackFxPayload
  extends Omit<MindMapReviewFxPayload, 'type'> {
  type: MindMapFeedbackEvent
  level?: MindMapFeedbackLevel
  origin?: MindMapFeedbackOrigin
  x?: number
  y?: number
  source?: string
}

export interface MindMapFrameHostState {
  readonly: boolean
  showToolbarWhenReadonly: boolean
  showPracticeButton: boolean
  showEnglishButton: boolean
  practiceModeActive: boolean
  practiceToggleLabel: '练习' | '编辑' | '复习'
  viewMemoryScope: string | null
  immersiveModeActive: boolean
  showImportButtons: boolean
  aiSplitBusy: boolean
  aiSplitEnabled: boolean
  segments: MindMapHostSegmentSummary[]
  activeSegmentId: number | null
  segmentColorMode: 'all' | 'active-only' | 'all-with-active-emphasis'
  segmentRangeDraft: MindMapHostSegmentRangeDraft
  bilinkCounts: Record<string, number>
  bilinkItems: BilinkItem[]
  bilinkCurrentPalaceId: number | null
  focusNodeUids: string[]
  focusRequestNodeUid: string | null
  focusRequestNonce: number
  showBilinkSearchButton: boolean
  showMiniPalaceButton: boolean
  miniPalaceDraft: {
    active: boolean
    selectedNodeUids: string[]
  }
}

export interface HostEditorStateSyncPayload {
  editorState: MindMapEditorState
  preserveView: boolean
  syncIntent: 'soft' | 'replace'
  syncReason: string | null
  fingerprint: string
  source: 'prop' | 'force'
}

export interface HostBridge {
  getMindMapData: () => Record<string, unknown> | string
  saveMindMapData: (data: Record<string, unknown> | string) => void
  getMindMapConfig: () => Record<string, unknown>
  saveMindMapConfig: (config: Record<string, unknown>) => void
  getLanguage: () => string
  saveLanguage: (lang: string) => void
  getLocalConfig: () => Record<string, unknown>
  saveLocalConfig: (config: Record<string, unknown>) => void
  isHydrated?: () => boolean
  notify: (event: string, payload: unknown) => void
}

export interface MindMapHostWindow extends Window {
  syncHostEditorState?: (payload: {
    editorState: MindMapEditorState
    preserveView: boolean
    syncIntent: 'soft' | 'replace'
    syncReason: string | null
    viewPolicy: 'preserve' | 'reset'
  }) => void
  applyHostState?: (state: MindMapFrameHostState) => void
  insertBilinkMark?: (text: string) => boolean
  emitReviewFx?: (payload: MindMapReviewFxPayload) => void
  emitFeedbackFx?: (payload: MindMapFeedbackFxPayload) => void
  clearReviewFx?: () => void
}

declare global {
  interface Window {
    __memoryAnkiMindMapHosts?: Record<string, HostBridge>
  }
}

export function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function normalizeEditorDoc(value: MindMapEditorState['editor_doc']): Record<string, unknown> | string {
  if (value == null) return {}
  return cloneValue(value)
}

export function hasMeaningfulExternalSyncKey(value: string | number | null): boolean {
  if (value == null) return false
  if (typeof value === 'number') return value !== 0
  const normalized = value.trim()
  return normalized !== '' && normalized !== '0'
}

export function buildSyncFingerprint(args: {
  editorState: MindMapEditorState
  activeSegmentId: number | null
  segmentColorMode: 'all' | 'active-only' | 'all-with-active-emphasis'
  segmentRangeDraft: MindMapHostSegmentRangeDraft
  bilinkCounts: Record<string, number>
  segments: MindMapHostSegmentSummary[]
  preserveViewOnSync: boolean
  externalSyncKey: string | number | null
}) {
  const {
    editorState,
    activeSegmentId,
    segmentColorMode,
    segmentRangeDraft,
    bilinkCounts,
    segments,
    preserveViewOnSync,
    externalSyncKey,
  } = args
  const useExternalDocSyncKey = hasMeaningfulExternalSyncKey(externalSyncKey)
  return JSON.stringify({
    editor_doc: useExternalDocSyncKey ? undefined : normalizeEditorDoc(editorState.editor_doc),
    editor_doc_sync_key: useExternalDocSyncKey ? externalSyncKey : undefined,
    editor_config: editorState.editor_config,
    editor_local_config: editorState.editor_local_config,
    lang: editorState.lang,
    segments,
    activeSegmentId,
    segmentColorMode,
    segmentRangeDraft,
    bilinkCounts,
    preserveViewOnSync,
  })
}

export function buildHostBridgeHostState(args: {
  readonly: boolean
  showToolbarWhenReadonly: boolean
  practiceModeActive: boolean
  practiceToggleLabel: '练习' | '编辑' | '复习'
  viewMemoryScope: string | null
  immersiveModeActive: boolean
  showImportButtons: boolean
  aiSplitBusy: boolean
  segments: MindMapHostSegmentSummary[]
  activeSegmentId: number | null
  segmentColorMode: 'all' | 'active-only' | 'all-with-active-emphasis'
  segmentRangeDraft: MindMapHostSegmentRangeDraft
  bilinkCounts: Record<string, number>
  bilinkItems: BilinkItem[]
  bilinkCurrentPalaceId: number | null
  focusNodeUids: string[]
  focusRequestNodeUid: string | null
  focusRequestNonce: number
  showBilinkSearchButton: boolean
  showMiniPalaceButton: boolean
  miniPalaceDraft: {
    active: boolean
    selectedNodeUids: string[]
  }
  hasPracticeToggle: boolean
  hasEnglishOpen: boolean
  hasAiSplitRequest: boolean
}): MindMapFrameHostState {
  return {
    readonly: args.readonly,
    showToolbarWhenReadonly: args.showToolbarWhenReadonly,
    showPracticeButton: args.hasPracticeToggle,
    showEnglishButton: args.hasEnglishOpen,
    practiceModeActive: args.practiceModeActive,
    practiceToggleLabel: args.practiceToggleLabel,
    viewMemoryScope: args.viewMemoryScope,
    immersiveModeActive: args.immersiveModeActive,
    showImportButtons: args.showImportButtons,
    aiSplitBusy: args.aiSplitBusy,
    aiSplitEnabled: args.hasAiSplitRequest,
    segments: cloneValue(args.segments),
    activeSegmentId: args.activeSegmentId,
    segmentColorMode: args.segmentColorMode,
    segmentRangeDraft: cloneValue(args.segmentRangeDraft),
    bilinkCounts: cloneValue(args.bilinkCounts),
    bilinkItems: cloneValue(args.bilinkItems),
    bilinkCurrentPalaceId: args.bilinkCurrentPalaceId,
    focusNodeUids: cloneValue(args.focusNodeUids),
    focusRequestNodeUid: args.focusRequestNodeUid,
    focusRequestNonce: args.focusRequestNonce,
    showBilinkSearchButton: args.showBilinkSearchButton,
    showMiniPalaceButton: args.showMiniPalaceButton,
    miniPalaceDraft: cloneValue(args.miniPalaceDraft),
  }
}
