import { useRef, useState } from 'react'
import { toast } from '@/shared/feedback/toast'
import type { MindMapEditorState } from '@/shared/api/contracts'
import type { ImportApplyContext } from '@/shared/api/contracts/imports'
import {
  applyImportedEditorState,
  formatMindMapImportError,
  restoreImportedEditorState,
  type ImportUndoSnapshot,
} from '@/features/mindmap-import/model/mindmap-import'
import type { ImportSourceKind } from '@/features/mindmap-import/model/mindmap-import-types'
import { countDocNodes, hasNodeUid } from '@/features/mindmap-import/hooks/mindmap-import-utils'
import { logAiCall } from '@/shared/logs/model/appLogs'

interface UseImportApplyControllerOptions {
  entityKey: string | null
  editorState: MindMapEditorState | null
  setEditorState: (nextState: MindMapEditorState) => void
  applyEditorState?: (nextState: MindMapEditorState, context?: ImportApplyContext) => Promise<void> | void
  selectedNodeUid: string | null
  importEditorDoc: MindMapEditorState['editor_doc']
  sourceTitle: string
  currentJobId: string | null
  sourceKind: ImportSourceKind
  setImportOpen: (open: boolean) => void
  setError: (value: string) => void
}

export function useImportApplyController({
  entityKey,
  editorState,
  setEditorState,
  applyEditorState,
  selectedNodeUid,
  importEditorDoc,
  sourceTitle,
  currentJobId,
  sourceKind,
  setImportOpen,
  setError,
}: UseImportApplyControllerOptions) {
  const [applying, setApplying] = useState(false)
  const [undoing, setUndoing] = useState(false)
  const [undoSnapshot, setUndoSnapshot] = useState<ImportUndoSnapshot | null>(null)
  const [externalSyncKey, setExternalSyncKey] = useState(0)
  const [appliedSyncVersion, setAppliedSyncVersion] = useState(0)
  const applyEditorStateRef = useRef(applyEditorState)

  const getRequestId = (error: unknown) =>
    error instanceof Error && 'requestId' in error && typeof error.requestId === 'string'
      ? error.requestId
      : ''

  applyEditorStateRef.current = applyEditorState

  const writeAppliedEditorState = async (
    nextState: MindMapEditorState,
    context?: ImportApplyContext,
  ) => {
    if (applyEditorStateRef.current) {
      await applyEditorStateRef.current(nextState, context)
      return
    }
    setEditorState(nextState)
  }

  const applyImport = async (applyMode: 'replace' | 'append') => {
    setApplying(true)
    setError('')
    if (applyMode === 'append' && !hasNodeUid(editorState?.editor_doc ?? null, selectedNodeUid)) {
      setApplying(false)
      setError('当前选中的追加目标知识点不存在于最新脑图中，请重新选中知识点后再试。')
      return
    }
    const applied = applyImportedEditorState({
      editorState,
      importedDoc: importEditorDoc,
      mode: applyMode,
      targetUid: selectedNodeUid,
      sourceTitle,
    })
    if (!applied.applied || !applied.nextEditorState || !applied.undoSnapshot) {
      setApplying(false)
      setError(formatMindMapImportError(applied.error))
      return
    }
    const requestSummary = `${applyMode === 'replace' ? '覆盖当前脑图' : '追加到选中知识点'}；来源：${sourceTitle || '未命名导入草稿'}`
    const beforeNodeCount = countDocNodes(editorState?.editor_doc ?? null)
    const afterNodeCount = countDocNodes(applied.nextEditorState.editor_doc)
    try {
      logAiCall({
        feature: '导入应用',
        stage: 'start',
        requestSummary,
        jobId: currentJobId,
        meta: {
          entityKey,
          applyMode,
          sourceKind,
          beforeNodeCount,
          afterNodeCount,
        },
      })
      await writeAppliedEditorState(applied.nextEditorState, {
        source: 'import',
        jobId: currentJobId,
        applyMode,
        sourceTitle,
      })
      setUndoSnapshot(applied.undoSnapshot)
      setExternalSyncKey((value) => value + 1)
      setAppliedSyncVersion((value) => value + 1)
      setImportOpen(false)
      logAiCall({
        feature: '导入应用',
        stage: 'success',
        requestSummary,
        responseSummary: `知识点数 ${beforeNodeCount} -> ${afterNodeCount}`,
        jobId: currentJobId,
        meta: {
          entityKey,
          applyMode,
          sourceKind,
          beforeNodeCount,
          afterNodeCount,
        },
      })
      toast.success(applyMode === 'replace' ? '已覆盖当前脑图' : '已追加到选中知识点')
    } catch (nextError) {
      const requestId = getRequestId(nextError)
      logAiCall({
        feature: '导入应用',
        stage: 'failure',
        requestSummary,
        errorMessage: nextError instanceof Error ? nextError.message : '导入结果应用失败，请稍后重试。',
        jobId: currentJobId,
        requestId,
        meta: {
          entityKey,
          applyMode,
          sourceKind,
          beforeNodeCount,
          afterNodeCount,
          requestId,
        },
      })
      setError(
        formatMindMapImportError(
          nextError instanceof Error ? nextError.message : '导入结果应用失败，请稍后重试。',
        ),
      )
    } finally {
      setApplying(false)
    }
  }

  const handleUndoLastImport = async () => {
    if (!undoSnapshot || !editorState) return
    setUndoing(true)
    const restored = restoreImportedEditorState(editorState, undoSnapshot)
    if (!restored) {
      setUndoing(false)
      return
    }
    try {
      await writeAppliedEditorState(restored)
      setUndoSnapshot(null)
      setExternalSyncKey((value) => value + 1)
      setAppliedSyncVersion((value) => value + 1)
      toast.success('已撤销最近一次导入')
    } catch (nextError) {
      const requestId = getRequestId(nextError)
      logAiCall({
        feature: '导入应用',
        stage: 'undo_failure',
        requestSummary: '撤销最近一次导入',
        errorMessage: nextError instanceof Error ? nextError.message : '撤销导入失败，请稍后重试。',
        jobId: currentJobId,
        requestId,
        meta: {
          entityKey,
          sourceKind,
          requestId,
        },
      })
      setError(
        formatMindMapImportError(
          nextError instanceof Error ? nextError.message : '撤销导入失败，请稍后重试。',
        ),
      )
    } finally {
      setUndoing(false)
    }
  }

  return {
    applying,
    undoing,
    externalSyncKey,
    appliedSyncVersion,
    canUndoLastImport: Boolean(undoSnapshot),
    handleApplyReplace: () => void applyImport('replace'),
    handleApplyAppend: () => void applyImport('append'),
    handleUndoLastImport,
    setUndoSnapshot,
  }
}
