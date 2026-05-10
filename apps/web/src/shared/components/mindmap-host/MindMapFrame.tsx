import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { MindMapEditorState } from '@/shared/api/client'
import type {
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

interface MindMapFrameProps {
  editorState: MindMapEditorState
  readonly?: boolean
  showToolbarWhenReadonly?: boolean
  syncOnPropChange?: boolean
  preserveViewOnSync?: boolean
  className?: string
  segments?: MindMapHostSegmentSummary[]
  activeSegmentId?: number | null
  segmentColorMode?: 'all' | 'active-only' | 'all-with-active-emphasis'
  segmentRangeDraft?: MindMapHostSegmentRangeDraft
  onEditorStateChange: (nextState: MindMapEditorState) => void
  onNodeActive?: (nodes: MindMapSelection[]) => void
  onNodeClick?: (nodes: MindMapSelection[]) => void
  onNodeContextMenu?: (nodes: MindMapSelection[]) => void
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
  onFullscreenChange?: (active: boolean) => void
  onReady?: () => void
}

interface HostBridge {
  getMindMapData: () => Record<string, unknown> | string
  saveMindMapData: (data: Record<string, unknown> | string) => void
  getMindMapConfig: () => Record<string, unknown>
  saveMindMapConfig: (config: Record<string, unknown>) => void
  getLanguage: () => string
  saveLanguage: (lang: string) => void
  getLocalConfig: () => Record<string, unknown>
  saveLocalConfig: (config: Record<string, unknown>) => void
  notify: (event: string, payload: unknown) => void
}

declare global {
  interface Window {
    __memoryAnkiMindMapHosts?: Record<string, HostBridge>
  }
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function normalizeEditorDoc(value: MindMapEditorState['editor_doc']): Record<string, unknown> | string {
  if (value == null) return {}
  return cloneValue(value)
}

export function MindMapFrame({
  editorState,
  readonly = false,
  showToolbarWhenReadonly = false,
  syncOnPropChange = false,
  preserveViewOnSync = false,
  className,
  segments = [],
  activeSegmentId = null,
  segmentColorMode = 'all',
  segmentRangeDraft = {
    active: false,
    targetSegmentId: null,
    selectedNodeUids: [],
    overriddenConflictNodeUids: [],
  },
  onEditorStateChange,
  onNodeActive,
  onNodeClick,
  onNodeContextMenu,
  onSegmentSelect,
  onCreateSegmentFromSelection,
  onSegmentRangeDraftChange,
  onSegmentRangeModeToggle,
  onSegmentRangeConfirm,
  onFullscreenChange,
  onReady,
}: MindMapFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const stateRef = useRef(editorState)
  const onEditorStateChangeRef = useRef(onEditorStateChange)
  const onNodeActiveRef = useRef(onNodeActive)
  const onNodeClickRef = useRef(onNodeClick)
  const onNodeContextMenuRef = useRef(onNodeContextMenu)
  const onSegmentSelectRef = useRef(onSegmentSelect)
  const onCreateSegmentFromSelectionRef = useRef(onCreateSegmentFromSelection)
  const onSegmentRangeDraftChangeRef = useRef(onSegmentRangeDraftChange)
  const onSegmentRangeModeToggleRef = useRef(onSegmentRangeModeToggle)
  const onSegmentRangeConfirmRef = useRef(onSegmentRangeConfirm)
  const onFullscreenChangeRef = useRef(onFullscreenChange)
  const onReadyRef = useRef(onReady)
  const lastSyncedFingerprintRef = useRef('')
  const [isLoaded, setIsLoaded] = useState(false)

  stateRef.current = editorState
  onEditorStateChangeRef.current = onEditorStateChange
  onNodeActiveRef.current = onNodeActive
  onNodeClickRef.current = onNodeClick
  onNodeContextMenuRef.current = onNodeContextMenu
  onSegmentSelectRef.current = onSegmentSelect
  onCreateSegmentFromSelectionRef.current = onCreateSegmentFromSelection
  onSegmentRangeDraftChangeRef.current = onSegmentRangeDraftChange
  onSegmentRangeModeToggleRef.current = onSegmentRangeModeToggle
  onSegmentRangeConfirmRef.current = onSegmentRangeConfirm
  onFullscreenChangeRef.current = onFullscreenChange
  onReadyRef.current = onReady

  const rawHostId = useId()
  const hostId = useMemo(() => rawHostId.replace(/[^a-zA-Z0-9_-]/g, '_'), [rawHostId])

  const syncHostEditorState = useCallback(() => {
    const iframeWindow = iframeRef.current?.contentWindow as
      | (Window & {
          syncHostEditorState?: (payload: {
            editorState: MindMapEditorState
            preserveView: boolean
          }) => void
        })
      | null
    iframeWindow?.syncHostEditorState?.({
      editorState: cloneValue(stateRef.current),
      preserveView: preserveViewOnSync,
    })
  }, [preserveViewOnSync])

  const syncHostState = useCallback(() => {
    const iframeWindow = iframeRef.current?.contentWindow as
      | (Window & {
          applyHostState?: (state: {
            readonly: boolean
            showToolbarWhenReadonly: boolean
            segments: MindMapHostSegmentSummary[]
            activeSegmentId: number | null
            segmentColorMode: 'all' | 'active-only' | 'all-with-active-emphasis'
            segmentRangeDraft: MindMapHostSegmentRangeDraft
          }) => void
          resetReadonlyInteractionState?: () => void
        })
      | null
    iframeWindow?.applyHostState?.({
      readonly,
      showToolbarWhenReadonly,
      segments: cloneValue(segments),
      activeSegmentId,
      segmentColorMode,
      segmentRangeDraft: cloneValue(segmentRangeDraft),
    })
    if (readonly) {
      iframeWindow?.resetReadonlyInteractionState?.()
    }
  }, [activeSegmentId, readonly, segmentColorMode, segmentRangeDraft, segments, showToolbarWhenReadonly])

  useEffect(() => {
    const registry = (window.__memoryAnkiMindMapHosts ??= {})
    registry[hostId] = {
      getMindMapData: () => normalizeEditorDoc(stateRef.current.editor_doc),
      saveMindMapData: (data) => {
        onEditorStateChangeRef.current({
          ...stateRef.current,
          editor_doc: cloneValue(data),
        })
      },
      getMindMapConfig: () => cloneValue(stateRef.current.editor_config),
      saveMindMapConfig: (config) => {
        onEditorStateChangeRef.current({
          ...stateRef.current,
          editor_config: cloneValue(config),
        })
      },
      getLanguage: () => stateRef.current.lang || 'zh',
      saveLanguage: (lang) => {
        onEditorStateChangeRef.current({
          ...stateRef.current,
          lang: lang || 'zh',
        })
      },
      getLocalConfig: () => cloneValue(stateRef.current.editor_local_config),
      saveLocalConfig: (config) => {
        onEditorStateChangeRef.current({
          ...stateRef.current,
          editor_local_config: cloneValue(config),
        })
      },
      notify: (event, payload) => {
        if (event === 'app_inited') {
          onReadyRef.current?.()
          syncHostState()
          return
        }
        if (event === 'node_active') {
          onNodeActiveRef.current?.(Array.isArray(payload) ? (payload as MindMapSelection[]) : [])
        }
        if (event === 'node_click') {
          onNodeClickRef.current?.(Array.isArray(payload) ? (payload as MindMapSelection[]) : [])
        }
        if (event === 'node_contextmenu') {
          onNodeContextMenuRef.current?.(Array.isArray(payload) ? (payload as MindMapSelection[]) : [])
        }
        if (event === 'segment_select') {
          onSegmentSelectRef.current?.(
            typeof payload === 'number' ? payload : payload == null ? null : Number(payload),
          )
        }
        if (event === 'segment_create_from_selection') {
          onCreateSegmentFromSelectionRef.current?.()
        }
        if (event === 'segment_range_draft_change') {
          const nextPayload =
            payload && typeof payload === 'object'
              ? (payload as {
                  selectedNodeUids?: unknown
                  overriddenConflictNodeUids?: unknown
                })
              : null
          onSegmentRangeDraftChangeRef.current?.({
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
              ? (payload as {
                  active?: unknown
                  targetSegmentId?: unknown
                })
              : null
          const rawTarget = nextPayload?.targetSegmentId
          onSegmentRangeModeToggleRef.current?.({
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
          onSegmentRangeConfirmRef.current?.()
        }
        if (event === 'fullscreen_change') {
          onFullscreenChangeRef.current?.(Boolean(payload))
        }
      },
    }

    return () => {
      if (window.__memoryAnkiMindMapHosts) {
        delete window.__memoryAnkiMindMapHosts[hostId]
      }
    }
  }, [hostId, syncHostState])

  useEffect(() => {
    if (isLoaded) {
      syncHostState()
    }
  }, [isLoaded, syncHostState])

  useEffect(() => {
    if (!syncOnPropChange || !isLoaded) return
        const fingerprint = JSON.stringify({
          editor_doc: normalizeEditorDoc(editorState.editor_doc),
          editor_config: editorState.editor_config,
          editor_local_config: editorState.editor_local_config,
          lang: editorState.lang,
          segments,
          activeSegmentId,
          segmentColorMode,
          segmentRangeDraft,
          preserveViewOnSync,
        })
    if (lastSyncedFingerprintRef.current === fingerprint) return
    lastSyncedFingerprintRef.current = fingerprint
    syncHostEditorState()
  }, [activeSegmentId, editorState, isLoaded, preserveViewOnSync, segmentColorMode, segmentRangeDraft, segments, syncHostEditorState, syncOnPropChange])

  return (
    <iframe
      ref={iframeRef}
      title="mind-map-editor"
      src={`/mind-map-host.html?host=${encodeURIComponent(hostId)}`}
      className={className ?? 'h-full w-full border-0'}
      onLoad={() => {
        setIsLoaded(true)
        syncHostState()
      }}
    />
  )
}
