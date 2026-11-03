import { useCallback, useEffect, useRef, useState } from 'react'
import type { MindMapEditorState } from '@/shared/api/contracts'
import type {
  PersistPalaceEditorOptions,
  PersistPalaceEditorResult,
} from './freestyleBranchCardSupport'
import { persistPalaceEditor } from './freestyleBranchCardSupport'
import type { FreestyleEditorSaveState } from './FreestyleUnitReviewFlipCanvas'

export function useFreestyleUnitReviewPersistence({
  palaceId,
  editorState,
  editEditorStateRef,
  displayModeRef,
  onEditorStateSaved,
  onSaveFailed,
  onReconcile,
  onBeforeReturnReconcile,
  onReturnReconcilePending,
}: {
  palaceId: number
  editorState: MindMapEditorState
  editEditorStateRef: React.MutableRefObject<MindMapEditorState>
  displayModeRef: React.MutableRefObject<'review' | 'edit'>
  onEditorStateSaved?: (state: MindMapEditorState) => void
  onSaveFailed?: (message: string) => void
  onReconcile?: (
    result: PersistPalaceEditorResult,
    refreshQueue?: boolean,
  ) => void | Promise<void>
  onBeforeReturnReconcile?: () => Promise<void>
  onReturnReconcilePending?: (pending: boolean) => void
}) {
  const [savingEdit, setSavingEdit] = useState(false)
  const [saveState, setSaveState] = useState<FreestyleEditorSaveState>('idle')
  const saveStatusTimerRef = useRef<number | null>(null)
  const saveQueueRef = useRef<Promise<PersistPalaceEditorResult | null>>(Promise.resolve(null))
  const persistGenerationRef = useRef(0)
  const pendingPersistRef = useRef<{
    state: MindMapEditorState
    persistOptions?: PersistPalaceEditorOptions
    generation: number
  } | null>(null)
  const activePersistRef = useRef(false)
  const lastSavedFingerprintRef = useRef(editorState.editor_fingerprint || '')
  const lastPersistResultRef = useRef<PersistPalaceEditorResult | null>(null)
  const lastFailedPersistRef = useRef<{
    state: MindMapEditorState
    persistOptions?: PersistPalaceEditorOptions
  } | null>(null)
  const editedSinceReconcileRef = useRef(false)
  const returnReconcileRef = useRef<Promise<void> | null>(null)
  const leaveReconcileSentRef = useRef(false)

  useEffect(() => {
    lastSavedFingerprintRef.current = editorState.editor_fingerprint || lastSavedFingerprintRef.current
  }, [editorState.editor_fingerprint])

  const clearSaveStatusTimer = useCallback(() => {
    if (saveStatusTimerRef.current != null) {
      window.clearTimeout(saveStatusTimerRef.current)
      saveStatusTimerRef.current = null
    }
  }, [])

  const showSavedStatus = useCallback(() => {
    clearSaveStatusTimer()
    setSaveState('saved')
    saveStatusTimerRef.current = window.setTimeout(() => {
      saveStatusTimerRef.current = null
      setSaveState((current) => current === 'saved' ? 'idle' : current)
    }, 1_600)
  }, [clearSaveStatusTimer])

  useEffect(() => () => clearSaveStatusTimer(), [clearSaveStatusTimer])

  const persistEdit = useCallback(async (
    state: MindMapEditorState,
    options?: PersistPalaceEditorOptions,
  ) => {
    pendingPersistRef.current = {
      state,
      persistOptions: options && Object.keys(options).length > 0 ? options : undefined,
      generation: persistGenerationRef.current,
    }
    clearSaveStatusTimer()
    setSaveState('saving')
    setSavingEdit(true)
    const previous = saveQueueRef.current.catch(() => null)
    const queued = previous.then(async () => {
      let lastResult = lastPersistResultRef.current
      activePersistRef.current = true
      try {
        while (pendingPersistRef.current) {
          const job = pendingPersistRef.current
          pendingPersistRef.current = null
          const fingerprintHint = lastSavedFingerprintRef.current || job.state.editor_fingerprint
          const payload = fingerprintHint
            ? { ...job.state, editor_fingerprint: fingerprintHint }
            : job.state
          try {
            const result = await persistPalaceEditor(palaceId, payload, job.persistOptions)
            const fingerprint = result.state.editor_fingerprint
            if (fingerprint) lastSavedFingerprintRef.current = fingerprint
            const adopted = {
              ...job.state,
              editor_fingerprint: fingerprint || job.state.editor_fingerprint,
            }
            const isLatest = persistGenerationRef.current === job.generation
            if (isLatest) {
              editEditorStateRef.current = adopted
              onEditorStateSaved?.(adopted)
            }
            if (job.persistOptions?.reconcileUnits || job.persistOptions?.syncReason) {
              void onReconcile?.(result)
            }
            lastResult = {
              state: isLatest
                ? adopted
                : {
                    ...editEditorStateRef.current,
                    editor_fingerprint: fingerprint || editEditorStateRef.current.editor_fingerprint,
                  },
              unitReconcile: result.unitReconcile,
            }
            lastPersistResultRef.current = lastResult
          } catch (error) {
            const message = error instanceof Error ? error.message : '保存宫殿失败'
            lastFailedPersistRef.current = { state: job.state, persistOptions: job.persistOptions }
            onSaveFailed?.(message)
            lastResult = null
            lastPersistResultRef.current = null
          }
        }
        return lastResult
      } finally {
        activePersistRef.current = false
      }
    })
    saveQueueRef.current = queued
    void queued.finally(() => {
      if (saveQueueRef.current !== queued) return
      setSavingEdit(false)
      if (lastPersistResultRef.current) {
        lastFailedPersistRef.current = null
        showSavedStatus()
      } else {
        setSaveState('error')
      }
    })
    return queued
  }, [clearSaveStatusTimer, editEditorStateRef, onEditorStateSaved, onReconcile, onSaveFailed, palaceId, showSavedStatus])

  const reconcileReturn = useCallback(() => {
    if (!editedSinceReconcileRef.current || returnReconcileRef.current) return
    onReturnReconcilePending?.(true)
    clearSaveStatusTimer()
    setSaveState('saving')
    const generation = persistGenerationRef.current
    const previous = saveQueueRef.current
    const task = (async () => {
      try {
        const previousResult = await previous
        if (!previousResult && !activePersistRef.current) throw new Error('保存宫殿失败，请重试')
        await onBeforeReturnReconcile?.()
        if (displayModeRef.current === 'edit' || generation !== persistGenerationRef.current) return
        const current = editEditorStateRef.current
        const result = await persistPalaceEditor(palaceId, {
          ...current,
          editor_fingerprint: lastSavedFingerprintRef.current || current.editor_fingerprint,
        }, { reconcileUnits: true, syncReason: 'return_to_review' })
        if (result.state.editor_fingerprint) lastSavedFingerprintRef.current = result.state.editor_fingerprint
        if (generation !== persistGenerationRef.current || displayModeRef.current !== 'review') return
        editedSinceReconcileRef.current = false
        lastFailedPersistRef.current = null
        lastPersistResultRef.current = {
          state: {
            ...current,
            editor_fingerprint: result.state.editor_fingerprint || current.editor_fingerprint,
          },
          unitReconcile: result.unitReconcile,
        }
        leaveReconcileSentRef.current = true
        showSavedStatus()
        await onReconcile?.(result, true)
      } catch (error) {
        const message = error instanceof Error ? error.message : '更新复习单元失败'
        lastFailedPersistRef.current = {
          state: editEditorStateRef.current,
          persistOptions: { reconcileUnits: true, syncReason: 'return_to_review' },
        }
        editedSinceReconcileRef.current = true
        setSaveState('error')
        onSaveFailed?.(message)
      } finally {
        if (generation === persistGenerationRef.current && displayModeRef.current === 'review') {
          onReturnReconcilePending?.(false)
        }
      }
    })()
    returnReconcileRef.current = task
    saveQueueRef.current = task.then(() => null)
    void task.finally(() => {
      if (returnReconcileRef.current !== task) return
      returnReconcileRef.current = null
      setSavingEdit(false)
    })
  }, [clearSaveStatusTimer, displayModeRef, editEditorStateRef, onBeforeReturnReconcile, onReconcile, onReturnReconcilePending, onSaveFailed, palaceId, showSavedStatus])

  const retrySave = useCallback(() => {
    const failed = lastFailedPersistRef.current
    if (!failed) return
    const retry = failed.persistOptions?.syncReason === 'return_to_review'
      ? persistEdit(editEditorStateRef.current).then((result) => result && reconcileReturn())
      : persistEdit(editEditorStateRef.current, failed.persistOptions)
    void retry
  }, [editEditorStateRef, persistEdit, reconcileReturn])

  const flushEditorLeave = useCallback(() => persistEdit(editEditorStateRef.current, {
    reconcileUnits: true,
    syncReason: 'editor_leave',
  }), [editEditorStateRef, persistEdit])

  return {
    savingEdit,
    saveState,
    persistGenerationRef,
    editedSinceReconcileRef,
    returnReconcileRef,
    leaveReconcileSentRef,
    lastSavedFingerprintRef,
    persistEdit,
    reconcileReturn,
    retrySave,
    flushEditorLeave,
  }
}
