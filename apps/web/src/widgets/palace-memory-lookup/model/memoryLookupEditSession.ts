import { useCallback, useEffect, useRef, useState } from 'react'
import { savePalaceEditorApi } from '@/modules/content/public'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { appConfirm } from '@/shared/components/ui/native-dialog'
import { APP_EVENT_NAMES, emitAppEvent } from '@/shared/events/appEvents'
import type { MemoryLookupEditSaveStatus } from '@/widgets/palace-memory-lookup/model/memoryLookupDialogSupport'

export const MEMORY_LOOKUP_EDIT_AUTOSAVE_MS = 800

const DANGEROUS_SAVE_MESSAGE = '检测到危险结构变更'

export interface MemoryLookupEditPersistResult {
  editorFingerprint: string
  unitReconcile: boolean
}

export interface MemoryLookupEditPersistOptions {
  syncReason?: 'editor_leave'
  confirmDangerous?: boolean
}

type MemoryLookupEditPersist = (
  palaceId: number,
  state: MindMapEditorState,
  expectedFingerprint: string,
  options?: MemoryLookupEditPersistOptions,
) => Promise<MemoryLookupEditPersistResult>

function readFingerprint(response: { editor_fingerprint?: string } | null | undefined) {
  return typeof response?.editor_fingerprint === 'string' ? response.editor_fingerprint.trim() : ''
}

function readUnitReconcile(response: { unit_reconcile?: unknown } | null | undefined) {
  return Boolean(response?.unit_reconcile)
}

/**
 * Autosave the full palace document from lookup edit mode.
 * Normal writes stay on palace_edit_autosave. A confirmed near-wipe retries as
 * palace_edit so the server accepts confirm_dangerous_change.
 */
export async function persistMemoryLookupPalaceEdit(
  palaceId: number,
  state: MindMapEditorState,
  expectedFingerprint: string,
  options?: MemoryLookupEditPersistOptions,
): Promise<MemoryLookupEditPersistResult> {
  const send = (confirmDangerous: boolean) => savePalaceEditorApi(palaceId, {
    ...state,
    expected_editor_fingerprint: expectedFingerprint || null,
    ...(options?.syncReason
      ? { sync_reason: options.syncReason, reconcile_units: true }
      : {}),
    ...(confirmDangerous
      ? { editor_source: 'palace_edit' as const, confirm_dangerous_change: true }
      : {}),
  }, 'ack')

  try {
    const response = await send(Boolean(options?.confirmDangerous))
    return {
      editorFingerprint: readFingerprint(response),
      unitReconcile: readUnitReconcile(response),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '')
    if (options?.confirmDangerous || !message.includes(DANGEROUS_SAVE_MESSAGE)) throw error
    const confirmed = await appConfirm(
      '这次保存会让宫殿知识点数量骤减。只有在你确实要大幅删除宫殿结构时才继续。确定继续保存吗？',
      { title: '确认危险保存', tone: 'danger' },
    )
    if (!confirmed) throw error
    const response = await send(true)
    return {
      editorFingerprint: readFingerprint(response),
      unitReconcile: readUnitReconcile(response),
    }
  }
}

function publishReconcile(result: MemoryLookupEditPersistResult) {
  if (!result.unitReconcile) return
  emitAppEvent(APP_EVENT_NAMES.palaceCatalogInvalidated)
}

export function useMemoryLookupEditDocument(
  palaceId: number | null,
  sourceState: MindMapEditorState | null,
  persist: MemoryLookupEditPersist = persistMemoryLookupPalaceEdit,
) {
  const [draft, setDraft] = useState<MindMapEditorState | null>(null)
  const [saveStatus, setSaveStatus] = useState<MemoryLookupEditSaveStatus>('idle')
  const [saveError, setSaveError] = useState('')
  const draftRef = useRef<MindMapEditorState | null>(null)
  const palaceIdRef = useRef(palaceId)
  const dirtyRef = useRef(false)
  const versionRef = useRef(0)
  const timerRef = useRef<number | null>(null)
  const chainRef = useRef(Promise.resolve())
  const mountedRef = useRef(true)
  const fingerprintByPalaceRef = useRef(new Map<number, string>())
  const persistRef = useRef(persist)
  persistRef.current = persist

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const rememberFingerprint = useCallback((id: number, fingerprint: string) => {
    const next = fingerprint.trim()
    if (!next) return
    fingerprintByPalaceRef.current.set(id, next)
  }, [])

  const expectedFingerprintFor = useCallback((id: number, fallback = '') => {
    return fingerprintByPalaceRef.current.get(id) || fallback
  }, [])

  const clearTimer = useCallback(() => {
    if (timerRef.current == null) return
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const enqueue = useCallback((task: () => Promise<void>) => {
    const run = chainRef.current.then(task, task)
    chainRef.current = run.then(() => undefined, () => undefined)
    return run
  }, [])

  const writeSnapshot = useCallback((
    id: number,
    state: MindMapEditorState,
    options?: MemoryLookupEditPersistOptions,
  ) => {
    return persistRef.current(id, state, expectedFingerprintFor(id), options).then((result) => {
      rememberFingerprint(id, result.editorFingerprint)
      publishReconcile(result)
    })
  }, [expectedFingerprintFor, rememberFingerprint])

  const saveCurrent = useCallback((options?: MemoryLookupEditPersistOptions) => {
    const id = palaceIdRef.current
    if (id == null || draftRef.current == null || !dirtyRef.current) return Promise.resolve()
    if (mountedRef.current) {
      setSaveStatus('saving')
      setSaveError('')
    }
    return enqueue(async () => {
      if (palaceIdRef.current !== id || draftRef.current == null || !dirtyRef.current) return
      const generation = versionRef.current
      const snapshot = draftRef.current
      try {
        await writeSnapshot(id, snapshot, options)
        if (palaceIdRef.current !== id) return
        if (versionRef.current === generation) {
          dirtyRef.current = false
          if (mountedRef.current) setSaveStatus('saved')
          return
        }
        if (mountedRef.current) setSaveStatus('idle')
      } catch (error) {
        if (palaceIdRef.current !== id) return
        dirtyRef.current = true
        if (!mountedRef.current) return
        setSaveStatus('error')
        setSaveError(error instanceof Error ? error.message : '保存宫殿脑图失败。')
      }
    })
  }, [enqueue, writeSnapshot])

  const flush = useCallback(() => {
    clearTimer()
    const id = palaceIdRef.current
    return saveCurrent({ syncReason: 'editor_leave' }).then(async () => {
      if (palaceIdRef.current === id && dirtyRef.current && draftRef.current) {
        await saveCurrent({ syncReason: 'editor_leave' })
      }
    })
  }, [clearTimer, saveCurrent])

  useEffect(() => () => {
    clearTimer()
    const id = palaceIdRef.current
    const state = draftRef.current
    if (id == null || state == null || !dirtyRef.current) return
    dirtyRef.current = false
    void enqueue(async () => {
      try {
        await writeSnapshot(id, state, { syncReason: 'editor_leave' })
      } catch {
        // The dialog is gone; the next open reloads the palace.
      }
    })
  }, [clearTimer, enqueue, writeSnapshot])

  useEffect(() => {
    const palaceChanged = palaceIdRef.current !== palaceId
    if (palaceChanged) {
      const leavingId = palaceIdRef.current
      const leavingState = draftRef.current
      const leavingDirty = dirtyRef.current
      clearTimer()
      palaceIdRef.current = palaceId
      dirtyRef.current = false
      versionRef.current += 1
      draftRef.current = null
      setDraft(null)
      setSaveStatus('idle')
      setSaveError('')
      if (leavingDirty && leavingId != null && leavingState) {
        void enqueue(async () => {
          try {
            await writeSnapshot(leavingId, leavingState, { syncReason: 'editor_leave' })
          } catch {
            // Switching palaces must not block the next document.
          }
        })
      }
    }
    palaceIdRef.current = palaceId
    if (!dirtyRef.current && palaceId != null && sourceState?.editor_fingerprint) {
      rememberFingerprint(palaceId, sourceState.editor_fingerprint)
    }
    if (!dirtyRef.current) {
      draftRef.current = sourceState
      setDraft(sourceState)
    }
  }, [clearTimer, enqueue, palaceId, rememberFingerprint, sourceState, writeSnapshot])

  const handleEditorStateChange = useCallback((next: MindMapEditorState) => {
    dirtyRef.current = true
    versionRef.current += 1
    draftRef.current = next
    setDraft(next)
    if (mountedRef.current) {
      setSaveStatus((current) => (current === 'error' ? current : 'idle'))
    }
    clearTimer()
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      void saveCurrent()
    }, MEMORY_LOOKUP_EDIT_AUTOSAVE_MS)
  }, [clearTimer, saveCurrent])

  return {
    editorState: draft ?? sourceState,
    handleEditorStateChange,
    saveStatus,
    saveError,
    flush,
  }
}
