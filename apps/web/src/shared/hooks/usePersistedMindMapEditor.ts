import { useCallback, useEffect, useRef, useState } from 'react'
import type { MindMapEditorState } from '@/shared/api/client'

interface PersistedMindMapOptions<TResponse, TMeta> {
  entityId: number | null
  fetcher: (id: number) => Promise<TResponse>
  saver: (id: number, data: MindMapEditorState) => Promise<TResponse>
  selectMeta: (response: TResponse) => TMeta
  selectEditorState: (response: TResponse) => MindMapEditorState
  onSaveError?: (error: Error, pendingState: MindMapEditorState) => Promise<boolean> | boolean
}

function stableSerialize(value: unknown) {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

export function usePersistedMindMapEditor<TResponse, TMeta>({
  entityId,
  fetcher,
  saver,
  selectMeta,
  selectEditorState,
  onSaveError,
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
  const lastStateFingerprintRef = useRef('')

  editorStateRef.current = editorState
  entityIdRef.current = entityId
  fetcherRef.current = fetcher
  saverRef.current = saver
  selectMetaRef.current = selectMeta
  selectEditorStateRef.current = selectEditorState
  onSaveErrorRef.current = onSaveError

  const clearTimer = () => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const load = useCallback(async () => {
    if (!entityId) {
      setMeta(null)
      setEditorState(null)
      lastStateFingerprintRef.current = ''
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetcherRef.current(entityId)
      const nextEditorState = selectEditorStateRef.current(response)
      changeVersionRef.current = 0
      dirtyRef.current = false
      lastStateFingerprintRef.current = stableSerialize(nextEditorState)
      setMeta(selectMetaRef.current(response))
      setEditorState(nextEditorState)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load editor')
    } finally {
      setIsLoading(false)
    }
  }, [entityId])

  const flushSave = useCallback(async () => {
    if (!entityIdRef.current || !editorStateRef.current || !dirtyRef.current || isSaving) return
    const saveEntityId = entityIdRef.current
    const snapshot = editorStateRef.current
    const saveVersion = changeVersionRef.current
    dirtyRef.current = false
    setIsSaving(true)
    setError(null)
    try {
      const response = await saverRef.current(saveEntityId, snapshot)
      if (entityIdRef.current !== saveEntityId) return
      const nextEditorState = selectEditorStateRef.current(response)
      lastStateFingerprintRef.current = stableSerialize(nextEditorState)
      setMeta(selectMetaRef.current(response))
      if (changeVersionRef.current === saveVersion) {
        setEditorState(nextEditorState)
      }
    } catch (err) {
      const nextError = err instanceof Error ? err : new Error('Failed to save editor')
      let handled = false
      if (onSaveErrorRef.current) {
        handled = await onSaveErrorRef.current(nextError, snapshot)
      }
      dirtyRef.current = !handled
      setError(nextError.message)
    } finally {
      setIsSaving(false)
      if (dirtyRef.current) {
        clearTimer()
        timerRef.current = window.setTimeout(() => {
          void flushSave()
        }, 400)
      }
    }
  }, [isSaving])

  const scheduleSave = useCallback((nextState: MindMapEditorState) => {
    const nextFingerprint = stableSerialize(nextState)
    if (nextFingerprint === lastStateFingerprintRef.current) {
      return
    }
    changeVersionRef.current += 1
    lastStateFingerprintRef.current = nextFingerprint
    setEditorState(nextState)
    dirtyRef.current = true
    clearTimer()
    timerRef.current = window.setTimeout(() => {
      void flushSave()
    }, 450)
  }, [flushSave])

  useEffect(() => {
    void load()
    return () => clearTimer()
  }, [load])

  return {
    meta,
    setMeta,
    editorState,
    setEditorState: scheduleSave,
    replaceEditorState: setEditorState,
    isLoading,
    isSaving,
    error,
    reload: load,
    flushSave,
  }
}
