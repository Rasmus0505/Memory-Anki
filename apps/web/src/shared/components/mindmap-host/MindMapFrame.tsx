import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MindMapEditorState } from '@/shared/api/client'
import type {
  BilinkItem,
  MindMapHostSegmentRangeDraft,
  MindMapHostSegmentSummary,
} from '@/shared/api/contracts'
import { dispatchHostEvent } from '@/shared/components/mindmap-host/hostEventDispatcher'
import {
  buildHostBridgeHostState,
  buildSyncFingerprint,
  cloneValue,
  type HostBridge,
  type HostEditorStateSyncPayload,
  type MindMapAiSplitRequestPayload,
  type MindMapHostWindow,
  type MindMapSelection,
  normalizeEditorDoc,
} from '@/shared/components/mindmap-host/hostBridgeUtils'
import { useHostSyncController } from '@/shared/components/mindmap-host/useHostSyncController'

interface MindMapFrameProps {
  editorState: MindMapEditorState
  readonly?: boolean
  showToolbarWhenReadonly?: boolean
  practiceModeActive?: boolean
  practiceToggleLabel?: '练习' | '编辑' | '复习'
  viewMemoryScope?: string | null
  immersiveModeActive?: boolean
  showImportButtons?: boolean
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
  onAiSplitRequest?: (payload: MindMapAiSplitRequestPayload) => void
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

export function MindMapFrame({
  editorState,
  readonly = false,
  showToolbarWhenReadonly = false,
  practiceModeActive = false,
  practiceToggleLabel = '练习',
  viewMemoryScope = null,
  immersiveModeActive = false,
  showImportButtons = false,
  aiSplitBusy = false,
  syncOnPropChange = false,
  syncIntent = 'soft',
  syncReason = null,
  externalSyncKey = null,
  forceSyncKey = null,
  forceSyncIntent = 'replace',
  preserveViewOnSync = false,
  initialViewPolicy = 'preserve',
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
  onAiSplitRequest,
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
  const onAiSplitRequestRef = useRef(onAiSplitRequest)
  const onFullscreenChangeRef = useRef(onFullscreenChange)
  const onFullscreenToggleRef = useRef(onFullscreenToggle)
  const onBilinkTriggerRef = useRef(onBilinkTrigger)
  const onBilinkNodeClickRef = useRef(onBilinkNodeClick)
  const onBilinkToolbarSearchRef = useRef(onBilinkToolbarSearch)
  const onReadyRef = useRef(onReady)
  const lastForcedSyncKeyRef = useRef<string | null>(null)
  const lastBilinkInsertionNonceRef = useRef<number>(0)
  const suppressNextPropSyncRef = useRef(false)
  const [isIframeLoaded, setIsIframeLoaded] = useState(false)

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
  onAiSplitRequestRef.current = onAiSplitRequest
  onFullscreenChangeRef.current = onFullscreenChange
  onFullscreenToggleRef.current = onFullscreenToggle
  onBilinkTriggerRef.current = onBilinkTrigger
  onBilinkNodeClickRef.current = onBilinkNodeClick
  onBilinkToolbarSearchRef.current = onBilinkToolbarSearch
  onReadyRef.current = onReady

  const rawHostId = useId()
  const hostId = useMemo(() => rawHostId.replace(/[^a-zA-Z0-9_-]/g, '_'), [rawHostId])
  const {
    buildHostEditorStateSyncPayload,
    flushPendingHostEditorStateSync,
    hostReadyRef,
    lastSyncedFingerprintRef,
    markHostReady,
    resetHostReady,
    syncOrQueueHostEditorState,
  } = useHostSyncController({
    iframeRef,
    preserveViewOnSync,
    initialViewPolicy,
  })

  const syncHostState = useCallback(() => {
    const iframeWindow = iframeRef.current?.contentWindow as MindMapHostWindow | null
    iframeWindow?.applyHostState?.(
      buildHostBridgeHostState({
        readonly,
        showToolbarWhenReadonly,
        practiceModeActive,
        practiceToggleLabel,
        viewMemoryScope,
        immersiveModeActive,
        showImportButtons: Boolean(showImportButtons),
        aiSplitBusy,
        segments,
        activeSegmentId,
        segmentColorMode,
        segmentRangeDraft,
        bilinkCounts,
        bilinkItems,
        bilinkCurrentPalaceId,
        showBilinkSearchButton,
        hasPracticeToggle: Boolean(onPracticeToggleRef.current),
        hasAiSplitRequest: Boolean(onAiSplitRequestRef.current),
      }),
    )
  }, [
    activeSegmentId,
    aiSplitBusy,
    bilinkCounts,
    bilinkCurrentPalaceId,
    bilinkItems,
    immersiveModeActive,
    practiceModeActive,
    practiceToggleLabel,
    readonly,
    segmentColorMode,
    segmentRangeDraft,
    segments,
    showBilinkSearchButton,
    showImportButtons,
    showToolbarWhenReadonly,
    viewMemoryScope,
  ])

  const promoteHostReadyFromRuntimeEvent = useCallback(() => {
    if (hostReadyRef.current) return
    const iframeWindow = iframeRef.current?.contentWindow as MindMapHostWindow | null
    if (typeof iframeWindow?.syncHostEditorState !== 'function') return
    markHostReady()
    flushPendingHostEditorStateSync()
  }, [flushPendingHostEditorStateSync, hostReadyRef, markHostReady])

  useEffect(() => {
    if (!isIframeLoaded || !bilinkInsertionText) return
    if (bilinkInsertionNonce === lastBilinkInsertionNonceRef.current) return
    lastBilinkInsertionNonceRef.current = bilinkInsertionNonce
    const iframeWindow = iframeRef.current?.contentWindow as
      | (Window & {
          insertBilinkMark?: (text: string) => boolean
        })
      | null
    iframeWindow?.insertBilinkMark?.(bilinkInsertionText)
  }, [bilinkInsertionNonce, bilinkInsertionText, isIframeLoaded])

  useLayoutEffect(() => {
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
        if (event !== 'app_inited') {
          promoteHostReadyFromRuntimeEvent()
        }
        const result = dispatchHostEvent(event, payload, {
          onNodeActive: onNodeActiveRef,
          onNodeClick: onNodeClickRef,
          onNodeContextMenu: onNodeContextMenuRef,
          onSegmentSelect: onSegmentSelectRef,
          onCreateSegmentFromSelection: onCreateSegmentFromSelectionRef,
          onSegmentRangeDraftChange: onSegmentRangeDraftChangeRef,
          onSegmentRangeModeToggle: onSegmentRangeModeToggleRef,
          onSegmentRangeConfirm: onSegmentRangeConfirmRef,
          onPracticeToggle: onPracticeToggleRef,
          onMindMapImportOpen: onMindMapImportOpenRef,
          onImageTextImportOpen: onImageTextImportOpenRef,
          onAiSplitRequest: onAiSplitRequestRef,
          onFullscreenChange: onFullscreenChangeRef,
          onFullscreenToggle: onFullscreenToggleRef,
          onBilinkTrigger: onBilinkTriggerRef,
          onBilinkNodeClick: onBilinkNodeClickRef,
          onBilinkToolbarSearch: onBilinkToolbarSearchRef,
          onReady: onReadyRef,
        })
        if (result === 'app_inited') {
          markHostReady()
          syncHostState()
          flushPendingHostEditorStateSync()
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
    flushPendingHostEditorStateSync,
    hostId,
    promoteHostReadyFromRuntimeEvent,
    preserveViewOnSync,
    readonly,
    segmentColorMode,
    segmentRangeDraft,
    segments,
    syncHostState,
  ])

  useEffect(() => {
    if (isIframeLoaded) {
      syncHostState()
    }
  }, [isIframeLoaded, syncHostState])

  useEffect(() => {
    if (!syncOnPropChange || !isIframeLoaded) return
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
    syncOrQueueHostEditorState(
      buildHostEditorStateSyncPayload(editorState, fingerprint, syncIntent, syncReason, 'prop'),
    )
  }, [
    activeSegmentId,
    buildHostEditorStateSyncPayload,
    editorState,
    externalSyncKey,
    isIframeLoaded,
    preserveViewOnSync,
    readonly,
    syncIntent,
    syncReason,
    segmentColorMode,
    segmentRangeDraft,
    bilinkCounts,
    segments,
    syncOrQueueHostEditorState,
    syncOnPropChange,
  ])

  useEffect(() => {
    if (!isIframeLoaded || forceSyncKey == null) return
    const syncKey = String(forceSyncKey)
    if (lastForcedSyncKeyRef.current === syncKey) return
    lastForcedSyncKeyRef.current = syncKey
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
    suppressNextPropSyncRef.current = false
    syncOrQueueHostEditorState(
      buildHostEditorStateSyncPayload(editorState, fingerprint, forceSyncIntent, null, 'force'),
    )
  }, [
    activeSegmentId,
    buildHostEditorStateSyncPayload,
    editorState,
    externalSyncKey,
    forceSyncKey,
    forceSyncIntent,
    isIframeLoaded,
    preserveViewOnSync,
    segmentColorMode,
    segmentRangeDraft,
    bilinkCounts,
    segments,
    syncOrQueueHostEditorState,
  ])

  return (
    <iframe
      ref={iframeRef}
      title="mind-map-editor"
      src={`/mind-map-host.html?host=${encodeURIComponent(hostId)}`}
      className={className ?? 'h-full w-full border-0'}
      onLoad={() => {
        resetHostReady()
        setIsIframeLoaded(true)
        syncHostState()
      }}
    />
  )
}
