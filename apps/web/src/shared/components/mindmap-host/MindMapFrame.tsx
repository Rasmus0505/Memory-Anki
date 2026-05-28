import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { MindMapEditorState } from '@/shared/api/client'
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

interface MindMapFrameProps {
  editorState: MindMapEditorState
  readonly?: boolean
  showToolbarWhenReadonly?: boolean
  practiceModeActive?: boolean
  practiceToggleLabel?: '练习' | '复习'
  immersiveModeActive?: boolean
  showImportButtons?: boolean
  syncOnPropChange?: boolean
  externalSyncKey?: string | number | null
  forceSyncKey?: string | number | null
  preserveViewOnSync?: boolean
  className?: string
  segments?: MindMapHostSegmentSummary[]
  activeSegmentId?: number | null
  segmentColorMode?: 'all' | 'active-only' | 'all-with-active-emphasis'
  segmentRangeDraft?: MindMapHostSegmentRangeDraft
  bilinkCounts?: Record<string, number>
  bilinkItems?: BilinkItem[]
  bilinkCurrentPalaceId?: number | null
  bilinkInsertionText?: string | null
  bilinkInsertionNonce?: number
  showBilinkSearchButton?: boolean
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
  onPracticeToggle?: () => void
  onMindMapImportOpen?: () => void
  onImageTextImportOpen?: () => void
  onFullscreenChange?: (active: boolean) => void
  onFullscreenToggle?: (active?: boolean) => void
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
  onBilinkToolbarSearch?: () => void
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

function buildSyncFingerprint(args: {
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
  return JSON.stringify({
    editor_doc: normalizeEditorDoc(editorState.editor_doc),
    editor_config: editorState.editor_config,
    editor_local_config: editorState.editor_local_config,
    lang: editorState.lang,
    segments,
    activeSegmentId,
    segmentColorMode,
    segmentRangeDraft,
    bilinkCounts,
    preserveViewOnSync,
    externalSyncKey,
  })
}

export function MindMapFrame({
  editorState,
  readonly = false,
  showToolbarWhenReadonly = false,
  practiceModeActive = false,
  practiceToggleLabel = '练习',
  immersiveModeActive = false,
  showImportButtons = false,
  syncOnPropChange = false,
  externalSyncKey = null,
  forceSyncKey = null,
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
  bilinkCounts = {},
  bilinkItems = [],
  bilinkCurrentPalaceId = null,
  bilinkInsertionText = null,
  bilinkInsertionNonce = 0,
  showBilinkSearchButton = false,
  onEditorStateChange,
  onNodeActive,
  onNodeClick,
  onNodeContextMenu,
  onSegmentSelect,
  onCreateSegmentFromSelection,
  onSegmentRangeDraftChange,
  onSegmentRangeModeToggle,
  onSegmentRangeConfirm,
  onPracticeToggle,
  onMindMapImportOpen,
  onImageTextImportOpen,
  onFullscreenChange,
  onFullscreenToggle,
  onBilinkTrigger,
  onBilinkNodeClick,
  onBilinkToolbarSearch,
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
  const onPracticeToggleRef = useRef(onPracticeToggle)
  const onMindMapImportOpenRef = useRef(onMindMapImportOpen)
  const onImageTextImportOpenRef = useRef(onImageTextImportOpen)
  const onFullscreenChangeRef = useRef(onFullscreenChange)
  const onFullscreenToggleRef = useRef(onFullscreenToggle)
  const onBilinkTriggerRef = useRef(onBilinkTrigger)
  const onBilinkNodeClickRef = useRef(onBilinkNodeClick)
  const onBilinkToolbarSearchRef = useRef(onBilinkToolbarSearch)
  const onReadyRef = useRef(onReady)
  const lastSyncedFingerprintRef = useRef('')
  const lastForcedSyncKeyRef = useRef<string | null>(null)
  const lastBilinkInsertionNonceRef = useRef<number>(0)
  const suppressNextPropSyncRef = useRef(false)
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
  onPracticeToggleRef.current = onPracticeToggle
  onMindMapImportOpenRef.current = onMindMapImportOpen
  onImageTextImportOpenRef.current = onImageTextImportOpen
  onFullscreenChangeRef.current = onFullscreenChange
  onFullscreenToggleRef.current = onFullscreenToggle
  onBilinkTriggerRef.current = onBilinkTrigger
  onBilinkNodeClickRef.current = onBilinkNodeClick
  onBilinkToolbarSearchRef.current = onBilinkToolbarSearch
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
            showPracticeButton: boolean
            practiceModeActive: boolean
            practiceToggleLabel: '练习' | '复习'
            immersiveModeActive: boolean
            showImportButtons: boolean
            segments: MindMapHostSegmentSummary[]
            activeSegmentId: number | null
            segmentColorMode: 'all' | 'active-only' | 'all-with-active-emphasis'
            segmentRangeDraft: MindMapHostSegmentRangeDraft
            bilinkCounts: Record<string, number>
            bilinkItems: BilinkItem[]
            bilinkCurrentPalaceId: number | null
            showBilinkSearchButton: boolean
          }) => void
          resetReadonlyInteractionState?: () => void
        })
      | null
    iframeWindow?.applyHostState?.({
      readonly,
      showToolbarWhenReadonly,
      showPracticeButton: Boolean(onPracticeToggleRef.current),
      practiceModeActive,
      practiceToggleLabel,
      immersiveModeActive,
      showImportButtons: Boolean(showImportButtons),
      segments: cloneValue(segments),
      activeSegmentId,
      segmentColorMode,
      segmentRangeDraft: cloneValue(segmentRangeDraft),
      bilinkCounts: cloneValue(bilinkCounts),
      bilinkItems: cloneValue(bilinkItems),
      bilinkCurrentPalaceId,
      showBilinkSearchButton,
    })
    if (readonly) {
      iframeWindow?.resetReadonlyInteractionState?.()
    }
  }, [
    activeSegmentId,
    practiceModeActive,
    practiceToggleLabel,
    immersiveModeActive,
    readonly,
    showImportButtons,
    segmentColorMode,
    segmentRangeDraft,
    bilinkCounts,
    bilinkCurrentPalaceId,
    bilinkItems,
    showBilinkSearchButton,
    segments,
    showToolbarWhenReadonly,
  ])

  useEffect(() => {
    if (!isLoaded || !bilinkInsertionText) return
    if (bilinkInsertionNonce === lastBilinkInsertionNonceRef.current) return
    lastBilinkInsertionNonceRef.current = bilinkInsertionNonce
    const iframeWindow = iframeRef.current?.contentWindow as
      | (Window & {
          insertBilinkMark?: (text: string) => boolean
        })
      | null
    iframeWindow?.insertBilinkMark?.(bilinkInsertionText)
  }, [bilinkInsertionNonce, bilinkInsertionText, isLoaded])

  useEffect(() => {
    const registry = (window.__memoryAnkiMindMapHosts ??= {})
    registry[hostId] = {
      getMindMapData: () => normalizeEditorDoc(stateRef.current.editor_doc),
      saveMindMapData: (data) => {
        if (readonly) return
        suppressNextPropSyncRef.current = true
        onEditorStateChangeRef.current({
          ...stateRef.current,
          editor_doc: cloneValue(data),
        })
      },
      getMindMapConfig: () => cloneValue(stateRef.current.editor_config),
      saveMindMapConfig: (config) => {
        if (readonly) return
        suppressNextPropSyncRef.current = true
        onEditorStateChangeRef.current({
          ...stateRef.current,
          editor_config: cloneValue(config),
        })
      },
      getLanguage: () => stateRef.current.lang || 'zh',
      saveLanguage: (lang) => {
        if (readonly) return
        suppressNextPropSyncRef.current = true
        onEditorStateChangeRef.current({
          ...stateRef.current,
          lang: lang || 'zh',
        })
      },
      getLocalConfig: () => cloneValue(stateRef.current.editor_local_config),
      saveLocalConfig: (config) => {
        if (readonly) return
        suppressNextPropSyncRef.current = true
        onEditorStateChangeRef.current({
          ...stateRef.current,
          editor_local_config: cloneValue(config),
        })
      },
      notify: (event, payload) => {
        if (event === 'app_inited') {
          lastSyncedFingerprintRef.current = buildSyncFingerprint({
            editorState: stateRef.current,
            activeSegmentId,
            segmentColorMode,
            segmentRangeDraft,
            bilinkCounts,
            segments,
            preserveViewOnSync,
            externalSyncKey,
          })
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
        if (event === 'practice_toggle') {
          onPracticeToggleRef.current?.()
        }
        if (event === 'mindmap_import_open') {
          onMindMapImportOpenRef.current?.()
        }
        if (event === 'image_text_import_open') {
          onImageTextImportOpenRef.current?.()
        }
        if (event === 'fullscreen_change') {
          onFullscreenChangeRef.current?.(Boolean(payload))
        }
        if (event === 'fullscreen_toggle') {
          onFullscreenToggleRef.current?.(
            typeof payload === 'boolean' ? payload : undefined,
          )
        }
        if (event === 'bilink_trigger') {
          const nextPayload =
            payload && typeof payload === 'object'
              ? (payload as {
                  nodeUid?: unknown
                  left?: unknown
                  top?: unknown
                  query?: unknown
                })
              : null
          onBilinkTriggerRef.current?.({
            nodeUid: typeof nextPayload?.nodeUid === 'string' ? nextPayload.nodeUid : null,
            left: typeof nextPayload?.left === 'number' ? nextPayload.left : 0,
            top: typeof nextPayload?.top === 'number' ? nextPayload.top : 0,
            query: typeof nextPayload?.query === 'string' ? nextPayload.query : '',
          })
        }
        if (event === 'bilink_node_click') {
          const nextPayload =
            payload && typeof payload === 'object'
              ? (payload as {
                  palaceId?: unknown
                  nodeUid?: unknown
                  trigger?: unknown
                })
              : null
          onBilinkNodeClickRef.current?.({
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
          onBilinkToolbarSearchRef.current?.()
        }
      },
    }

    return () => {
      if (window.__memoryAnkiMindMapHosts) {
        delete window.__memoryAnkiMindMapHosts[hostId]
      }
    }
  }, [
    activeSegmentId,
    bilinkCounts,
    externalSyncKey,
    hostId,
    preserveViewOnSync,
    readonly,
    segmentColorMode,
    segmentRangeDraft,
    segments,
    syncHostState,
  ])

  useEffect(() => {
    if (isLoaded) {
      syncHostState()
    }
  }, [isLoaded, syncHostState])

  useEffect(() => {
    if (!syncOnPropChange || !isLoaded) return
    const fingerprint = buildSyncFingerprint({
      editorState,
      activeSegmentId,
      segmentColorMode,
      segmentRangeDraft,
      bilinkCounts,
      segments,
      preserveViewOnSync,
      externalSyncKey,
    })
    if (lastSyncedFingerprintRef.current === fingerprint) return
    if (!readonly && suppressNextPropSyncRef.current) {
      suppressNextPropSyncRef.current = false
      lastSyncedFingerprintRef.current = fingerprint
      return
    }
    lastSyncedFingerprintRef.current = fingerprint
    syncHostEditorState()
  }, [
    activeSegmentId,
    editorState,
    externalSyncKey,
    isLoaded,
    preserveViewOnSync,
    segmentColorMode,
    segmentRangeDraft,
    bilinkCounts,
    segments,
    syncHostEditorState,
    syncOnPropChange,
  ])

  useEffect(() => {
    if (!isLoaded || forceSyncKey == null) return
    const syncKey = String(forceSyncKey)
    if (lastForcedSyncKeyRef.current === syncKey) return
    lastForcedSyncKeyRef.current = syncKey
    lastSyncedFingerprintRef.current = buildSyncFingerprint({
      editorState,
      activeSegmentId,
      segmentColorMode,
      segmentRangeDraft,
      bilinkCounts,
      segments,
      preserveViewOnSync,
      externalSyncKey,
    })
    suppressNextPropSyncRef.current = false
    syncHostEditorState()
  }, [
    activeSegmentId,
    editorState,
    externalSyncKey,
    forceSyncKey,
    isLoaded,
    preserveViewOnSync,
    segmentColorMode,
    segmentRangeDraft,
    bilinkCounts,
    segments,
    syncHostEditorState,
  ])

  return (
    <iframe
      ref={iframeRef}
      title="mind-map-editor"
      src={`/mind-map-host.html?host=${encodeURIComponent(hostId)}`}
      className={className ?? 'h-full w-full border-0'}
      onLoad={() => {
        lastSyncedFingerprintRef.current = buildSyncFingerprint({
          editorState: stateRef.current,
          activeSegmentId,
          segmentColorMode,
          segmentRangeDraft,
          bilinkCounts,
          segments,
          preserveViewOnSync,
          externalSyncKey,
        })
        setIsLoaded(true)
        syncHostState()
      }}
    />
  )
}
