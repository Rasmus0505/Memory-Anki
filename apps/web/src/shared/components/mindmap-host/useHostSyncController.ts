import { useCallback, useRef } from 'react'
import type { MindMapEditorState } from '@/shared/api/client'
import type {
  HostEditorStateSyncPayload,
  MindMapHostWindow,
} from '@/shared/components/mindmap-host/hostBridgeUtils'
import { cloneValue } from '@/shared/components/mindmap-host/hostBridgeUtils'

export function useHostSyncController(args: {
  iframeRef: React.RefObject<HTMLIFrameElement | null>
  preserveViewOnSync: boolean
  initialViewPolicy: 'preserve' | 'reset'
}) {
  const { iframeRef, preserveViewOnSync, initialViewPolicy } = args
  const lastSyncedFingerprintRef = useRef('')
  const pendingHostEditorStateSyncRef = useRef<HostEditorStateSyncPayload | null>(null)
  const hostReadyRef = useRef(false)
  const initialForceSyncAppliedRef = useRef(false)

  const buildHostEditorStateSyncPayload = useCallback(
    (
      nextEditorState: MindMapEditorState,
      fingerprint: string,
      nextIntent: 'soft' | 'replace',
      nextReason: string | null,
      source: 'prop' | 'force',
    ): HostEditorStateSyncPayload => ({
      editorState: cloneValue(nextEditorState),
      preserveView: preserveViewOnSync,
      syncIntent: nextIntent,
      syncReason: nextReason,
      fingerprint,
      source,
    }),
    [preserveViewOnSync],
  )

  const dispatchHostEditorStateSync = useCallback(
    (payload: HostEditorStateSyncPayload) => {
      const iframeWindow = iframeRef.current?.contentWindow as MindMapHostWindow | null
      const syncHostEditorState = iframeWindow?.syncHostEditorState
      if (typeof syncHostEditorState !== 'function') return false
      const reviewFlipViewPolicy =
        payload.syncIntent === 'replace' && payload.syncReason === 'review_flip'
          ? 'reset'
          : 'preserve'
      const viewPolicy =
        payload.syncIntent === 'replace' &&
        payload.source === 'force' &&
        !initialForceSyncAppliedRef.current
          ? initialViewPolicy
          : reviewFlipViewPolicy
      syncHostEditorState({
        editorState: cloneValue(payload.editorState),
        preserveView: payload.preserveView,
        syncIntent: payload.syncIntent,
        syncReason: payload.syncReason,
        viewPolicy,
      })
      if (payload.syncIntent === 'replace' && payload.source === 'force') {
        initialForceSyncAppliedRef.current = true
      }
      lastSyncedFingerprintRef.current = payload.fingerprint
      return true
    },
    [iframeRef, initialViewPolicy],
  )

  const queueHostEditorStateSync = useCallback((payload: HostEditorStateSyncPayload) => {
    const currentPending = pendingHostEditorStateSyncRef.current
    if (currentPending && currentPending.syncIntent === 'replace' && payload.syncIntent === 'soft') {
      return
    }
    pendingHostEditorStateSyncRef.current = payload
  }, [])

  const flushPendingHostEditorStateSync = useCallback(() => {
    const pendingPayload = pendingHostEditorStateSyncRef.current
    if (!pendingPayload) return false
    if (!dispatchHostEditorStateSync(pendingPayload)) return false
    hostReadyRef.current = true
    pendingHostEditorStateSyncRef.current = null
    return true
  }, [dispatchHostEditorStateSync])

  const syncOrQueueHostEditorState = useCallback(
    (payload: HostEditorStateSyncPayload) => {
      if (!hostReadyRef.current && lastSyncedFingerprintRef.current === '') {
        queueHostEditorStateSync(payload)
        return false
      }
      if (dispatchHostEditorStateSync(payload)) {
        hostReadyRef.current = true
        pendingHostEditorStateSyncRef.current = null
        return true
      }
      queueHostEditorStateSync(payload)
      return false
    },
    [dispatchHostEditorStateSync, queueHostEditorStateSync],
  )

  const markHostReady = useCallback(() => {
    hostReadyRef.current = true
  }, [])

  const resetHostReady = useCallback(() => {
    hostReadyRef.current = false
  }, [])

  return {
    buildHostEditorStateSyncPayload,
    flushPendingHostEditorStateSync,
    hostReadyRef,
    lastSyncedFingerprintRef,
    markHostReady,
    pendingHostEditorStateSyncRef,
    resetHostReady,
    syncOrQueueHostEditorState,
  }
}
