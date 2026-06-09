import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MindMapEditorState } from '@/shared/api/contracts'
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
  type MindMapFeedbackEvent,
  type MindMapFeedbackFxPayload,
  type MindMapAiSplitRequestPayload,
  type MindMapReviewFxPayload,
  type MindMapHostWindow,
  type MindMapSelection,
  normalizeEditorDoc,
} from '@/shared/components/mindmap-host/hostBridgeUtils'
import { useHostSyncController } from '@/shared/components/mindmap-host/useHostSyncController'
import { useMindMapFeedbackAudioFromSettings } from '@/shared/components/mindmap-host/useMindMapFeedback'

const HOST_FRAME_RUNTIME_VERSION = '2026-06-09-mode-focus'

function buildLocalEditorStateFingerprint(editorState: MindMapEditorState) {
  return JSON.stringify({
    editor_doc: normalizeEditorDoc(editorState.editor_doc),
    editor_config: editorState.editor_config,
    editor_local_config: editorState.editor_local_config,
    lang: editorState.lang || 'zh',
  })
}

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
  focusNodeUids?: string[]
  focusRequestNodeUid?: string | null
  focusRequestNonce?: number
  bilinkInsertionText?: string | null
  bilinkInsertionNonce?: number
  reviewFxSignal?: MindMapReviewFxPayload | null
  feedbackFxSignal?: MindMapFeedbackFxPayload | null
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
  onEnglishOpen?: () => void
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

function isMindMapFeedbackEvent(value: unknown): value is MindMapFeedbackEvent {
  return (
    value === 'category_expand' ||
    value === 'next_level_expand' ||
    value === 'card_reveal' ||
    value === 'branch_clear' ||
    value === 'all_clear_ready' ||
    value === 'session_complete' ||
    value === 'session_reset' ||
    value === 'hover_pulse' ||
    value === 'pointer_down' ||
    value === 'pointer_click' ||
    value === 'shortcut_trigger' ||
    value === 'navigation' ||
    value === 'field_focus' ||
    value === 'field_commit' ||
    value === 'toggle_on' ||
    value === 'toggle_off' ||
    value === 'key_press' ||
    value === 'text_commit' ||
    value === 'node_select' ||
    value === 'node_edit_start' ||
    value === 'node_create' ||
    value === 'node_delete' ||
    value === 'node_move' ||
    value === 'drag_start' ||
    value === 'drag_drop' ||
    value === 'context_menu' ||
    value === 'toolbar_action' ||
    value === 'mode_switch' ||
    value === 'save_success' ||
    value === 'save_error' ||
    value === 'import_apply' ||
    value === 'bilink_action' ||
    value === 'segment_action'
  )
}

interface MindMapFeedbackAudioEvent {
  type: MindMapFeedbackEvent
  source: string | null
  nodeUid: string | null
}

const FEEDBACK_AUDIO_COALESCE_MS = 110
const FEEDBACK_AUDIO_KEY_COALESCE_MS = 48
const FEEDBACK_AUDIO_DEDUP_MS = 140
const FEEDBACK_AUDIO_IMMEDIATE_PRIORITY = 64

const FEEDBACK_AUDIO_PRIORITY: Partial<Record<MindMapFeedbackEvent, number>> = {
  session_complete: 100,
  all_clear_ready: 96,
  branch_clear: 92,
  save_error: 88,
  node_delete: 84,
  import_apply: 82,
  card_reveal: 78,
  save_success: 76,
  text_commit: 74,
  node_edit_start: 72,
  node_create: 68,
  drag_drop: 66,
  bilink_action: 64,
  segment_action: 64,
  mode_switch: 62,
  field_commit: 60,
  toggle_on: 58,
  toggle_off: 58,
  navigation: 56,
  toolbar_action: 50,
  shortcut_trigger: 48,
  context_menu: 46,
  drag_start: 42,
  node_move: 36,
  node_select: 30,
  pointer_click: 24,
  key_press: 18,
  field_focus: 16,
  pointer_down: 12,
  hover_pulse: 4,
}

const LOW_PRIORITY_FEEDBACK_EVENTS = new Set<MindMapFeedbackEvent>([
  'pointer_down',
  'pointer_click',
  'node_select',
  'key_press',
  'field_focus',
  'hover_pulse',
])

function getFeedbackAudioPriority(event: MindMapFeedbackEvent) {
  return FEEDBACK_AUDIO_PRIORITY[event] ?? 40
}

function getFeedbackAudioCoalesceMs(event: MindMapFeedbackEvent) {
  if (event === 'key_press') return FEEDBACK_AUDIO_KEY_COALESCE_MS
  if (LOW_PRIORITY_FEEDBACK_EVENTS.has(event)) return FEEDBACK_AUDIO_COALESCE_MS
  return 72
}

function isImmediateFeedbackAudioEvent(event: MindMapFeedbackEvent) {
  return getFeedbackAudioPriority(event) >= FEEDBACK_AUDIO_IMMEDIATE_PRIORITY
}

function areRelatedFeedbackAudioEvents(
  previous: MindMapFeedbackAudioEvent,
  next: MindMapFeedbackAudioEvent,
) {
  if (previous.nodeUid && next.nodeUid) return previous.nodeUid === next.nodeUid
  if (previous.source && next.source && previous.source === next.source) return true
  if (LOW_PRIORITY_FEEDBACK_EVENTS.has(previous.type) && LOW_PRIORITY_FEEDBACK_EVENTS.has(next.type)) {
    return true
  }
  return (
    getFeedbackAudioPriority(previous.type) >= FEEDBACK_AUDIO_IMMEDIATE_PRIORITY &&
    LOW_PRIORITY_FEEDBACK_EVENTS.has(next.type)
  )
}

function readMindMapFeedbackAudioEvent(payload: unknown): MindMapFeedbackAudioEvent | null {
  if (isMindMapFeedbackEvent(payload)) {
    return {
      type: payload,
      source: null,
      nodeUid: null,
    }
  }
  if (payload && typeof payload === 'object') {
    const raw = payload as { type?: unknown; source?: unknown; nodeUid?: unknown }
    if (isMindMapFeedbackEvent(raw.type)) {
      return {
        type: raw.type,
        source: typeof raw.source === 'string' && raw.source ? raw.source : null,
        nodeUid: typeof raw.nodeUid === 'string' && raw.nodeUid ? raw.nodeUid : null,
      }
    }
  }
  return null
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
  focusNodeUids = [],
  focusRequestNodeUid = null,
  focusRequestNonce = 0,
  bilinkInsertionText = null,
  bilinkInsertionNonce = 0,
  reviewFxSignal = null,
  feedbackFxSignal = null,
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
  onEnglishOpen,
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
  const onEnglishOpenRef = useRef(onEnglishOpen)
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
  const lastReviewFxNonceRef = useRef<number>(0)
  const lastFeedbackFxNonceRef = useRef<number>(0)
  const pendingLocalCommitFingerprintRef = useRef<string | null>(null)
  const hostHydratedRef = useRef(false)
  const [isIframeLoaded, setIsIframeLoaded] = useState(false)
  const feedbackAudio = useMindMapFeedbackAudioFromSettings()
  const feedbackAudioRef = useRef(feedbackAudio)
  const pendingFeedbackAudioRef = useRef<{
    event: MindMapFeedbackAudioEvent
    receivedAt: number
    timerId: number
  } | null>(null)
  const lastPlayedFeedbackAudioRef = useRef<{
    event: MindMapFeedbackAudioEvent
    playedAt: number
  } | null>(null)

  stateRef.current = editorState
  feedbackAudioRef.current = feedbackAudio
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
  onEnglishOpenRef.current = onEnglishOpen
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
        focusNodeUids,
        focusRequestNodeUid,
        focusRequestNonce,
        showBilinkSearchButton,
        hasPracticeToggle: Boolean(onPracticeToggleRef.current),
        hasEnglishOpen: Boolean(onEnglishOpenRef.current),
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
    focusNodeUids,
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

  const forwardLocalEditorStateChange = useCallback((nextState: MindMapEditorState) => {
    pendingLocalCommitFingerprintRef.current = buildLocalEditorStateFingerprint(nextState)
    onEditorStateChangeRef.current(nextState)
  }, [])

  const clearPendingFeedbackAudio = useCallback(() => {
    const pending = pendingFeedbackAudioRef.current
    if (pending) {
      window.clearTimeout(pending.timerId)
      pendingFeedbackAudioRef.current = null
    }
  }, [])

  const playFeedbackAudioNow = useCallback((event: MindMapFeedbackAudioEvent) => {
    lastPlayedFeedbackAudioRef.current = {
      event,
      playedAt: Date.now(),
    }
    feedbackAudioRef.current.playEvent(event.type)
  }, [])

  const emitCoalescedFeedbackAudio = useCallback(
    (event: MindMapFeedbackAudioEvent) => {
      const now = Date.now()
      const priority = getFeedbackAudioPriority(event.type)
      const lastPlayed = lastPlayedFeedbackAudioRef.current
      if (
        lastPlayed &&
        now - lastPlayed.playedAt < FEEDBACK_AUDIO_DEDUP_MS &&
        getFeedbackAudioPriority(lastPlayed.event.type) >= priority &&
        areRelatedFeedbackAudioEvents(lastPlayed.event, event)
      ) {
        return
      }

      const pending = pendingFeedbackAudioRef.current
      if (pending) {
        const pendingPriority = getFeedbackAudioPriority(pending.event.type)
        if (
          pendingPriority > priority &&
          now - pending.receivedAt < FEEDBACK_AUDIO_COALESCE_MS
        ) {
          return
        }
        window.clearTimeout(pending.timerId)
        pendingFeedbackAudioRef.current = null
      }

      if (isImmediateFeedbackAudioEvent(event.type)) {
        playFeedbackAudioNow(event)
        return
      }

      const timerId = window.setTimeout(() => {
        pendingFeedbackAudioRef.current = null
        playFeedbackAudioNow(event)
      }, getFeedbackAudioCoalesceMs(event.type))
      pendingFeedbackAudioRef.current = {
        event,
        receivedAt: now,
        timerId,
      }
    },
    [playFeedbackAudioNow],
  )

  useEffect(() => clearPendingFeedbackAudio, [clearPendingFeedbackAudio])

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
          const feedbackEvent = readMindMapFeedbackAudioEvent(payload)
          if (feedbackEvent) {
            emitCoalescedFeedbackAudio(feedbackEvent)
          }
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
          onEnglishOpen: onEnglishOpenRef,
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
    emitCoalescedFeedbackAudio,
    externalSyncKey,
    forwardLocalEditorStateChange,
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
      className={className ?? 'h-full w-full border-0'}
      onLoad={() => {
        hostHydratedRef.current = readonly
        resetHostReady()
        setIsIframeLoaded(true)
        syncHostState()
      }}
    />
  )
}
