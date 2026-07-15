import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  createPalaceApi,
  getPalaceEditorApi,
  savePalaceEditorApi,
  savePalaceEditorWithOptionsApi,
} from '@/entities/palace/api'
import { useMindMapDocumentSession } from '@/shared/hooks/useMindMapDocumentSession'
import type { MindMapEditorState, PalaceEditorResponse } from '@/shared/api/contracts'
import type { ImportApplyContext } from '@/shared/api/contracts/imports'
import {
  applyProgrammaticEditorState,
  countEditorDocNodes,
  fingerprintEditorDoc,
} from '@/shared/lib/applyProgrammaticEditorState'
import { logAiCall } from '@/shared/logs/model/appLogs'
import {
  buildImportExpectedNodeCount,
  buildMindMapImportValidationFingerprint,
} from '@/features/palace-edit/model/mindmap-editor'
import type { PalaceMeta } from '@/features/palace-edit/model/palace-edit-types'
import { appConfirm } from '@/shared/components/ui/native-dialog'
import { readMindMapEditorState } from '@/entities/mindmap-document'

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

interface PalaceAuthoritativeSnapshot {
  fingerprint: string
  nodeCount: number
}

export function usePalaceEditorDocument({
  palaceId,
  setReplaceSyncVersion,
}: PalaceEditorDocumentOptions) {
  const [isCreatingDraft, setIsCreatingDraft] = useState(false)
  const importApplyGuardRef = useRef<ImportApplyGuardState | null>(null)
  const importApplyGuardTimerRef = useRef<number | null>(null)
  const authoritativeSnapshotRef = useRef<PalaceAuthoritativeSnapshot | null>(null)

  const {
    meta,
    setMeta,
    editorState,
    setEditorState,
    replaceEditorState,
    adoptExternalState,
    isLoadError,
    isSaving,
    hasUnsavedChanges,
    saveStatus,
    error,
    reload,
    flushSave,
  } = useMindMapDocumentSession({
    entityId: palaceId,
    adapter: {
      load: getPalaceEditorApi,
      save: savePalaceEditorApi,
      selectMeta: (response) => response.palace as PalaceMeta,
      selectEditorState: readMindMapEditorState,
    },
    onSaveError: async (nextError, pendingState) => {
      if (!nextError.message.includes('危险结构变更')) return false
      const forced = await confirmDangerousPalaceSave(pendingState)
      if (!forced) return true
      await reload()
      setReplaceSyncVersion((value) => value + 1)
      return true
    },
    beforeAutoSave: (nextState) => {
      const authoritativeSnapshot = authoritativeSnapshotRef.current
      if (!authoritativeSnapshot) return null
      const nextNodeCount = countEditorDocNodes(nextState.editor_doc)
      const nextFingerprint = fingerprintEditorDoc(nextState.editor_doc)
      const nodeDrop = authoritativeSnapshot.nodeCount - nextNodeCount
      if (
        authoritativeSnapshot.nodeCount >= 8 &&
        nextNodeCount < authoritativeSnapshot.nodeCount &&
        nodeDrop >= Math.max(3, Math.floor(authoritativeSnapshot.nodeCount * 0.25)) &&
        nextFingerprint !== authoritativeSnapshot.fingerprint
      ) {
        return '已阻止旧态覆盖当前宫殿：自动保存内容明显少于最近一次服务端加载结果。'
      }
      return null
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
      const confirmed = await appConfirm(
        '这次保存会让宫殿知识点数量骤减。只有在你确实要大幅删除宫殿结构时才继续。确定继续保存吗？',
        { title: '确认危险保存', tone: 'danger' },
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
    (response: PalaceEditorResponse) => ({
      editor_doc: response.editor_doc,
      editor_config: response.editor_config,
      editor_local_config: response.editor_local_config,
      lang: response.lang,
      editor_fingerprint: response.editor_fingerprint,
    }),
    [],
  )

  const syncAuthoritativeSnapshot = useCallback((nextState: MindMapEditorState | null) => {
    if (!nextState) {
      authoritativeSnapshotRef.current = null
      return
    }
    authoritativeSnapshotRef.current = {
      fingerprint: fingerprintEditorDoc(nextState.editor_doc),
      nodeCount: countEditorDocNodes(nextState.editor_doc),
    }
  }, [])

  const applyImportedPalaceEditorState = useCallback(
    async (nextState: MindMapEditorState, context?: ImportApplyContext) => {
      if (!palaceId) {
        throw new Error('当前还没有稳定的宫殿标识，暂时无法应用导入结果。')
      }
      const validationContext =
        context?.source === 'import'
          ? {
              ...context,
              expectedFingerprint: buildMindMapImportValidationFingerprint(
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
          buildMindMapImportValidationFingerprint(value, effectivePalaceTitle),
        beginProtectedWrite: (protectedState, nextContext) => {
          if (nextContext?.source === 'import') {
            beginImportApplyGuard(protectedState, nextContext as ImportApplyContext)
          }
        },
        releaseProtectedWrite: () => releaseImportApplyGuard('error'),
        optimisticApply: replaceEditorState,
        rollback: replaceEditorState,
        adoptSavedState: (savedState) => {
          syncAuthoritativeSnapshot(savedState)
          adoptExternalState(savedState, { protectFromStaleLoads: true, releaseAfterMs: 4000 })
        },
        save: async () => {
          try {
            const response = await savePalaceEditorApi(palaceId, {
              ...nextState,
              editor_source: 'import_apply',
              sync_reason: context?.source === 'import' ? 'import_apply' : 'programmatic_apply',
              allow_stale_overwrite: true,
            })
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
      syncAuthoritativeSnapshot,
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
    syncAuthoritativeSnapshot(editorState)
  }, [editorState, syncAuthoritativeSnapshot])

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
    isLoadError,
    isSaving,
    hasUnsavedChanges,
    saveStatus,
    error,
    reload,
    flushSave,
    isCreatingDraft,
    setIsCreatingDraft,
    applyImportedPalaceEditorState,
    handleMindMapEditorStateChange,
    createDraftPalace,
  }
}

async function createDraftPalace(options: { title: string; subjectIds: number[] }) {
  const created = await createPalaceApi({ title: options.title, subject_ids: options.subjectIds, description: '', pegs: [] })
  return created.id as number
}
