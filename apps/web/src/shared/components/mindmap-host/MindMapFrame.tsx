import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { dispatchHostEvent } from '@/shared/components/mindmap-host/hostEventDispatcher'
import {
  buildHostBridgeHostState,
  buildSyncFingerprint,
  cloneValue,
  type HostBridge,
  type HostEditorStateSyncPayload,
  type MindMapHostWindow,
  normalizeEditorDoc,
} from '@/shared/components/mindmap-host/hostBridgeUtils'
import { useHostSyncController } from '@/shared/components/mindmap-host/useHostSyncController'
import {
  buildLocalEditorStateFingerprint,
  buildMindMapFrameClassName,
  HOST_FRAME_RUNTIME_VERSION,
  type MindMapFrameHandle,
  type MindMapFrameProps,
} from './MindMapFrame.types'
import { useMindMapFeedbackAudioCoordinator } from './useMindMapFeedbackAudioCoordinator'

export const MindMapFrame = forwardRef<MindMapFrameHandle, MindMapFrameProps>(function MindMapFrame({
  editorState,
  readonly = false,
  practiceModeActive = false,
  viewMemoryScope = null,
  immersiveModeActive = false,
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
  focusNodeUids = [],
  focusRequestNodeUid = null,
  focusRequestNonce = 0,
  miniPalaceDraft = {
    active: false,
    selectedNodeUids: [],
  },
  miniPalacePracticeActive = false,
  bilinkInsertionText = null,
  bilinkInsertionNonce = 0,
  reviewFxSignal = null,
  feedbackFxSignal = null,
  onEditorStateChange,
  onNodeActive,
  onNodeClick,
  onNodeContextMenu,
  onNodeHover,
  onSegmentSelect,
  onCreateSegmentFromSelection,
  onSegmentRangeDraftChange,
  onSegmentRangeModeToggle,
  onSegmentRangeConfirm,
  onAiSplitRequest,
  onFullscreenChange,
  onFullscreenToggle,
  onUiClearedChange,
  onBilinkTrigger,
  onBilinkNodeClick,
  onMiniPalacePour,
  onReady,
}: MindMapFrameProps, ref) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const stateRef = useRef(editorState)
  const onEditorStateChangeRef = useRef(onEditorStateChange)
  const onNodeActiveRef = useRef(onNodeActive)
  const onNodeClickRef = useRef(onNodeClick)
  const onNodeContextMenuRef = useRef(onNodeContextMenu)
  const onNodeHoverRef = useRef(onNodeHover)
  const onSegmentSelectRef = useRef(onSegmentSelect)
  const onCreateSegmentFromSelectionRef = useRef(onCreateSegmentFromSelection)
  const onSegmentRangeDraftChangeRef = useRef(onSegmentRangeDraftChange)
  const onSegmentRangeModeToggleRef = useRef(onSegmentRangeModeToggle)
  const onSegmentRangeConfirmRef = useRef(onSegmentRangeConfirm)
  const onAiSplitRequestRef = useRef(onAiSplitRequest)
  const onFullscreenChangeRef = useRef(onFullscreenChange)
  const onFullscreenToggleRef = useRef(onFullscreenToggle)
  const onEnterNativeFullscreenRef = useRef<(() => void) | undefined>(undefined)
  const onExitNativeFullscreenRef = useRef<(() => void) | undefined>(undefined)
  const onUiClearedChangeRef = useRef(onUiClearedChange)
  const onBilinkTriggerRef = useRef(onBilinkTrigger)
  const onBilinkNodeClickRef = useRef(onBilinkNodeClick)
  const onMiniPalacePourRef = useRef(onMiniPalacePour)
  const onReadyRef = useRef(onReady)
  const lastForcedSyncKeyRef = useRef<string | null>(null)
  const lastBilinkInsertionNonceRef = useRef<number>(0)
  const lastReviewFxNonceRef = useRef<number>(0)
  const lastFeedbackFxNonceRef = useRef<number>(0)
  const pendingLocalCommitFingerprintRef = useRef<string | null>(null)
  const hostHydratedRef = useRef(false)
  const [isIframeLoaded, setIsIframeLoaded] = useState(false)
  const { handleFeedbackRuntimePayload } = useMindMapFeedbackAudioCoordinator()

  stateRef.current = editorState
  onEditorStateChangeRef.current = onEditorStateChange
  onNodeActiveRef.current = onNodeActive
  onNodeClickRef.current = onNodeClick
  onNodeContextMenuRef.current = onNodeContextMenu
  onNodeHoverRef.current = onNodeHover
  onSegmentSelectRef.current = onSegmentSelect
  onCreateSegmentFromSelectionRef.current = onCreateSegmentFromSelection
  onSegmentRangeDraftChangeRef.current = onSegmentRangeDraftChange
  onSegmentRangeModeToggleRef.current = onSegmentRangeModeToggle
  onSegmentRangeConfirmRef.current = onSegmentRangeConfirm
  onAiSplitRequestRef.current = onAiSplitRequest
  onFullscreenChangeRef.current = onFullscreenChange
  onFullscreenToggleRef.current = onFullscreenToggle
  onUiClearedChangeRef.current = onUiClearedChange
  onBilinkTriggerRef.current = onBilinkTrigger
  onBilinkNodeClickRef.current = onBilinkNodeClick
  onMiniPalacePourRef.current = onMiniPalacePour
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
        practiceModeActive,
        viewMemoryScope,
        immersiveModeActive,
        aiSplitBusy,
        segments,
        activeSegmentId,
        segmentColorMode,
        segmentRangeDraft,
        bilinkCounts,
        bilinkItems,
        bilinkCurrentPalaceId,
        focusNodeUids,
        focusRequestNodeUid,
        focusRequestNonce,
        miniPalaceDraft,
        miniPalacePracticeActive,
        hasAiSplitRequest: Boolean(onAiSplitRequestRef.current),
      }),
    )
  }, [
    activeSegmentId,
    aiSplitBusy,
    bilinkCounts,
    bilinkCurrentPalaceId,
    bilinkItems,
    focusRequestNodeUid,
    focusRequestNonce,
    miniPalaceDraft,
    miniPalacePracticeActive,
    focusNodeUids,
    immersiveModeActive,
    practiceModeActive,
    readonly,
    segmentColorMode,
    segmentRangeDraft,
    segments,
    viewMemoryScope,
  ])

  const dispatchIframeResizeSignal = useCallback(() => {
    const iframeWindow = iframeRef.current?.contentWindow as
      | (Window & {
          dispatchEvent?: (event: Event) => boolean
        })
      | null
    iframeWindow?.dispatchEvent?.(new Event('resize'))
  }, [])

  useLayoutEffect(() => {
    const iframeElement = iframeRef.current
    if (!iframeElement || typeof ResizeObserver === 'undefined') return

    let frameId: number | null = null
    const scheduleResizeSignal = () => {
      if (frameId != null) {
        window.cancelAnimationFrame(frameId)
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null
        dispatchIframeResizeSignal()
      })
    }

    const observer = new ResizeObserver(() => {
      scheduleResizeSignal()
    })
    observer.observe(iframeElement)

    return () => {
      observer.disconnect()
      if (frameId != null) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [dispatchIframeResizeSignal])

  const setIframeUiCleared = useCallback((nextValue: boolean) => {
    const iframeWindow = iframeRef.current?.contentWindow as MindMapHostWindow | null
    iframeWindow?.setUiCleared?.(nextValue)
  }, [])

  const toggleIframeUiCleared = useCallback(() => {
    const iframeWindow = iframeRef.current?.contentWindow as MindMapHostWindow | null
    iframeWindow?.toggleUiCleared?.()
  }, [])

  const enterIframeNativeFullscreen = useCallback(async () => {
    // 使用 CSS 伪全屏而非浏览器原生 Fullscreen API。
    // 原因：原生 requestFullscreen 会创建顶层上下文，只有全屏元素及其后代可见，
    // 导致父文档的 Dialog（Radix Portal 挂载到 body）、GlobalFeedbackProvider 反馈层、
    // 连击庆祝/完成庆祝 overlay 等全部不可见（它们是 iframe 的兄弟节点）。
    // CSS 伪全屏通过 fixed + inset:0 + 高 z-index 模拟全屏效果，
    // 同时保留所有 React overlay 的可见性。
    const iframeElement = iframeRef.current
    if (!iframeElement) return
    iframeElement.classList.add('memory-anki-mindmap-native-fullscreen')
    onFullscreenChangeRef.current?.(true)
    // 通知 iframe 内部状态 + 触发 resize
    const iframeWindow = iframeRef.current?.contentWindow as
      | (Window & {
          __memoryAnkiParentFullscreenActive?: boolean
          dispatchEvent?: (event: Event) => boolean
        })
      | null
    if (iframeWindow) {
      iframeWindow.__memoryAnkiParentFullscreenActive = true
      iframeWindow.dispatchEvent?.(new Event('resize'))
    }
  }, [])

  const exitIframeNativeFullscreen = useCallback(async () => {
    // 退出 CSS 伪全屏
    const iframeElement = iframeRef.current
    if (!iframeElement) return
    iframeElement.classList.remove('memory-anki-mindmap-native-fullscreen')
    onFullscreenChangeRef.current?.(false)
    const iframeWindow = iframeRef.current?.contentWindow as
      | (Window & {
          __memoryAnkiParentFullscreenActive?: boolean
          dispatchEvent?: (event: Event) => boolean
        })
      | null
    if (iframeWindow) {
      iframeWindow.__memoryAnkiParentFullscreenActive = false
      iframeWindow.dispatchEvent?.(new Event('resize'))
    }
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      setUiCleared: setIframeUiCleared,
      toggleUiCleared: toggleIframeUiCleared,
      enterNativeFullscreen: enterIframeNativeFullscreen,
      exitNativeFullscreen: exitIframeNativeFullscreen,
    }),
    [
      enterIframeNativeFullscreen,
      exitIframeNativeFullscreen,
      setIframeUiCleared,
      toggleIframeUiCleared,
    ],
  )

  // 监听浏览器原生 fullscreenchange（仅在 iframe 内部意外触发原生全屏时兜底）
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isActive = Boolean(document.fullscreenElement)
      if (!isActive) {
        // 退出原生全屏时清理 CSS 伪全屏状态
        const iframeElement = iframeRef.current
        iframeElement?.classList.remove('memory-anki-mindmap-native-fullscreen')
      }
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [])

  // 保持原生全屏请求回调引用最新
  useEffect(() => {
    onEnterNativeFullscreenRef.current = () => {
      void enterIframeNativeFullscreen()
    }
    onExitNativeFullscreenRef.current = () => {
      void exitIframeNativeFullscreen()
    }
  }, [enterIframeNativeFullscreen, exitIframeNativeFullscreen])

  const forwardLocalEditorStateChange = useCallback((nextState: MindMapEditorState) => {
    pendingLocalCommitFingerprintRef.current = buildLocalEditorStateFingerprint(nextState)
    onEditorStateChangeRef.current(nextState)
  }, [])

  const promoteHostReadyFromRuntimeEvent = useCallback(() => {
    if (hostReadyRef.current) return
    const iframeWindow = iframeRef.current?.contentWindow as MindMapHostWindow | null
    if (typeof iframeWindow?.syncHostEditorState !== 'function') return
    markHostReady()
    syncHostState()
    flushPendingHostEditorStateSync()
  }, [flushPendingHostEditorStateSync, hostReadyRef, markHostReady, syncHostState])

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

  useEffect(() => {
    if (!isIframeLoaded) return
    const iframeWindow = iframeRef.current?.contentWindow as MindMapHostWindow | null
    if (!iframeWindow) return
    if (reviewFxSignal == null) {
      iframeWindow.clearReviewFx?.()
      return
    }
    if (reviewFxSignal.nonce === lastReviewFxNonceRef.current) return
    lastReviewFxNonceRef.current = reviewFxSignal.nonce
    iframeWindow.emitReviewFx?.(reviewFxSignal)
  }, [isIframeLoaded, reviewFxSignal])

  useEffect(() => {
    if (!isIframeLoaded) return
    const iframeWindow = iframeRef.current?.contentWindow as MindMapHostWindow | null
    if (!iframeWindow || feedbackFxSignal == null) return
    if (feedbackFxSignal.nonce === lastFeedbackFxNonceRef.current) return
    lastFeedbackFxNonceRef.current = feedbackFxSignal.nonce
    iframeWindow.emitFeedbackFx?.(feedbackFxSignal)
  }, [feedbackFxSignal, isIframeLoaded])

  useLayoutEffect(() => {
    const registry = (window.__memoryAnkiMindMapHosts ??= {})
    registry[hostId] = {
      getMindMapData: () => normalizeEditorDoc(stateRef.current.editor_doc),
      saveMindMapData: (data) => {
        if (readonly || !hostHydratedRef.current) return
        forwardLocalEditorStateChange({
          ...stateRef.current,
          editor_doc: cloneValue(data),
        })
      },
      getMindMapConfig: () => cloneValue(stateRef.current.editor_config),
      saveMindMapConfig: (config) => {
        if (readonly || !hostHydratedRef.current) return
        forwardLocalEditorStateChange({
          ...stateRef.current,
          editor_config: cloneValue(config),
        })
      },
      getLanguage: () => stateRef.current.lang || 'zh',
      saveLanguage: (lang) => {
        if (readonly || !hostHydratedRef.current) return
        forwardLocalEditorStateChange({
          ...stateRef.current,
          lang: lang || 'zh',
        })
      },
      getLocalConfig: () => cloneValue(stateRef.current.editor_local_config),
      saveLocalConfig: (config) => {
        if (readonly || !hostHydratedRef.current) return
        forwardLocalEditorStateChange({
          ...stateRef.current,
          editor_local_config: cloneValue(config),
        })
      },
      isHydrated: () => hostHydratedRef.current,
      notify: (event, payload) => {
        if (event !== 'app_inited') {
          promoteHostReadyFromRuntimeEvent()
        }
        if (event === 'initial_hydration_complete') {
          hostHydratedRef.current = true
        }
        if (event === 'feedback_event') {
          handleFeedbackRuntimePayload(payload)
        }
        const result = dispatchHostEvent(event, payload, {
          onNodeActive: onNodeActiveRef,
          onNodeClick: onNodeClickRef,
          onNodeContextMenu: onNodeContextMenuRef,
          onNodeHover: onNodeHoverRef,
          onSegmentSelect: onSegmentSelectRef,
          onCreateSegmentFromSelection: onCreateSegmentFromSelectionRef,
          onSegmentRangeDraftChange: onSegmentRangeDraftChangeRef,
          onSegmentRangeModeToggle: onSegmentRangeModeToggleRef,
          onSegmentRangeConfirm: onSegmentRangeConfirmRef,
          onAiSplitRequest: onAiSplitRequestRef,
          onFullscreenChange: onFullscreenChangeRef,
          onFullscreenToggle: onFullscreenToggleRef,
          onEnterNativeFullscreen: onEnterNativeFullscreenRef,
          onExitNativeFullscreen: onExitNativeFullscreenRef,
          onUiClearedChange: onUiClearedChangeRef,
          onBilinkTrigger: onBilinkTriggerRef,
          onBilinkNodeClick: onBilinkNodeClickRef,
          onMiniPalacePour: onMiniPalacePourRef,
          onReady: onReadyRef,
        })
        if (result === 'app_inited') {
          hostHydratedRef.current = readonly
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
      forwardLocalEditorStateChange,
      flushPendingHostEditorStateSync,
      handleFeedbackRuntimePayload,
      hostId,
      promoteHostReadyFromRuntimeEvent,
    preserveViewOnSync,
    readonly,
    segmentColorMode,
    segmentRangeDraft,
    miniPalaceDraft,
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
    const localEditorStateFingerprint = buildLocalEditorStateFingerprint(editorState)
    const matchedPendingLocalCommit =
      pendingLocalCommitFingerprintRef.current === localEditorStateFingerprint
    if (matchedPendingLocalCommit) {
      pendingLocalCommitFingerprintRef.current = null
    }
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
    if (
      !readonly &&
      syncIntent === 'soft' &&
      pendingLocalCommitFingerprintRef.current &&
      pendingLocalCommitFingerprintRef.current !== localEditorStateFingerprint
    ) {
      return
    }
    if (!readonly && matchedPendingLocalCommit) {
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
    pendingLocalCommitFingerprintRef.current = null
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
      src={`/mind-map-host.html?host=${encodeURIComponent(hostId)}&v=${HOST_FRAME_RUNTIME_VERSION}`}
      className={buildMindMapFrameClassName(className)}
      onLoad={() => {
        hostHydratedRef.current = readonly
        resetHostReady()
        setIsIframeLoaded(true)
        syncHostState()
        dispatchIframeResizeSignal()
      }}
    />
  )
})

MindMapFrame.displayName = 'MindMapFrame'

export type { MindMapFrameHandle } from './MindMapFrame.types'
