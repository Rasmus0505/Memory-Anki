import type { MutableRefObject } from 'react'
import type { MindMapAiSplitRequestPayload, MindMapSelection } from '@/shared/components/mindmap-host/hostBridgeUtils'

interface HostEventHandlerRefs {
  onNodeActive: MutableRefObject<((nodes: MindMapSelection[]) => void) | undefined>
  onNodeClick: MutableRefObject<((nodes: MindMapSelection[]) => void) | undefined>
  onNodeContextMenu: MutableRefObject<((nodes: MindMapSelection[]) => void) | undefined>
  onNodeHover: MutableRefObject<((nodes: MindMapSelection[]) => void) | undefined>
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
  onAiSplitRequest: MutableRefObject<((payload: MindMapAiSplitRequestPayload) => void) | undefined>
  onFullscreenChange: MutableRefObject<((active: boolean) => void) | undefined>
  onFullscreenToggle: MutableRefObject<((active?: boolean) => void) | undefined>
  onEnterNativeFullscreen: MutableRefObject<(() => void) | undefined>
  onExitNativeFullscreen: MutableRefObject<(() => void) | undefined>
  onUiClearedChange: MutableRefObject<((active: boolean) => void) | undefined>
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
  onMiniPalacePour: MutableRefObject<(() => void) | undefined>
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
  if (event === 'feedback_event') {
    return 'other'
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
  if (event === 'node_hover') {
    handlers.onNodeHover.current?.(Array.isArray(payload) ? (payload as MindMapSelection[]) : [])
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
  if (event === 'enter_native_fullscreen_request') {
    handlers.onEnterNativeFullscreen.current?.()
  }
  if (event === 'exit_native_fullscreen_request') {
    handlers.onExitNativeFullscreen.current?.()
  }
  if (event === 'ui_cleared_change') {
    handlers.onUiClearedChange.current?.(Boolean(payload))
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
  if (event === 'mini_palace_pour') {
    handlers.onMiniPalacePour.current?.()
  }
  return 'other'
}
