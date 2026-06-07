import type { MutableRefObject } from 'react'
import type { MindMapAiSplitRequestPayload, MindMapSelection } from '@/shared/components/mindmap-host/hostBridgeUtils'

interface HostEventHandlerRefs {
  onNodeActive: MutableRefObject<((nodes: MindMapSelection[]) => void) | undefined>
  onNodeClick: MutableRefObject<((nodes: MindMapSelection[]) => void) | undefined>
  onNodeContextMenu: MutableRefObject<((nodes: MindMapSelection[]) => void) | undefined>
  onSegmentSelect: MutableRefObject<((segmentId: number | null) => void) | undefined>
  onCreateSegmentFromSelection: MutableRefObject<(() => void) | undefined>
  onSegmentRangeDraftChange: MutableRefObject<((payload: {
    selectedNodeUids: string[]
    overriddenConflictNodeUids: string[]
  }) => void) | undefined>
  onSegmentRangeModeToggle: MutableRefObject<((payload: {
    active: boolean
    targetSegmentId: number | 'new' | null
  }) => void) | undefined>
  onSegmentRangeConfirm: MutableRefObject<(() => void) | undefined>
  onPracticeToggle: MutableRefObject<(() => void) | undefined>
  onEnglishOpen: MutableRefObject<(() => void) | undefined>
  onMindMapImportOpen: MutableRefObject<(() => void) | undefined>
  onImageTextImportOpen: MutableRefObject<(() => void) | undefined>
  onAiSplitRequest: MutableRefObject<((payload: MindMapAiSplitRequestPayload) => void) | undefined>
  onFullscreenChange: MutableRefObject<((active: boolean) => void) | undefined>
  onFullscreenToggle: MutableRefObject<((active?: boolean) => void) | undefined>
  onBilinkTrigger: MutableRefObject<((payload: {
    nodeUid: string | null
    left: number
    top: number
    query: string
  }) => void) | undefined>
  onBilinkNodeClick: MutableRefObject<((payload: {
    palaceId: number | null
    nodeUid: string | null
    trigger: 'badge' | 'mark'
  }) => void) | undefined>
  onBilinkToolbarSearch: MutableRefObject<(() => void) | undefined>
  onReady: MutableRefObject<(() => void) | undefined>
}

export function dispatchHostEvent(
  event: string,
  payload: unknown,
  handlers: HostEventHandlerRefs,
): 'app_inited' | 'other' {
  if (event === 'app_inited') {
    handlers.onReady.current?.()
    return 'app_inited'
  }
  if (event === 'node_active') {
    handlers.onNodeActive.current?.(Array.isArray(payload) ? (payload as MindMapSelection[]) : [])
  }
  if (event === 'node_click') {
    handlers.onNodeClick.current?.(Array.isArray(payload) ? (payload as MindMapSelection[]) : [])
  }
  if (event === 'node_contextmenu') {
    handlers.onNodeContextMenu.current?.(Array.isArray(payload) ? (payload as MindMapSelection[]) : [])
  }
  if (event === 'segment_select') {
    handlers.onSegmentSelect.current?.(
      typeof payload === 'number' ? payload : payload == null ? null : Number(payload),
    )
  }
  if (event === 'segment_create_from_selection') {
    handlers.onCreateSegmentFromSelection.current?.()
  }
  if (event === 'segment_range_draft_change') {
    const nextPayload =
      payload && typeof payload === 'object'
        ? (payload as { selectedNodeUids?: unknown; overriddenConflictNodeUids?: unknown })
        : null
    handlers.onSegmentRangeDraftChange.current?.({
      selectedNodeUids: Array.isArray(nextPayload?.selectedNodeUids)
        ? nextPayload.selectedNodeUids
            .map((value) => (typeof value === 'string' ? value : null))
            .filter((value): value is string => Boolean(value))
        : [],
      overriddenConflictNodeUids: Array.isArray(nextPayload?.overriddenConflictNodeUids)
        ? nextPayload.overriddenConflictNodeUids
            .map((value) => (typeof value === 'string' ? value : null))
            .filter((value): value is string => Boolean(value))
        : [],
    })
  }
  if (event === 'segment_range_mode_toggle') {
    const nextPayload =
      payload && typeof payload === 'object'
        ? (payload as { active?: unknown; targetSegmentId?: unknown })
        : null
    const rawTarget = nextPayload?.targetSegmentId
    handlers.onSegmentRangeModeToggle.current?.({
      active: Boolean(nextPayload?.active),
      targetSegmentId:
        rawTarget === 'new'
          ? 'new'
          : rawTarget == null || rawTarget === ''
            ? null
            : Number(rawTarget),
    })
  }
  if (event === 'segment_range_confirm') {
    handlers.onSegmentRangeConfirm.current?.()
  }
  if (event === 'practice_toggle') {
    handlers.onPracticeToggle.current?.()
  }
  if (event === 'english_open') {
    handlers.onEnglishOpen.current?.()
  }
  if (event === 'mindmap_import_open') {
    handlers.onMindMapImportOpen.current?.()
  }
  if (event === 'image_text_import_open') {
    handlers.onImageTextImportOpen.current?.()
  }
  if (event === 'ai_split_request') {
    const nextPayload =
      payload && typeof payload === 'object'
        ? (payload as {
            target_node_uid?: unknown
            target_node_text?: unknown
            target_node_note?: unknown
            target_node_type?: unknown
            is_root?: unknown
          })
        : null
    handlers.onAiSplitRequest.current?.({
      target_node_uid:
        typeof nextPayload?.target_node_uid === 'string'
          ? nextPayload.target_node_uid
          : nextPayload?.target_node_uid == null
            ? null
            : String(nextPayload.target_node_uid),
      target_node_text:
        typeof nextPayload?.target_node_text === 'string' ? nextPayload.target_node_text : '',
      target_node_note:
        typeof nextPayload?.target_node_note === 'string' ? nextPayload.target_node_note : '',
      target_node_type:
        typeof nextPayload?.target_node_type === 'string' ? nextPayload.target_node_type : null,
      is_root: Boolean(nextPayload?.is_root),
    })
  }
  if (event === 'fullscreen_change') {
    handlers.onFullscreenChange.current?.(Boolean(payload))
  }
  if (event === 'fullscreen_toggle') {
    handlers.onFullscreenToggle.current?.(typeof payload === 'boolean' ? payload : undefined)
  }
  if (event === 'bilink_trigger') {
    const nextPayload =
      payload && typeof payload === 'object'
        ? (payload as { nodeUid?: unknown; left?: unknown; top?: unknown; query?: unknown })
        : null
    handlers.onBilinkTrigger.current?.({
      nodeUid: typeof nextPayload?.nodeUid === 'string' ? nextPayload.nodeUid : null,
      left: typeof nextPayload?.left === 'number' ? nextPayload.left : 0,
      top: typeof nextPayload?.top === 'number' ? nextPayload.top : 0,
      query: typeof nextPayload?.query === 'string' ? nextPayload.query : '',
    })
  }
  if (event === 'bilink_node_click') {
    const nextPayload =
      payload && typeof payload === 'object'
        ? (payload as { palaceId?: unknown; nodeUid?: unknown; trigger?: unknown })
        : null
    handlers.onBilinkNodeClick.current?.({
      palaceId:
        typeof nextPayload?.palaceId === 'number'
          ? nextPayload.palaceId
          : nextPayload?.palaceId == null
            ? null
            : Number(nextPayload.palaceId),
      nodeUid: typeof nextPayload?.nodeUid === 'string' ? nextPayload.nodeUid : null,
      trigger: nextPayload?.trigger === 'mark' ? 'mark' : 'badge',
    })
  }
  if (event === 'bilink_toolbar_search') {
    handlers.onBilinkToolbarSearch.current?.()
  }
  return 'other'
}
