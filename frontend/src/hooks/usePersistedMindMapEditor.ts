import { useCallback, useEffect, useRef, useState } from 'react'
import type { MindMapEditorState } from '@/api/client'

interface PersistedMindMapOptions<TResponse, TMeta> {
  entityId: number | null
  fetcher: (id: number) => Promise<TResponse>
  saver: (id: number, data: MindMapEditorState) => Promise<TResponse>
  selectMeta: (response: TResponse) => TMeta
  selectEditorState: (response: TResponse) => MindMapEditorState
}

export function usePersistedMindMapEditor<TResponse, TMeta>({
  entityId,
  fetcher,
  saver,
  selectMeta,
  selectEditorState,
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

  editorStateRef.current = editorState
  entityIdRef.current = entityId

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
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetcher(entityId)
      changeVersionRef.current = 0
      dirtyRef.current = false
      setMeta(selectMeta(response))
      setEditorState(selectEditorState(response))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load editor')
    } finally {
      setIsLoading(false)
    }
  }, [entityId, fetcher, selectEditorState, selectMeta])

  const flushSave = useCallback(async () => {
    if (!entityIdRef.current || !editorStateRef.current || !dirtyRef.current || isSaving) return
    const saveEntityId = entityIdRef.current
    const snapshot = editorStateRef.current
    const saveVersion = changeVersionRef.current
    dirtyRef.current = false
    setIsSaving(true)
    setError(null)
    try {
      const response = await saver(saveEntityId, snapshot)
      if (entityIdRef.current !== saveEntityId) return
      setMeta(selectMeta(response))
      if (changeVersionRef.current === saveVersion) {
        setEditorState(selectEditorState(response))
      }
    } catch (err) {
      dirtyRef.current = true
      setError(err instanceof Error ? err.message : 'Failed to save editor')
    } finally {
      setIsSaving(false)
      if (dirtyRef.current) {
        clearTimer()
        timerRef.current = window.setTimeout(() => {
          void flushSave()
        }, 400)
      }
    }
  }, [isSaving, saver, selectEditorState, selectMeta])

  const scheduleSave = useCallback((nextState: MindMapEditorState) => {
    changeVersionRef.current += 1
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
