import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { createMindMapSessionState, mindMapSessionReducer } from '@/shared/lib/mindmapDocumentSessionModel'
import {
  buildMindMapEditorDraftKey,
  clearMindMapEditorDraft,
  readMindMapEditorDraft,
  stableMindMapEditorContentFingerprint,
  writeMindMapEditorDraft,
} from '@/shared/persistence/mindmapEditorDraftStore'

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
const AUTO_SAVE_DEBOUNCE_MS = 450

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
  const loadCacheKeyRef = useRef(loadCacheKey)
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
  loadCacheKeyRef.current = loadCacheKey
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

  const draftKeyFor = useCallback((ownerId: number) => {
    return buildMindMapEditorDraftKey(loadCacheKeyRef.current, ownerId)
  }, [])

  const persistLocalDraft = useCallback((
    ownerId: number,
    snapshot: MindMapEditorState,
    saveVersion: number,
  ) => {
    void writeMindMapEditorDraft({
      resourceKey: draftKeyFor(ownerId),
      snapshot,
      baseEditorFingerprint: lastSavedEditorFingerprintRef.current,
      changeVersion: saveVersion,
      contentFingerprint: stableMindMapEditorContentFingerprint(snapshot),
    })
  }, [draftKeyFor])

  const clearLocalDraft = useCallback((ownerId: number) => {
    void clearMindMapEditorDraft(draftKeyFor(ownerId))
  }, [draftKeyFor])

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

  /** UI-facing: only apply reducer updates while mounted on the same owner. */
  const canPublishSaveToSession = useCallback((operation: SaveOperation) => {
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
      if (entityIdRef.current != null) {
        clearLocalDraft(entityIdRef.current)
      }
      if (options?.protectFromStaleLoads) {
        armExternalStateGuard(nextState, options.releaseAfterMs)
      }
    },
    [armExternalStateGuard, clearLocalDraft],
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
      if (publishesToCurrentOwner && isMountedRef.current) {
        // Keep dirty true if newer edits already landed while we were scheduling.
        const hasNewerBeforeStart = changeVersionRef.current !== operation.saveVersion
        if (!hasNewerBeforeStart) {
          dirtyRef.current = false
          dirtyOwnerIdRef.current = null
        }
        dispatch({
          type: 'save-started',
          ownerId: operation.ownerId,
          operationId: operation.operationId,
        })
        if (hasNewerBeforeStart) {
          // save-started clears dirty in the reducer; re-assert dirty for UI.
          dirtyRef.current = true
          dirtyOwnerIdRef.current = operation.ownerId
          dispatch({ type: 'editor-changed', editorState: editorStateRef.current ?? operation.snapshot })
        }
      }
      let retryScheduled = false
      let completedSuccessfully = false
      let hasNewerChanges = false
      try {
        const savePayload: PersistedMindMapSavePayload = {
          ...operation.snapshot,
          expected_editor_fingerprint: operation.expectedEditorFingerprint || null,
        }
        const response = await operation.save(operation.ownerId, savePayload)
        // Process completion while this operation is still the active one, even if unmounted.
        if (isActiveSaveOperation(operation)) {
          const nextEditorState = operation.selectEditorState(response)
          if (!shouldIgnoreIncomingState(nextEditorState)) {
            lastSavedEditorFingerprintRef.current = getEditorFingerprint(nextEditorState)
            hasNewerChanges = changeVersionRef.current !== operation.saveVersion
            if (!hasNewerChanges) {
              lastStateFingerprintRef.current = stableSerialize(nextEditorState)
              dirtyRef.current = false
              dirtyOwnerIdRef.current = null
              pendingSnapshotRef.current = null
              clearLocalDraft(operation.ownerId)
            } else {
              dirtyRef.current = true
              dirtyOwnerIdRef.current = operation.ownerId
            }
            if (canPublishSaveToSession(operation)) {
              const currentFingerprint = stableSerialize(editorStateRef.current)
              const nextFingerprint = stableSerialize(nextEditorState)
              dispatch({
                type: 'save-succeeded',
                ownerId: operation.ownerId,
                operationId: operation.operationId,
                meta: operation.selectMeta(response),
                editorState: !hasNewerChanges && currentFingerprint !== nextFingerprint ? nextEditorState : undefined,
                dirty: hasNewerChanges,
              })
            }
            completedSuccessfully = true
          }
        }
      } catch (err) {
        if (isActiveSaveOperation(operation)) {
          const nextError = err instanceof Error ? err : new Error('Failed to save editor')
          let handled = false
          if (operation.onSaveError && canPublishSaveToSession(operation)) {
            handled = await operation.onSaveError(nextError, operation.snapshot)
          }
          if (isActiveSaveOperation(operation)) {
            operation.retryCount += 1
            hasNewerChanges = changeVersionRef.current !== operation.saveVersion
            const remainsDirty = hasNewerChanges || !handled
            dirtyRef.current = remainsDirty
            dirtyOwnerIdRef.current = remainsDirty ? operation.ownerId : null
            if (!remainsDirty) {
              pendingSnapshotRef.current = null
              clearLocalDraft(operation.ownerId)
            } else {
              // Ensure the failed payload (or newer pending) stays recoverable locally.
              const pending = pendingSnapshotRef.current
              const snapshotForDraft =
                pending?.ownerId === operation.ownerId
                  ? pending.snapshot
                  : operation.snapshot
              const versionForDraft =
                pending?.ownerId === operation.ownerId
                  ? pending.saveVersion
                  : operation.saveVersion
              persistLocalDraft(operation.ownerId, snapshotForDraft, versionForDraft)
            }
            const conflicted = isConflictError(nextError)
            if (canPublishSaveToSession(operation)) {
              dispatch({
                type: 'save-failed',
                ownerId: operation.ownerId,
                operationId: operation.operationId,
                dirty: remainsDirty,
                conflicted,
                error: handled ? null : conflicted ? nextError.message : `本地已保存，待请求恢复：${nextError.message}`,
              })
            }
            // Only retry while this owner is still the active session UI. Background owners keep
            // the local draft for recovery instead of spamming retries after navigation.
            if (!handled && operation.retryCount < 3 && canPublishSaveToSession(operation)) {
              retryScheduled = true
              clearTimer()
              timerRef.current = window.setTimeout(() => {
                if (!isActiveSaveOperation(operation)) return
                retryPersistRef.current(operation)
              }, 500 * operation.retryCount)
            }
          }
        }
      } finally {
        if (isActiveSaveOperation(operation)) {
          if (canPublishSaveToSession(operation)) {
            dispatch({
              type: 'save-finished',
              ownerId: operation.ownerId,
              operationId: operation.operationId,
            })
          }
          if (!retryScheduled) {
            activeSaveOperationRef.current = null
          }
          // Chain the latest pending snapshot for this owner (even if session UI moved on).
          // Hard tab kills rely on the draft store; this covers soft closes / slow responses.
          const pending = pendingSnapshotRef.current
          const needsFollowUp =
            completedSuccessfully
            && !retryScheduled
            && pending?.ownerId === operation.ownerId
            && pending.saveVersion !== operation.saveVersion
          if (needsFollowUp && pending) {
            clearTimer()
            timerRef.current = window.setTimeout(() => {
              if (activeSaveOperationRef.current) return
              const latest = pendingSnapshotRef.current
              if (!latest || latest.ownerId !== operation.ownerId) return
              dirtyRef.current = true
              dirtyOwnerIdRef.current = latest.ownerId
              const followUp = createSaveOperation(latest.ownerId, latest.snapshot, latest.saveVersion)
              activeSaveOperationRef.current = followUp
              void persistOperation(followUp)
            }, 0)
          } else if (
            completedSuccessfully
            && !retryScheduled
            && dirtyRef.current
            && dirtyOwnerIdRef.current === operation.ownerId
            && entityIdRef.current === operation.ownerId
          ) {
            clearTimer()
            timerRef.current = window.setTimeout(() => flushCurrentSaveRef.current(), 0)
          }
        }
      }
    },
    [
      canPublishSaveToSession,
      clearLocalDraft,
      createSaveOperation,
      isActiveSaveOperation,
      persistLocalDraft,
      shouldIgnoreIncomingState,
    ],
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

      const serverContentFingerprint = stableMindMapEditorContentFingerprint(nextEditorState)
      const draft = await readMindMapEditorDraft(draftKeyFor(entityId))
      const shouldRecoverDraft =
        draft != null
        && draft.contentFingerprint !== ''
        && draft.contentFingerprint !== serverContentFingerprint

      changeVersionRef.current = shouldRecoverDraft ? Math.max(1, draft.changeVersion || 1) : 0
      dirtyRef.current = shouldRecoverDraft
      dirtyOwnerIdRef.current = shouldRecoverDraft ? entityId : null
      pendingSnapshotRef.current = shouldRecoverDraft
        ? {
            ownerId: entityId,
            snapshot: draft.snapshot,
            saveVersion: changeVersionRef.current,
          }
        : null
      lastSavedEditorFingerprintRef.current = getEditorFingerprint(nextEditorState)
      const adoptedState = shouldRecoverDraft ? draft.snapshot : nextEditorState
      lastStateFingerprintRef.current = shouldRecoverDraft
        ? draft.contentFingerprint
        : stableSerialize(nextEditorState)
      if (!shouldRecoverDraft && draft) {
        clearLocalDraft(entityId)
      }

      dispatch({
        type: 'load-succeeded',
        ownerId: entityId,
        operationId: requestId,
        meta: selectMetaRef.current(response),
        editorState: adoptedState,
      })
      if (shouldRecoverDraft) {
        // load-succeeded clears dirty; re-mark and push recovered content into the save pipeline.
        dispatch({ type: 'editor-changed', editorState: draft.snapshot })
        clearTimer()
        timerRef.current = window.setTimeout(() => flushCurrentSaveRef.current(), 0)
      }
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
  }, [clearLocalDraft, draftKeyFor, entityId, isCurrentLoadRequest, loadCacheKey, shouldIgnoreIncomingState])

  const reload = useCallback(() => load({ force: true }), [load])

  const startSaveForPending = useCallback((
    targetEntityId: number,
    snapshot: MindMapEditorState,
    saveVersion: number,
  ) => {
    if (activeSaveOperationRef.current?.ownerId === targetEntityId) return false
    const operation = createSaveOperation(targetEntityId, snapshot, saveVersion)
    activeSaveOperationRef.current = operation
    void persistOperation(operation)
    return true
  }, [createSaveOperation, persistOperation])

  const flushSave = useCallback(async () => {
    const saveEntityId = entityIdRef.current
    if (!saveEntityId || !dirtyRef.current) return
    if (dirtyOwnerIdRef.current !== saveEntityId) return
    if (activeSaveOperationRef.current?.ownerId === saveEntityId) return
    const pendingSnapshot = pendingSnapshotRef.current
    const snapshot = pendingSnapshot?.ownerId === saveEntityId
      ? pendingSnapshot.snapshot
      : editorStateRef.current
    if (!snapshot) return
    const saveVersion = pendingSnapshot?.ownerId === saveEntityId
      ? pendingSnapshot.saveVersion
      : changeVersionRef.current
    // Ensure the latest snapshot is durable before the network round-trip.
    persistLocalDraft(saveEntityId, snapshot, saveVersion)
    const operation = createSaveOperation(saveEntityId, snapshot, saveVersion)
    activeSaveOperationRef.current = operation
    await persistOperation(operation)
  }, [createSaveOperation, persistLocalDraft, persistOperation])

  flushCurrentSaveRef.current = () => {
    void flushSave()
  }

  const flushPendingForEntity = useCallback(async (targetEntityId: number | null) => {
    if (!targetEntityId || !dirtyRef.current || dirtyOwnerIdRef.current !== targetEntityId) return
    const pendingSnapshot = pendingSnapshotRef.current
    const snapshot = pendingSnapshot?.ownerId === targetEntityId
      ? pendingSnapshot.snapshot
      : entityIdRef.current === targetEntityId
        ? editorStateRef.current
        : null
    if (!snapshot) return
    const saveVersion = pendingSnapshot?.ownerId === targetEntityId
      ? pendingSnapshot.saveVersion
      : changeVersionRef.current
    // Always refresh the local draft on hide/unmount — this is the durable path when an
    // HTTP save is already in flight and cannot be interrupted.
    persistLocalDraft(targetEntityId, snapshot, saveVersion)
    if (activeSaveOperationRef.current?.ownerId === targetEntityId) return
    clearTimer()
    startSaveForPending(targetEntityId, snapshot, saveVersion)
  }, [persistLocalDraft, startSaveForPending])

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
      // Write-ahead local draft (single slot per document) so closing mid-flight cannot lose edits.
      persistLocalDraft(entityIdRef.current, nextState, changeVersionRef.current)
    }
    clearTimer()
    timerRef.current = window.setTimeout(() => {
      void flushSave()
    }, AUTO_SAVE_DEBOUNCE_MS)
  }, [flushSave, persistLocalDraft])

  useEffect(() => {
    let disposed = false

    const run = async () => {
      const previousEntityId = previousEntityIdRef.current
      if (previousEntityId !== entityId) {
        await flushPendingForEntity(previousEntityId)
        if (disposed) return
        // Do not null an in-flight save for the previous owner — let it finish and chain
        // follow-ups via pendingSnapshot. Local drafts cover hard closes.
        dispatch({ type: 'owner-cleared', ownerId: entityId })
        const pending = pendingSnapshotRef.current
        const keepPendingForInFlight =
          previousEntityId != null
          && pending?.ownerId === previousEntityId
          && activeSaveOperationRef.current?.ownerId === previousEntityId
        if (!keepPendingForInFlight && pending?.ownerId === previousEntityId) {
          pendingSnapshotRef.current = null
        }
        if (dirtyOwnerIdRef.current === previousEntityId) {
          dirtyRef.current = false
          dirtyOwnerIdRef.current = null
        }
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
