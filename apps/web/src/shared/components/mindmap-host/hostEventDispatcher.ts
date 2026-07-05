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
  onMiniPalacePour: MutableRefObject<(() => void) | undefined>
  onReady: MutableRefObject<(() => void) | undefined>
}

type HostEventDispatchResult = 'app_inited' | 'other'

type DispatchableHostEventName =
  | 'node_active'
  | 'node_click'
  | 'node_contextmenu'
  | 'node_hover'
  | 'segment_select'
  | 'segment_create_from_selection'
  | 'segment_range_draft_change'
  | 'segment_range_mode_toggle'
  | 'segment_range_confirm'
  | 'ai_split_request'
  | 'fullscreen_change'
  | 'fullscreen_toggle'
  | 'enter_native_fullscreen_request'
  | 'exit_native_fullscreen_request'
  | 'ui_cleared_change'
  | 'mini_palace_pour'

type HostEventDispatcher = (payload: unknown, handlers: HostEventHandlerRefs) => void

function asRecord(payload: unknown): Record<string, unknown> | null {
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null
}

function parseSelections(payload: unknown): MindMapSelection[] {
  return Array.isArray(payload) ? (payload as MindMapSelection[]) : []
}

function parseStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function parseSegmentId(payload: unknown): number | null {
  return typeof payload === 'number' ? payload : payload == null ? null : Number(payload)
}

function parseSegmentRangeModeTarget(rawTarget: unknown): number | 'new' | null {
  if (rawTarget === 'new') {
    return 'new'
  }
  return rawTarget == null || rawTarget === '' ? null : Number(rawTarget)
}

const hostEventDispatchers = {
  node_active: (payload, handlers) => {
    handlers.onNodeActive.current?.(parseSelections(payload))
  },
  node_click: (payload, handlers) => {
    handlers.onNodeClick.current?.(parseSelections(payload))
  },
  node_contextmenu: (payload, handlers) => {
    handlers.onNodeContextMenu.current?.(parseSelections(payload))
  },
  node_hover: (payload, handlers) => {
    handlers.onNodeHover.current?.(parseSelections(payload))
  },
  segment_select: (payload, handlers) => {
    handlers.onSegmentSelect.current?.(parseSegmentId(payload))
  },
  segment_create_from_selection: (_payload, handlers) => {
    handlers.onCreateSegmentFromSelection.current?.()
  },
  segment_range_draft_change: (payload, handlers) => {
    const nextPayload = asRecord(payload)
    handlers.onSegmentRangeDraftChange.current?.({
      selectedNodeUids: parseStringList(nextPayload?.selectedNodeUids),
      overriddenConflictNodeUids: parseStringList(nextPayload?.overriddenConflictNodeUids),
    })
  },
  segment_range_mode_toggle: (payload, handlers) => {
    const nextPayload = asRecord(payload)
    handlers.onSegmentRangeModeToggle.current?.({
      active: Boolean(nextPayload?.active),
      targetSegmentId: parseSegmentRangeModeTarget(nextPayload?.targetSegmentId),
    })
  },
  segment_range_confirm: (_payload, handlers) => {
    handlers.onSegmentRangeConfirm.current?.()
  },
  ai_split_request: (payload, handlers) => {
    const nextPayload = asRecord(payload)
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
  },
  fullscreen_change: (payload, handlers) => {
    handlers.onFullscreenChange.current?.(Boolean(payload))
  },
  fullscreen_toggle: (payload, handlers) => {
    handlers.onFullscreenToggle.current?.(typeof payload === 'boolean' ? payload : undefined)
  },
  enter_native_fullscreen_request: (_payload, handlers) => {
    handlers.onEnterNativeFullscreen.current?.()
  },
  exit_native_fullscreen_request: (_payload, handlers) => {
    handlers.onExitNativeFullscreen.current?.()
  },
  ui_cleared_change: (payload, handlers) => {
    handlers.onUiClearedChange.current?.(Boolean(payload))
  },
  mini_palace_pour: (_payload, handlers) => {
    handlers.onMiniPalacePour.current?.()
  },
} satisfies Record<DispatchableHostEventName, HostEventDispatcher>

function isDispatchableHostEvent(event: string): event is DispatchableHostEventName {
  return event in hostEventDispatchers
}

export function dispatchHostEvent(
  event: string,
  payload: unknown,
  handlers: HostEventHandlerRefs,
): HostEventDispatchResult {
  if (event === 'app_inited') {
    handlers.onReady.current?.()
    return 'app_inited'
  }
  if (event === 'feedback_event') {
    return 'other'
  }
  if (isDispatchableHostEvent(event)) {
    hostEventDispatchers[event](payload, handlers)
  }
  return 'other'
}
