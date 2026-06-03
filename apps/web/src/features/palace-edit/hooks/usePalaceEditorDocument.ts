import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  createPalaceApi,
  getPalaceEditorApi,
  savePalaceEditorApi,
  savePalaceEditorWithOptionsApi,
} from '@/shared/api/modules/palaces'
import { usePersistedMindMapEditor } from '@/shared/hooks/usePersistedMindMapEditor'
import type { MindMapEditorState } from '@/shared/api/contracts'
import type { ImportApplyContext } from '@/features/palace-edit/model/mindmap-import-types'
import {
  applyProgrammaticEditorState,
  countEditorDocNodes,
  fingerprintEditorDoc,
} from '@/shared/lib/applyProgrammaticEditorState'
import { logAiCall } from '@/shared/logs/model/appLogs'
import {
  buildImportExpectedNodeCount,
  buildPalaceImportValidationFingerprint,
} from '@/features/palace-edit/model/mindmap-editor'
import type { PalaceMeta } from '@/features/palace-edit/model/palace-edit-types'

type ImportApplyGuardPhase = 'saving' | 'reloading' | 'awaiting_sync'

interface ImportApplyGuardState {
  expectedFingerprint: string
  expectedNodeCount: number
  phase: ImportApplyGuardPhase
  ignoredSyncCount: number
  jobId: string | null
  applyMode: 'replace' | 'append'
  requestSummary: string
  releaseAt: number
}

interface PalaceEditorDocumentOptions {
  palaceId: number | null
  setReplaceSyncVersion: Dispatch<SetStateAction<number>>
}

export function usePalaceEditorDocument({
  palaceId,
  setReplaceSyncVersion,
}: PalaceEditorDocumentOptions) {
  const [isCreatingDraft, setIsCreatingDraft] = useState(false)
  const importApplyGuardRef = useRef<ImportApplyGuardState | null>(null)
  const importApplyGuardTimerRef = useRef<number | null>(null)

  const {
    meta,
    setMeta,
    editorState,
    setEditorState,
    replaceEditorState,
    adoptExternalState,
    isSaving,
    error,
    reload,
    flushSave,
  } = usePersistedMindMapEditor({
    entityId: palaceId,
    fetcher: getPalaceEditorApi,
    saver: savePalaceEditorApi,
    selectMeta: (response) => response.palace as PalaceMeta,
    selectEditorState: (response) => ({
      editor_doc: response.editor_doc,
      editor_config: response.editor_config,
      editor_local_config: response.editor_local_config,
      lang: response.lang,
    }),
    onSaveError: async (nextError, pendingState) => {
      if (!nextError.message.includes('危险结构变更')) return false
      const forced = await confirmDangerousPalaceSave(pendingState)
      if (!forced) return true
      await reload()
      setReplaceSyncVersion((value) => value + 1)
      return true
    },
  })
  const effectivePalaceTitle = (meta as PalaceMeta | null)?.title || '未命名宫殿'

  const clearImportApplyGuardTimer = useCallback(() => {
    if (importApplyGuardTimerRef.current != null) {
      window.clearTimeout(importApplyGuardTimerRef.current)
      importApplyGuardTimerRef.current = null
    }
  }, [])

  const releaseImportApplyGuard = useCallback(
    (reason: 'matched_expected_sync' | 'timeout' | 'error' | 'superseded') => {
      clearImportApplyGuardTimer()
      const currentGuard = importApplyGuardRef.current
      importApplyGuardRef.current = null
      if (!currentGuard) return
      if (currentGuard.ignoredSyncCount > 0 || reason === 'matched_expected_sync') {
        logAiCall({
          feature: '导入应用',
          stage: 'guard_release',
          requestSummary: currentGuard.requestSummary,
          responseSummary: `释放导入保护：${reason}`,
          jobId: currentGuard.jobId,
          meta: {
            palaceId,
            applyMode: currentGuard.applyMode,
            expectedNodeCount: currentGuard.expectedNodeCount,
            ignoredStaleSyncCount: currentGuard.ignoredSyncCount,
            reason,
          },
        })
      }
    },
    [clearImportApplyGuardTimer, palaceId],
  )

  const syncImportApplyGuardWithSavedState = useCallback((savedState: MindMapEditorState) => {
    const currentGuard = importApplyGuardRef.current
    if (!currentGuard) return
    currentGuard.expectedFingerprint = fingerprintEditorDoc(savedState.editor_doc)
    currentGuard.expectedNodeCount = countEditorDocNodes(savedState.editor_doc)
    currentGuard.phase = 'reloading'
  }, [])

  const beginImportApplyGuard = useCallback(
    (nextState: MindMapEditorState, context: ImportApplyContext) => {
      releaseImportApplyGuard('superseded')
      importApplyGuardRef.current = {
        expectedFingerprint: fingerprintEditorDoc(nextState.editor_doc),
        expectedNodeCount: buildImportExpectedNodeCount(nextState.editor_doc),
        phase: 'saving',
        ignoredSyncCount: 0,
        jobId: context.jobId,
        applyMode: context.applyMode,
        requestSummary: `${context.applyMode === 'replace' ? '覆盖当前脑图' : '追加到选中节点'}；来源：${context.sourceTitle || '导入草稿'}`,
        releaseAt: 0,
      }
    },
    [releaseImportApplyGuard],
  )

  const moveImportApplyGuardToAwaitingSync = useCallback(() => {
    const currentGuard = importApplyGuardRef.current
    if (!currentGuard) return
    clearImportApplyGuardTimer()
    currentGuard.phase = 'awaiting_sync'
    currentGuard.releaseAt = Date.now() + 2500
    importApplyGuardTimerRef.current = window.setTimeout(() => {
      releaseImportApplyGuard('timeout')
    }, 2500)
  }, [clearImportApplyGuardTimer, releaseImportApplyGuard])

  const savePalaceEditorAfterDangerousConfirm = useCallback(
    async (nextState: MindMapEditorState) => {
      if (!palaceId) return null
      const confirmed = window.confirm(
        '这次保存会让宫殿节点数量骤减。只有在你确实要大幅删除宫殿结构时才继续。确定继续保存吗？',
      )
      if (!confirmed) return null
      return await savePalaceEditorWithOptionsApi(palaceId, {
        ...nextState,
        confirm_dangerous_change: true,
        editor_source: 'palace_edit',
      })
    },
    [palaceId],
  )

  const confirmDangerousPalaceSave = useCallback(
    async (nextState: MindMapEditorState) => Boolean(await savePalaceEditorAfterDangerousConfirm(nextState)),
    [savePalaceEditorAfterDangerousConfirm],
  )

  const buildPalaceEditorStateFromResponse = useCallback(
    (response: any) => ({
      editor_doc: response.editor_doc,
      editor_config: response.editor_config,
      editor_local_config: response.editor_local_config,
      lang: response.lang,
    }),
    [],
  )

  const applyImportedPalaceEditorState = useCallback(
    async (nextState: MindMapEditorState, context?: ImportApplyContext) => {
      if (!palaceId) {
        throw new Error('当前还没有稳定的宫殿标识，暂时无法应用导入结果。')
      }
      const validationContext =
        context?.source === 'import'
          ? {
              ...context,
              expectedFingerprint: buildPalaceImportValidationFingerprint(
                nextState.editor_doc,
                effectivePalaceTitle,
              ),
              expectedNodeCount: countEditorDocNodes(nextState.editor_doc),
            }
          : context
      await applyProgrammaticEditorState({
        previousState: editorState,
        nextState,
        context: validationContext,
        flushPendingSaves: flushSave,
        fingerprintEditorDocForValidation: (value) =>
          buildPalaceImportValidationFingerprint(value, effectivePalaceTitle),
        beginProtectedWrite: (protectedState, nextContext) => {
          if (nextContext?.source === 'import') {
            beginImportApplyGuard(protectedState, nextContext as ImportApplyContext)
          }
        },
        releaseProtectedWrite: () => releaseImportApplyGuard('error'),
        optimisticApply: replaceEditorState,
        rollback: replaceEditorState,
        adoptSavedState: (savedState) => {
          adoptExternalState(savedState, { protectFromStaleLoads: true, releaseAfterMs: 4000 })
        },
        save: async () => {
          try {
            const response = await savePalaceEditorApi(palaceId, nextState)
            syncImportApplyGuardWithSavedState(buildPalaceEditorStateFromResponse(response))
            return response
          } catch (nextError) {
            const message =
              nextError instanceof Error ? nextError.message : '导入结果应用失败，请稍后重试。'
            if (message.includes('危险结构变更')) {
              const forcedResponse = await savePalaceEditorAfterDangerousConfirm(nextState)
              if (!forcedResponse) {
                throw nextError instanceof Error ? nextError : new Error(message)
              }
              syncImportApplyGuardWithSavedState(buildPalaceEditorStateFromResponse(forcedResponse))
              return forcedResponse
            }
            throw nextError instanceof Error ? nextError : new Error(message)
          }
        },
        selectSavedEditorState: buildPalaceEditorStateFromResponse,
        afterSave: (response) => {
          setMeta(response.palace as PalaceMeta)
        },
        reload,
        afterReload: () => {
          if (context?.source === 'import') {
            moveImportApplyGuardToAwaitingSync()
          } else {
            releaseImportApplyGuard('superseded')
          }
        },
      })
    },
    [
      adoptExternalState,
      beginImportApplyGuard,
      buildPalaceEditorStateFromResponse,
      editorState,
      flushSave,
      moveImportApplyGuardToAwaitingSync,
      palaceId,
      releaseImportApplyGuard,
      reload,
      replaceEditorState,
      savePalaceEditorAfterDangerousConfirm,
      setMeta,
      syncImportApplyGuardWithSavedState,
      effectivePalaceTitle,
    ],
  )

  const handleMindMapEditorStateChange = useCallback(
    (nextState: MindMapEditorState, onAccepted?: () => void) => {
      const currentGuard = importApplyGuardRef.current
      if (currentGuard) {
        if (currentGuard.phase === 'awaiting_sync' && Date.now() >= currentGuard.releaseAt) {
          releaseImportApplyGuard('timeout')
        } else {
          const nextFingerprint = fingerprintEditorDoc(nextState.editor_doc)
          if (nextFingerprint === currentGuard.expectedFingerprint) {
            if (currentGuard.phase === 'awaiting_sync') {
              releaseImportApplyGuard('matched_expected_sync')
            }
            return
          }
          currentGuard.ignoredSyncCount += 1
          return
        }
      }
      onAccepted?.()
      setEditorState(nextState)
    },
    [releaseImportApplyGuard, setEditorState],
  )

  useEffect(() => {
    return () => {
      clearImportApplyGuardTimer()
    }
  }, [clearImportApplyGuardTimer])

  return {
    meta,
    setMeta,
    editorState,
    setEditorState,
    isSaving,
    error,
    reload,
    flushSave,
    isCreatingDraft,
    setIsCreatingDraft,
    applyImportedPalaceEditorState,
    handleMindMapEditorStateChange,
    requestDraftPalaceId: requestDraftPalaceId,
  }
}

const pendingDraftCreationByLocationKey = new Map<string, Promise<number>>()

function requestDraftPalaceId(locationKey: string) {
  const existing = pendingDraftCreationByLocationKey.get(locationKey)
  if (existing) return existing

  const pending = createPalaceApi({ title: '未命名宫殿', description: '', pegs: [] })
    .then((created) => created.id as number)
    .catch((error) => {
      pendingDraftCreationByLocationKey.delete(locationKey)
      throw error
    })

  pendingDraftCreationByLocationKey.set(locationKey, pending)
  return pending
}
