import { useCallback, useEffect, useRef, useState } from 'react'
import type { MindMapEditorState } from '@/shared/api/contracts'

interface PersistedMindMapOptions<TResponse, TMeta> {
  entityId: number | null
  loadCacheKey?: string
  fetcher: (id: number) => Promise<TResponse>
  saver: (id: number, data: PersistedMindMapSavePayload) => Promise<TResponse>
  selectMeta: (response: TResponse) => TMeta
  selectEditorState: (response: TResponse) => MindMapEditorState
  onSaveError?: (error: Error, pendingState: MindMapEditorState) => Promise<boolean> | boolean
  beforeAutoSave?: (nextState: MindMapEditorState, currentState: MindMapEditorState | null) => string | null
}

type PersistedMindMapSavePayload = MindMapEditorState & {
  expected_editor_fingerprint?: string | null
}

interface ExternalStateGuard {
  expectedFingerprint: string
  releaseAt: number
}

interface AdoptExternalStateOptions {
  protectFromStaleLoads?: boolean
  releaseAfterMs?: number
}

const inflightEditorLoads = new Map<string, Promise<unknown>>()

function stableSerialize(value: unknown) {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

function getEditorFingerprint(state: MindMapEditorState | null | undefined) {
  return typeof state?.editor_fingerprint === 'string' && state.editor_fingerprint.trim()
    ? state.editor_fingerprint.trim()
    : ''
}

function isConflictError(error: Error) {
  return /冲突|fingerprint|stale|服务端已有更新/.test(error.message)
}

export function usePersistedMindMapEditor<TResponse, TMeta>({
  entityId,
  loadCacheKey = 'persisted-mindmap',
  fetcher,
  saver,
  selectMeta,
  selectEditorState,
  onSaveError,
  beforeAutoSave,
}: PersistedMindMapOptions<TResponse, TMeta>) {
  const [meta, setMeta] = useState<TMeta | null>(null)
  const [editorState, setEditorState] = useState<MindMapEditorState | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const editorStateRef = useRef<MindMapEditorState | null>(null)
  const dirtyRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  const changeVersionRef = useRef(0)
  const entityIdRef = useRef<number | null>(entityId)
  const fetcherRef = useRef(fetcher)
  const saverRef = useRef(saver)
  const selectMetaRef = useRef(selectMeta)
  const selectEditorStateRef = useRef(selectEditorState)
  const onSaveErrorRef = useRef(onSaveError)
  const beforeAutoSaveRef = useRef(beforeAutoSave)
  const lastStateFingerprintRef = useRef('')
  const isSavingRef = useRef(false)
  const previousEntityIdRef = useRef<number | null>(entityId)
  const retryCountRef = useRef(0)
  const lastSavedEditorFingerprintRef = useRef('')
  const isMountedRef = useRef(false)
  const loadRequestIdRef = useRef(0)
  const queueRetryPersistRef = useRef<() => void>(() => {})
  const externalStateGuardRef = useRef<ExternalStateGuard | null>(null)

  editorStateRef.current = editorState
  entityIdRef.current = entityId
  fetcherRef.current = fetcher
  saverRef.current = saver
  selectMetaRef.current = selectMeta
  selectEditorStateRef.current = selectEditorState
  onSaveErrorRef.current = onSaveError
  beforeAutoSaveRef.current = beforeAutoSave
  isSavingRef.current = isSaving

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const isCurrentLoadRequest = useCallback((requestId: number, requestEntityId: number) => {
    return (
      isMountedRef.current &&
      loadRequestIdRef.current === requestId &&
      entityIdRef.current === requestEntityId
    )
  }, [])

  const clearTimer = () => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const releaseExternalStateGuard = useCallback(() => {
    externalStateGuardRef.current = null
  }, [])

  const armExternalStateGuard = useCallback((nextState: MindMapEditorState, releaseAfterMs = 4000) => {
    externalStateGuardRef.current = {
      expectedFingerprint: stableSerialize(nextState),
      releaseAt: Date.now() + releaseAfterMs,
    }
  }, [])

  const shouldIgnoreIncomingState = useCallback((nextState: MindMapEditorState) => {
    const guard = externalStateGuardRef.current
    if (!guard) return false
    if (Date.now() >= guard.releaseAt) {
      externalStateGuardRef.current = null
      return false
    }
    const nextFingerprint = stableSerialize(nextState)
    if (nextFingerprint === guard.expectedFingerprint) {
      externalStateGuardRef.current = null
      return false
    }
    return true
  }, [])

  const adoptExternalState = useCallback(
    (nextState: MindMapEditorState, options?: AdoptExternalStateOptions) => {
      clearTimer()
      dirtyRef.current = false
      retryCountRef.current = 0
      const nextFingerprint = stableSerialize(nextState)
      lastStateFingerprintRef.current = nextFingerprint
      lastSavedEditorFingerprintRef.current = getEditorFingerprint(nextState)
      if (options?.protectFromStaleLoads) {
        armExternalStateGuard(nextState, options.releaseAfterMs)
      }
      if (isMountedRef.current) {
        setError(null)
        setEditorState(nextState)
      }
    },
    [armExternalStateGuard],
  )

  const persistSnapshot = useCallback(
    async (
      saveEntityId: number,
      snapshot: MindMapEditorState,
      saveVersion: number,
    ) => {
      dirtyRef.current = false
      if (isMountedRef.current) {
        setIsSaving(true)
        setError(null)
      }
      try {
        const savePayload: PersistedMindMapSavePayload = {
          ...snapshot,
          expected_editor_fingerprint: lastSavedEditorFingerprintRef.current || null,
        }
        const response = await saverRef.current(saveEntityId, savePayload)
        if (!isMountedRef.current || entityIdRef.current !== saveEntityId) return
        const nextEditorState = selectEditorStateRef.current(response)
        if (shouldIgnoreIncomingState(nextEditorState)) {
          return
        }
        retryCountRef.current = 0
        lastSavedEditorFingerprintRef.current = getEditorFingerprint(nextEditorState)
        lastStateFingerprintRef.current = stableSerialize(nextEditorState)
        setMeta(selectMetaRef.current(response))
        if (changeVersionRef.current !== saveVersion) {
          return
        }

        const currentFingerprint = stableSerialize(editorStateRef.current)
        const nextFingerprint = stableSerialize(nextEditorState)
        if (currentFingerprint !== nextFingerprint) {
          setEditorState(nextEditorState)
        }
      } catch (err) {
        const nextError = err instanceof Error ? err : new Error('Failed to save editor')
        let handled = false
        if (onSaveErrorRef.current) {
          handled = await onSaveErrorRef.current(nextError, snapshot)
        }
        retryCountRef.current += 1
        dirtyRef.current = !handled
        if (isMountedRef.current) {
          setError(
            handled
              ? null
              : isConflictError(nextError)
                ? nextError.message
                : `本地已保存，待同步：${nextError.message}`,
          )
        }
      } finally {
        if (isMountedRef.current) {
          setIsSaving(false)
        }
        if (dirtyRef.current && retryCountRef.current < 3) {
          clearTimer()
          timerRef.current = window.setTimeout(() => {
            queueRetryPersistRef.current()
          }, 500 * retryCountRef.current)
        }
      }
    },
    [],
  )

  queueRetryPersistRef.current = () => {
    const retryEntityId = entityIdRef.current
    const retryEditorState = editorStateRef.current
    if (!retryEntityId || !retryEditorState || !dirtyRef.current || isSavingRef.current) {
      return
    }
    void persistSnapshot(retryEntityId, retryEditorState, changeVersionRef.current)
  }

  const load = useCallback(async () => {
    const requestId = loadRequestIdRef.current + 1
    loadRequestIdRef.current = requestId
    if (!entityId) {
      if (!isMountedRef.current) return
      setMeta(null)
      setEditorState(null)
      lastStateFingerprintRef.current = ''
      lastSavedEditorFingerprintRef.current = ''
      return
    }
    if (isMountedRef.current) {
      setIsLoading(true)
      setError(null)
    }
    try {
      const inflightKey = `${loadCacheKey}:${entityId}`
      let pending = inflightEditorLoads.get(inflightKey) as Promise<TResponse> | undefined
      if (!pending) {
        pending = fetcherRef.current(entityId).finally(() => {
          if (inflightEditorLoads.get(inflightKey) === pending) {
            inflightEditorLoads.delete(inflightKey)
          }
        })
        inflightEditorLoads.set(inflightKey, pending)
      }
      const response = await pending
      if (!isCurrentLoadRequest(requestId, entityId)) return
      const nextEditorState = selectEditorStateRef.current(response)
      if (shouldIgnoreIncomingState(nextEditorState)) {
        return
      }
      changeVersionRef.current = 0
      retryCountRef.current = 0
      dirtyRef.current = false
      lastSavedEditorFingerprintRef.current = getEditorFingerprint(nextEditorState)
      lastStateFingerprintRef.current = stableSerialize(nextEditorState)
      setMeta(selectMetaRef.current(response))
      setEditorState(nextEditorState)
    } catch (err) {
      if (!isCurrentLoadRequest(requestId, entityId)) return
      setError(err instanceof Error ? err.message : 'Failed to load editor')
    } finally {
      if (isCurrentLoadRequest(requestId, entityId)) {
        setIsLoading(false)
      }
    }
  }, [entityId, isCurrentLoadRequest, loadCacheKey])

  const flushSave = useCallback(async () => {
    if (!entityIdRef.current || !editorStateRef.current || !dirtyRef.current || isSavingRef.current) return
    const saveEntityId = entityIdRef.current
    const snapshot = editorStateRef.current
    const saveVersion = changeVersionRef.current
    await persistSnapshot(saveEntityId, snapshot, saveVersion)
  }, [persistSnapshot])

  const flushPendingForEntity = useCallback(async (targetEntityId: number | null) => {
    if (!targetEntityId || !editorStateRef.current || !dirtyRef.current || isSavingRef.current) return
    clearTimer()
    await persistSnapshot(targetEntityId, editorStateRef.current, changeVersionRef.current)
  }, [persistSnapshot])

  const scheduleSave = useCallback((nextState: MindMapEditorState) => {
    const nextFingerprint = stableSerialize(nextState)
    if (nextFingerprint === lastStateFingerprintRef.current) {
      return
    }
    const autoSaveBlockReason = beforeAutoSaveRef.current?.(nextState, editorStateRef.current) || null
    if (autoSaveBlockReason) {
      if (isMountedRef.current) {
        setError(autoSaveBlockReason)
      }
      return
    }
    changeVersionRef.current += 1
    retryCountRef.current = 0
    lastStateFingerprintRef.current = nextFingerprint
    setEditorState(nextState)
    dirtyRef.current = true
    clearTimer()
    timerRef.current = window.setTimeout(() => {
      void flushSave()
    }, 450)
  }, [flushSave])

  useEffect(() => {
    let disposed = false

    const run = async () => {
      const previousEntityId = previousEntityIdRef.current
      if (previousEntityId !== entityId) {
        await flushPendingForEntity(previousEntityId)
        if (disposed) return
        setMeta(null)
        setEditorState(null)
        setError(null)
        lastStateFingerprintRef.current = ''
        previousEntityIdRef.current = entityId
      }
      await load()
    }

    void run()

    return () => {
      disposed = true
      clearTimer()
    }
  }, [entityId, flushPendingForEntity, load])

  useEffect(() => {
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') {
        void flushPendingForEntity(previousEntityIdRef.current)
      }
    }

    const flushOnPageHide = () => {
      void flushPendingForEntity(previousEntityIdRef.current)
    }

    document.addEventListener('visibilitychange', flushWhenHidden)
    window.addEventListener('pagehide', flushOnPageHide)

    return () => {
      document.removeEventListener('visibilitychange', flushWhenHidden)
      window.removeEventListener('pagehide', flushOnPageHide)
      void flushPendingForEntity(previousEntityIdRef.current)
    }
  }, [flushPendingForEntity])

  return {
    meta,
    setMeta,
    editorState,
    setEditorState: scheduleSave,
    replaceEditorState: setEditorState,
    adoptExternalState,
    armExternalStateGuard,
    releaseExternalStateGuard,
    isLoading,
    isSaving,
    error,
    reload: load,
    flushSave,
  }
}
