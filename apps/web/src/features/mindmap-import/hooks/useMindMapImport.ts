import { useCallback, useState, type ChangeEvent, type ClipboardEvent } from 'react'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { useImportApplyController } from '@/features/mindmap-import/hooks/useImportApplyController'
import { useImportBatchState } from '@/features/mindmap-import/hooks/useImportBatchState'
import { useImportJobController } from '@/features/mindmap-import/hooks/useImportJobController'
import { useAiRunConfigDialog } from '@/features/ai-config/useAiRunConfigDialog'
import type {
  BatchImportMeta,
  ImportApplyContext,
  ImportMode,
  ImportSourceKind,
  MindMapImportWorkflow,
} from '@/features/mindmap-import/model/mindmap-import-types'

interface UseMindMapImportOptions {
  entityKey: string | null
  editorState: MindMapEditorState | null
  setEditorState: (nextState: MindMapEditorState) => void
  applyEditorState?: (nextState: MindMapEditorState, context?: ImportApplyContext) => Promise<void> | void
  selectedNodeUid?: string | null
}

export type {
  BatchImportImageItem,
  ImportApplyContext,
  ImportMode,
  ImportSourceKind,
  MindMapImportWorkflow,
} from '@/features/mindmap-import/model/mindmap-import-types'

export function useMindMapImport({
  entityKey,
  editorState,
  setEditorState,
  applyEditorState,
  selectedNodeUid = null,
}: UseMindMapImportOptions) {
  const [controllerError, setControllerError] = useState('')
  const [mode, setModeState] = useState<ImportMode>('mindmap')
  const [sourceKind, setSourceKindState] = useState<ImportSourceKind>('image-single')
  const [mindMapWorkflow, setMindMapWorkflowState] = useState<MindMapImportWorkflow>('single')

  const batch = useImportBatchState(setControllerError)
  const { promptForAiOptions, aiRunConfigDialog } = useAiRunConfigDialog()
  const jobs = useImportJobController({
    entityKey,
    mode,
    sourceKind,
    setModeState,
    setSourceKindState,
    setMindMapWorkflowState,
    batchImagesRef: batch.batchImagesRef,
    setBatchStatus: batch.setBatchStatus,
    setLastBatchMeta: batch.setLastBatchMeta,
    promptForAiOptions,
  })

  const apply = useImportApplyController({
    entityKey,
    editorState,
    setEditorState,
    applyEditorState,
    selectedNodeUid,
    importEditorDoc: jobs.importPreviewEditorDoc,
    sourceTitle: jobs.importSourceTree?.title || '',
    currentJobId: jobs.currentJobId,
    sourceKind,
    setImportOpen: (open) => void jobs.setImportOpen(open),
    setError: jobs.setImportError,
  })

  const setImportMode = (nextMode: ImportMode) => {
    setModeState(nextMode)
    setControllerError('')
    jobs.setImportError('')
    if (nextMode === 'text' && sourceKind === 'image-batch') {
      setSourceKindState('image-single')
      setMindMapWorkflowState('single')
    }
  }

  const setImportSourceKind = (nextSourceKind: ImportSourceKind) => {
    setSourceKindState(nextSourceKind)
    if (nextSourceKind === 'image-single') {
      setMindMapWorkflowState('single')
    } else if (nextSourceKind === 'image-batch') {
      setMindMapWorkflowState('batch')
    }
    setControllerError('')
    jobs.setImportError('')
  }

  const setMindMapImportWorkflow = (workflow: MindMapImportWorkflow) => {
    setMindMapWorkflowState(workflow)
    setSourceKindState(workflow === 'batch' ? 'image-batch' : 'image-single')
    setControllerError('')
    jobs.setImportError('')
    if (workflow === 'batch') {
      batch.setBatchStatus(batch.batchImages.length > 0 ? 'ready' : 'idle')
    }
  }

  const handleImportPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const items = event.clipboardData?.items
    if (!items) return
    const imageFiles: File[] = []
    for (const item of Array.from(items)) {
      if (!item.type.startsWith('image/')) continue
      const file = item.getAsFile()
      if (file) imageFiles.push(file)
    }
    if (imageFiles.length === 0) return
    if (mode === 'text' || sourceKind === 'image-single') {
      void jobs.handleImportImage(imageFiles[0])
      return
    }
    batch.appendBatchFiles(imageFiles)
  }

  const handleImportFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    if (files.length > 0) {
      if (mode === 'text' || sourceKind === 'image-single') {
        void jobs.handleImportImage(files[0])
      } else {
        batch.appendBatchFiles(files)
      }
    }
    event.target.value = ''
  }

  return {
    importOpen: jobs.importOpen,
    setImportOpen: jobs.setImportOpen,
    importMode: mode,
    setImportMode,
    importSourceKind: sourceKind,
    setImportSourceKind,
    mindMapImportWorkflow: mindMapWorkflow,
    setMindMapImportWorkflow,
    importLoading: jobs.importLoading,
    importStreamPhase: jobs.importStreamPhase,
    importStreamStatusMessage: jobs.importStreamStatusMessage,
    importStreamStep: jobs.importStreamStep,
    importStreamTotalSteps: jobs.importStreamTotalSteps,
    importStreamPreviewText: jobs.importStreamPreviewText,
    importApplying: apply.applying,
    importUndoing: apply.undoing,
    importError: jobs.importError || controllerError,
    importSourceTree: jobs.importSourceTree,
    importPreviewEditorDoc: jobs.importPreviewEditorDoc,
    importExtractedText: jobs.importExtractedText,
    importImagePreviewUrl: jobs.importImagePreviewUrl,
    importHistory: jobs.importHistory,
    importHistoryJobs: jobs.importHistory,
    importBatchImages: batch.batchImages,
    importStructureImageId: batch.structureImageId,
    importBatchStatus: batch.batchStatus,
    importBatchMeta: batch.lastBatchMeta as BatchImportMeta | null,
    importCanAppend: Boolean(selectedNodeUid),
    importCanUndoLastImport: apply.canUndoLastImport,
    importExternalSyncKey: apply.externalSyncKey,
    importAppliedSyncVersion: apply.appliedSyncVersion,
    importWarnings: jobs.importWarnings,
    currentJobId: jobs.currentJobId,
    currentJobStatus: jobs.currentJobStatus,
    currentJobStage: jobs.currentJobStage,
    currentJobUsage: jobs.currentJobUsage,
    currentJobResolvedAi: jobs.currentJobResolvedAi,
    currentJobPauseRequested: jobs.currentJobPauseRequested,
    canResumeJob: jobs.canResumeJob,
    canPauseJob: jobs.canPauseJob,
    importReusedExistingResult: jobs.importReusedExistingResult,
    handleResumeJob: jobs.handleResumeJob,
    handlePauseJob: jobs.handlePauseJob,
    handleImportPaste,
    handleImportFileChange,
    handleBatchImportStart: () => void jobs.handleBatchImportStart(batch.structureImageId),
    handleDeleteBatchImage: batch.handleDeleteBatchImage,
    handleMoveBatchImage: batch.handleMoveBatchImage,
    handleSetStructureImage: batch.handleSetStructureImage,
    clearBatchQueue: batch.clearBatchQueue,
    handleImportApplyReplace: apply.handleApplyReplace,
    handleImportApplyAppend: apply.handleApplyAppend,
    handleImportSelectHistory: jobs.handleImportSelectHistory,
    handleImportDeleteHistory: jobs.handleImportDeleteHistory,
    handleUndoLastImport: apply.handleUndoLastImport,
    aiRunConfigDialog,
  }
}
