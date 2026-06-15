import { useCallback, useState, type ChangeEvent, type ClipboardEvent } from 'react'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { useImportApplyController } from '@/features/palace-edit/hooks/useImportApplyController'
import { useImportBatchState } from '@/features/palace-edit/hooks/useImportBatchState'
import { useImportJobController } from '@/features/palace-edit/hooks/useImportJobController'
import { usePdfImportController } from '@/features/palace-edit/hooks/usePdfImportController'
import { useAiRunConfigDialog } from '@/features/ai-config/useAiRunConfigDialog'
import type {
  BatchImportMeta,
  ImportApplyContext,
  ImportMode,
  ImportSourceKind,
  ImportSubjectOption,
  MindMapImportWorkflow,
} from '@/features/palace-edit/model/mindmap-import-types'

interface UseMindMapImportOptions {
  entityKey: string | null
  editorState: MindMapEditorState | null
  setEditorState: (nextState: MindMapEditorState) => void
  applyEditorState?: (nextState: MindMapEditorState, context?: ImportApplyContext) => Promise<void> | void
  selectedNodeUid?: string | null
  subjectOptions?: ImportSubjectOption[]
  defaultSubjectId?: number | null
}

export type {
  BatchImportImageItem,
  ImportApplyContext,
  ImportMode,
  ImportSourceKind,
  ImportSubjectOption,
  MindMapImportWorkflow,
} from '@/features/palace-edit/model/mindmap-import-types'

export function useMindMapImport({
  entityKey,
  editorState,
  setEditorState,
  applyEditorState,
  selectedNodeUid = null,
  subjectOptions = [],
  defaultSubjectId = null,
}: UseMindMapImportOptions) {
  const [controllerError, setControllerError] = useState('')
  const [mode, setModeState] = useState<ImportMode>('mindmap')
  const [sourceKind, setSourceKindState] = useState<ImportSourceKind>('image-single')
  const [mindMapWorkflow, setMindMapWorkflowState] = useState<MindMapImportWorkflow>('single')

  const batch = useImportBatchState(setControllerError)
  const { promptForAiOptions, aiRunConfigDialog } = useAiRunConfigDialog()
  const pdf = usePdfImportController({
    entityKey,
    subjectOptions,
    defaultSubjectId,
    setError: setControllerError,
  })

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
    selectedPdfPages: pdf.selectedPdfPages,
    setSelectedPdfPages: pdf.setSelectedPdfPages,
    selectedSubjectDocumentId: pdf.selectedSubjectDocumentId,
    subjectDocuments: pdf.subjectDocuments,
    pdfPageMeta: pdf.pdfPageMeta,
    pdfImportMode: pdf.pdfImportMode,
    setPdfImportModeState: pdf.setPdfImportModeState,
    structurePage: pdf.structurePage,
    setStructurePage: pdf.setStructurePage,
    analyzedPdfPages: pdf.analyzedPdfPages,
    setAnalyzedPdfPages: pdf.setAnalyzedPdfPages,
    persistAnalyzedPdfPages: pdf.persistAnalyzedPdfPages,
    rangePrompt: pdf.rangePrompt,
    pdfImportOptions: pdf.pdfImportOptions,
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
    if (sourceKind === 'subject-pdf') return
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
    if (sourceKind === 'subject-pdf') {
      event.target.value = ''
      return
    }
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
    importSubjectOptions: subjectOptions,
    importSelectedSubjectId: pdf.selectedSubjectId,
    setImportSelectedSubjectId: pdf.setSelectedSubjectId,
    importSubjectDocuments: pdf.subjectDocuments,
    importSubjectDocumentsLoading: pdf.subjectDocumentsLoading,
    importSelectedSubjectDocumentId: pdf.selectedSubjectDocumentId,
    setImportSelectedSubjectDocumentId: pdf.setSelectedSubjectDocumentId,
    importPdfPageMeta: pdf.pdfPageMeta,
    importPdfPagesLoading: pdf.pdfPagesLoading,
    importPdfPages: pdf.selectedPdfPages,
    importPdfPageInput: pdf.pdfPageInput,
    setImportPdfPageInput: pdf.setPdfPageInput,
    importPdfSelectionError: pdf.pdfSelectionError,
    importPdfMode: pdf.pdfImportMode,
    setImportPdfMode: pdf.setPdfImportMode,
    importStructurePage: pdf.structurePage,
    setImportStructurePage: pdf.setStructurePage,
    importPdfPreviewPage: pdf.pdfPreviewPage,
    setImportPdfPreviewPage: pdf.setPdfPreviewPage,
    importAnalyzedPdfPages: pdf.analyzedPdfPages,
    importRangePrompt: pdf.rangePrompt,
    setImportRangePrompt: pdf.setRangePrompt,
    importPdfOptions: pdf.pdfImportOptions,
    setImportPdfOption: pdf.setImportPdfOption,
    importWarnings: jobs.importWarnings,
    importPdfOcrGroundingUsed: jobs.importPdfOcrGroundingUsed,
    importPdfOcrTextChars: jobs.importPdfOcrTextChars,
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
    handleSubjectDocumentUpload: pdf.handleSubjectDocumentUpload,
    handleSubjectDocumentDelete: pdf.handleSubjectDocumentDelete,
    refreshSubjectDocuments: pdf.refreshSubjectDocuments,
    toggleImportPdfPage: pdf.togglePdfPage,
    handleImportPaste,
    handleImportFileChange,
    handleBatchImportStart: () => void jobs.handleBatchImportStart(batch.structureImageId),
    handlePdfImportStart: jobs.handlePdfImportStart,
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
