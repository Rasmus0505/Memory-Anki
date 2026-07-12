import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { createMindMapSessionState, mindMapSessionReducer } from '@/shared/lib/mindmapDocumentSessionModel'

export interface MindMapPersistenceAdapter<TResponse, TMeta> {
  load: (id: number) => Promise<TResponse>
  save: (id: number, data: PersistedMindMapSavePayload) => Promise<TResponse>
  selectMeta: (response: TResponse) => TMeta
  selectEditorState: (response: TResponse) => MindMapEditorState
}

interface MindMapDocumentSessionOptions<TResponse, TMeta> {
  entityId: number | null
  loadCacheKey?: string
  adapter?: MindMapPersistenceAdapter<TResponse, TMeta>
  fetcher?: (id: number) => Promise<TResponse>
  saver?: (id: number, data: PersistedMindMapSavePayload) => Promise<TResponse>
  selectMeta?: (response: TResponse) => TMeta
  selectEditorState?: (response: TResponse) => MindMapEditorState
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

export type PersistedMindMapSaveStatus = 'saved' | 'saving' | 'unsaved' | 'error'

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

export function useMindMapDocumentSession<TResponse, TMeta>({
  entityId,
  loadCacheKey = 'persisted-mindmap',
  adapter,
  fetcher: legacyFetcher,
  saver: legacySaver,
  selectMeta: legacySelectMeta,
  selectEditorState: legacySelectEditorState,
  onSaveError,
  beforeAutoSave,
}: MindMapDocumentSessionOptions<TResponse, TMeta>) {
  const resolvedAdapter = adapter ?? {
    load: legacyFetcher,
    save: legacySaver,
    selectMeta: legacySelectMeta,
    selectEditorState: legacySelectEditorState,
  }
  if (!resolvedAdapter.load || !resolvedAdapter.save || !resolvedAdapter.selectMeta || !resolvedAdapter.selectEditorState) {
    throw new Error('Mind-map persistence adapter is incomplete.')
  }
  const { load: fetcher, save: saver, selectMeta, selectEditorState } = resolvedAdapter
  const [session, dispatch] = useReducer(
    mindMapSessionReducer<TMeta>,
    entityId,
    createMindMapSessionState<TMeta>,
  )
  const { meta, editorState, error } = session
  const isLoading = session.status === 'loading'
  const isSaving = session.status === 'saving'
  const isLoadError = session.status === 'error' && session.editorState == null
  const hasUnsavedChanges = session.dirty
  const setMeta = useCallback((nextMeta: TMeta | null) => {
    dispatch({ type: 'meta-replaced', meta: nextMeta })
  }, [])
  const replaceEditorState = useCallback((nextState: MindMapEditorState | null) => {
    dispatch({ type: 'editor-replaced', editorState: nextState })
  }, [])

  const editorStateRef = useRef<MindMapEditorState | null>(null)
  const dirtyRef = useRef(false)
  const dirtyOwnerIdRef = useRef<number | null>(null)
  const pendingSnapshotRef = useRef<{
    ownerId: number
    snapshot: MindMapEditorState
    saveVersion: number
  } | null>(null)
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
  const previousEntityIdRef = useRef<number | null>(entityId)
  const lastSavedEditorFingerprintRef = useRef('')
  const isMountedRef = useRef(false)
  const loadRequestIdRef = useRef(0)
  const saveOperationIdRef = useRef(0)
  const externalStateGuardRef = useRef<ExternalStateGuard | null>(null)

  type SaveOperation = {
    ownerId: number
    operationId: number
    snapshot: MindMapEditorState
    saveVersion: number
    expectedEditorFingerprint: string
    retryCount: number
    save: (id: number, data: PersistedMindMapSavePayload) => Promise<TResponse>
    selectMeta: (response: TResponse) => TMeta
    selectEditorState: (response: TResponse) => MindMapEditorState
    onSaveError?: (error: Error, pendingState: MindMapEditorState) => Promise<boolean> | boolean
  }

  const activeSaveOperationRef = useRef<SaveOperation | null>(null)
  const retryPersistRef = useRef<(operation: SaveOperation) => void>(() => {})
  const flushCurrentSaveRef = useRef<() => void>(() => {})

  editorStateRef.current = editorState
  entityIdRef.current = entityId
  fetcherRef.current = fetcher
  saverRef.current = saver
  selectMetaRef.current = selectMeta
  selectEditorStateRef.current = selectEditorState
  onSaveErrorRef.current = onSaveError
  beforeAutoSaveRef.current = beforeAutoSave

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

  const isActiveSaveOperation = useCallback((operation: SaveOperation) => {
    const activeOperation = activeSaveOperationRef.current
    return (
      activeOperation?.ownerId === operation.ownerId
      && activeOperation.operationId === operation.operationId
    )
  }, [])

  const isCurrentSaveOperation = useCallback((operation: SaveOperation) => {
    return (
      isMountedRef.current
      && entityIdRef.current === operation.ownerId
      && isActiveSaveOperation(operation)
    )
  }, [isActiveSaveOperation])

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
      dirtyOwnerIdRef.current = null
      pendingSnapshotRef.current = null
      dispatch({ type: 'external-state-adopted', editorState: nextState })
      const nextFingerprint = stableSerialize(nextState)
      lastStateFingerprintRef.current = nextFingerprint
      lastSavedEditorFingerprintRef.current = getEditorFingerprint(nextState)
      if (options?.protectFromStaleLoads) {
        armExternalStateGuard(nextState, options.releaseAfterMs)
      }
    },
    [armExternalStateGuard],
  )

  const createSaveOperation = useCallback((
    ownerId: number,
    snapshot: MindMapEditorState,
    saveVersion: number,
  ): SaveOperation => {
    const operationId = saveOperationIdRef.current + 1
    saveOperationIdRef.current = operationId
    return {
      ownerId,
      operationId,
      snapshot,
      saveVersion,
      expectedEditorFingerprint: lastSavedEditorFingerprintRef.current,
      retryCount: 0,
      save: saverRef.current,
      selectMeta: selectMetaRef.current,
      selectEditorState: selectEditorStateRef.current,
      onSaveError: onSaveErrorRef.current,
    }
  }, [])

  const persistOperation = useCallback(
    async (operation: SaveOperation) => {
      if (!isActiveSaveOperation(operation)) return
      const publishesToCurrentOwner = entityIdRef.current === operation.ownerId
      if (publishesToCurrentOwner) {
        dirtyRef.current = false
        dirtyOwnerIdRef.current = null
        dispatch({
          type: 'save-started',
          ownerId: operation.ownerId,
          operationId: operation.operationId,
        })
      }
      let retryScheduled = false
      let completedSuccessfully = false
      try {
        const savePayload: PersistedMindMapSavePayload = {
          ...operation.snapshot,
          expected_editor_fingerprint: operation.expectedEditorFingerprint || null,
        }
        const response = await operation.save(operation.ownerId, savePayload)
        if (isCurrentSaveOperation(operation)) {
          const nextEditorState = operation.selectEditorState(response)
          if (!shouldIgnoreIncomingState(nextEditorState)) {
            lastSavedEditorFingerprintRef.current = getEditorFingerprint(nextEditorState)
            lastStateFingerprintRef.current = stableSerialize(nextEditorState)
            const hasNewerChanges = changeVersionRef.current !== operation.saveVersion
            const currentFingerprint = stableSerialize(editorStateRef.current)
            const nextFingerprint = stableSerialize(nextEditorState)
            dirtyRef.current = hasNewerChanges
            dirtyOwnerIdRef.current = hasNewerChanges ? operation.ownerId : null
            if (!hasNewerChanges) pendingSnapshotRef.current = null
            dispatch({
              type: 'save-succeeded',
              ownerId: operation.ownerId,
              operationId: operation.operationId,
              meta: operation.selectMeta(response),
              editorState: !hasNewerChanges && currentFingerprint !== nextFingerprint ? nextEditorState : undefined,
              dirty: hasNewerChanges,
            })
            completedSuccessfully = true
          }
        }
      } catch (err) {
        if (isCurrentSaveOperation(operation)) {
          const nextError = err instanceof Error ? err : new Error('Failed to save editor')
          let handled = false
          if (operation.onSaveError) {
            handled = await operation.onSaveError(nextError, operation.snapshot)
          }
          if (isCurrentSaveOperation(operation)) {
            operation.retryCount += 1
            const hasNewerChanges = changeVersionRef.current !== operation.saveVersion
            const remainsDirty = hasNewerChanges || !handled
            dirtyRef.current = remainsDirty
            dirtyOwnerIdRef.current = remainsDirty ? operation.ownerId : null
            const conflicted = isConflictError(nextError)
            dispatch({
              type: 'save-failed',
              ownerId: operation.ownerId,
              operationId: operation.operationId,
              dirty: remainsDirty,
              conflicted,
              error: handled ? null : conflicted ? nextError.message : `本地已保存，待请求恢复：${nextError.message}`,
            })
            if (!handled && operation.retryCount < 3) {
              retryScheduled = true
              clearTimer()
              timerRef.current = window.setTimeout(() => {
                if (!isCurrentSaveOperation(operation)) return
                retryPersistRef.current(operation)
              }, 500 * operation.retryCount)
            }
          }
        }
      } finally {
        if (isCurrentSaveOperation(operation)) {
          dispatch({
            type: 'save-finished',
            ownerId: operation.ownerId,
            operationId: operation.operationId,
          })
          if (!retryScheduled) {
            activeSaveOperationRef.current = null
          }
          if (
            completedSuccessfully
            && dirtyRef.current
            && dirtyOwnerIdRef.current === operation.ownerId
          ) {
            clearTimer()
            timerRef.current = window.setTimeout(() => flushCurrentSaveRef.current(), 0)
          }
        }
      }
    },
    [isActiveSaveOperation, isCurrentSaveOperation, shouldIgnoreIncomingState],
  )

  retryPersistRef.current = (operation) => {
    void persistOperation(operation)
  }
  const load = useCallback(async (options?: { force?: boolean }) => {
    const requestId = loadRequestIdRef.current + 1
    loadRequestIdRef.current = requestId
    if (!entityId) {
      if (!isMountedRef.current) return
      dispatch({ type: 'owner-cleared', ownerId: null })
      lastStateFingerprintRef.current = ''
      lastSavedEditorFingerprintRef.current = ''
      return
    }
    if (isMountedRef.current) {
      dispatch({ type: 'load-started', ownerId: entityId, operationId: requestId })
    }
    try {
      const inflightKey = `${loadCacheKey}:${entityId}`
      let pending = inflightEditorLoads.get(inflightKey) as Promise<TResponse> | undefined
      if (!pending || options?.force) {
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
      dirtyRef.current = false
      dirtyOwnerIdRef.current = null
      pendingSnapshotRef.current = null
      lastSavedEditorFingerprintRef.current = getEditorFingerprint(nextEditorState)
      lastStateFingerprintRef.current = stableSerialize(nextEditorState)
      dispatch({
        type: 'load-succeeded',
        ownerId: entityId,
        operationId: requestId,
        meta: selectMetaRef.current(response),
        editorState: nextEditorState,
      })
    } catch (err) {
      if (!isCurrentLoadRequest(requestId, entityId)) return
      dispatch({
        type: 'load-failed',
        ownerId: entityId,
        operationId: requestId,
        error: err instanceof Error ? err.message : 'Failed to load editor',
      })
    } finally {
      // Load success/failure actions settle the explicit session state.
    }
  }, [entityId, isCurrentLoadRequest, loadCacheKey, shouldIgnoreIncomingState])

  const reload = useCallback(() => load({ force: true }), [load])

  const flushSave = useCallback(async () => {
    const saveEntityId = entityIdRef.current
    if (!saveEntityId || !editorStateRef.current || !dirtyRef.current) return
    if (dirtyOwnerIdRef.current !== saveEntityId) return
    if (activeSaveOperationRef.current?.ownerId === saveEntityId) return
    const pendingSnapshot = pendingSnapshotRef.current
    const snapshot = pendingSnapshot?.ownerId === saveEntityId
      ? pendingSnapshot.snapshot
      : editorStateRef.current
    const saveVersion = pendingSnapshot?.ownerId === saveEntityId
      ? pendingSnapshot.saveVersion
      : changeVersionRef.current
    const operation = createSaveOperation(saveEntityId, snapshot, saveVersion)
    activeSaveOperationRef.current = operation
    await persistOperation(operation)
  }, [createSaveOperation, persistOperation])

  flushCurrentSaveRef.current = () => {
    void flushSave()
  }

  const flushPendingForEntity = useCallback(async (targetEntityId: number | null) => {
    if (!targetEntityId || !dirtyRef.current || dirtyOwnerIdRef.current !== targetEntityId) return
    if (activeSaveOperationRef.current?.ownerId === targetEntityId) return
    const pendingSnapshot = pendingSnapshotRef.current
    if (!pendingSnapshot || pendingSnapshot.ownerId !== targetEntityId) return
    clearTimer()
    const operation = createSaveOperation(
      targetEntityId,
      pendingSnapshot.snapshot,
      pendingSnapshot.saveVersion,
    )
    activeSaveOperationRef.current = operation
    await persistOperation(operation)
  }, [createSaveOperation, persistOperation])

  const scheduleSave = useCallback((nextState: MindMapEditorState) => {
    const nextFingerprint = stableSerialize(nextState)
    if (nextFingerprint === lastStateFingerprintRef.current) {
      return
    }
    const autoSaveBlockReason = beforeAutoSaveRef.current?.(nextState, editorStateRef.current) || null
    if (autoSaveBlockReason) {
      if (isMountedRef.current) dispatch({ type: 'operation-blocked', error: autoSaveBlockReason })
      return
    }
    changeVersionRef.current += 1
    lastStateFingerprintRef.current = nextFingerprint
    dispatch({ type: 'editor-changed', editorState: nextState })
    dirtyRef.current = true
    dirtyOwnerIdRef.current = entityIdRef.current
    if (entityIdRef.current) {
      pendingSnapshotRef.current = {
        ownerId: entityIdRef.current,
        snapshot: nextState,
        saveVersion: changeVersionRef.current,
      }
    }
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
        if (activeSaveOperationRef.current?.ownerId === previousEntityId) {
          activeSaveOperationRef.current = null
        }
        dispatch({ type: 'owner-cleared', ownerId: entityId })
        dirtyRef.current = false
        dirtyOwnerIdRef.current = null
        pendingSnapshotRef.current = null
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

  const saveStatus: PersistedMindMapSaveStatus = error
    ? 'error'
    : isSaving
      ? 'saving'
      : hasUnsavedChanges
        ? 'unsaved'
        : 'saved'

  return {
    meta,
    setMeta,
    editorState,
    setEditorState: scheduleSave,
    replaceEditorState,
    adoptExternalState,
    armExternalStateGuard,
    releaseExternalStateGuard,
    isLoading,
    isLoadError,
    isSaving,
    hasUnsavedChanges,
    saveStatus,
    error,
    reload,
    flushSave,
  }
}





