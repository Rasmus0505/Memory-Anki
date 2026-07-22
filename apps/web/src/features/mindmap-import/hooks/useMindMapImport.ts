import { useState, type ChangeEvent, type ClipboardEvent } from 'react'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { useCallback, useEffect } from 'react'
import type { ImportApplyContext } from '@/shared/api/contracts/imports'
import { useImportApplyController } from '@/features/mindmap-import/hooks/useImportApplyController'
import { useImportBatchState } from '@/features/mindmap-import/hooks/useImportBatchState'
import { useImportJobController } from '@/features/mindmap-import/hooks/useImportJobController'
import { useAiRunConfigDialog } from '@/entities/ai-runtime'
import {
  deletePdfDocumentApi,
  getPdfOcrCoverageApi,
  listPdfDocumentsApi,
  uploadPdfDocumentApi,
} from '@/entities/knowledge-import/api'
import type { PdfDocument, PdfOcrCoverage } from '@/entities/knowledge-import/model'
import type {
  BatchImportMeta,
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
  const [sourceKind, setSourceKindState] = useState<ImportSourceKind>('image-batch')
  const [mindMapWorkflow, setMindMapWorkflowState] = useState<MindMapImportWorkflow>('batch')
  const [pdfDocuments, setPdfDocuments] = useState<PdfDocument[]>([])
  const [selectedPdfDocumentId, setSelectedPdfDocumentId] = useState('')
  const [pdfPageSelection, setPdfPageSelection] = useState('1')
  const [pdfLibraryLoading, setPdfLibraryLoading] = useState(false)
  const [pdfOcrCoverage, setPdfOcrCoverage] = useState<PdfOcrCoverage | null>(null)

  const batch = useImportBatchState(setControllerError)
  const { promptForAiOptions, promptForScenarioAiOptions, aiRunConfigDialog } = useAiRunConfigDialog()
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
    promptForScenarioAiOptions,
    contextOptions: editorState
      ? [{
          id: 'mindmap',
          label: '包含当前思维导图',
          description: '将当前脑图结构作为只读提示词快照，默认不勾选。',
          content: JSON.stringify(editorState.editor_doc),
        }]
      : [],
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

  const refreshPdfDocuments = useCallback(async () => {
    setPdfLibraryLoading(true)
    try {
      const result = await listPdfDocumentsApi()
      setPdfDocuments(result.items)
      setSelectedPdfDocumentId((current) =>
        current && result.items.some((item) => item.id === current)
          ? current
          : result.items[0]?.id ?? '',
      )
    } catch {
      setPdfDocuments([])
      setSelectedPdfDocumentId('')
    } finally {
      setPdfLibraryLoading(false)
    }
  }, [])

  useEffect(() => {
    if (jobs.importOpen) void refreshPdfDocuments()
  }, [jobs.importOpen, refreshPdfDocuments])

  useEffect(() => {
    if (!jobs.importOpen || !selectedPdfDocumentId) {
      setPdfOcrCoverage(null)
      return
    }
    let cancelled = false
    void getPdfOcrCoverageApi(selectedPdfDocumentId)
      .then((coverage) => {
        if (!cancelled) setPdfOcrCoverage(coverage)
      })
      .catch(() => {
        if (!cancelled) setPdfOcrCoverage(null)
      })
    return () => {
      cancelled = true
    }
  }, [jobs.importOpen, selectedPdfDocumentId, jobs.currentJobStatus])

  const setImportMode = (nextMode: ImportMode) => {
    setModeState(nextMode)
    setControllerError('')
    jobs.setImportError('')
  }

  const setImportSourceKind = (nextSourceKind: ImportSourceKind) => {
    setSourceKindState(nextSourceKind)
    if (nextSourceKind === 'image-batch') {
      setMindMapWorkflowState('batch')
    }
    setControllerError('')
    jobs.setImportError('')
  }

  const setMindMapImportWorkflow = (workflow: MindMapImportWorkflow) => {
    setMindMapWorkflowState(workflow)
    setSourceKindState('image-batch')
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
    if (sourceKind === 'pdf-document') return
    batch.appendBatchFiles(imageFiles)
  }

  const handleImportFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    if (files.length > 0) {
      batch.appendBatchFiles(files)
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
    importBatchStatus: batch.batchStatus,
    importBatchMeta: batch.lastBatchMeta as BatchImportMeta | null,
    pdfDocuments,
    selectedPdfDocumentId,
    setSelectedPdfDocumentId,
    pdfPageSelection,
    setPdfPageSelection,
    pdfLibraryLoading,
    pdfOcrCoverage,
    importCanAppend: Boolean(selectedNodeUid),
    importCanUndoLastImport: apply.canUndoLastImport,
    importExternalSyncKey: apply.externalSyncKey,
    importAppliedSyncVersion: apply.appliedSyncVersion,
    importWarnings: jobs.importWarnings,
    importReviewPreview: jobs.importReviewPreview,
    currentJobId: jobs.currentJobId,
    currentJobStatus: jobs.currentJobStatus,
    currentJobStage: jobs.currentJobStage,
    currentJobUsage: jobs.currentJobUsage,
    currentJobError: jobs.currentJobError,
    currentJobResolvedAi: jobs.currentJobResolvedAi,
    currentJobResult: jobs.currentJobResult,
    currentJobPauseRequested: jobs.currentJobPauseRequested,
    canResumeJob: jobs.canResumeJob,
    canPauseJob: jobs.canPauseJob,
    importReusedExistingResult: jobs.importReusedExistingResult,
    handleResumeJob: jobs.handleResumeJob,
    handlePauseJob: jobs.handlePauseJob,
    handleRetryVision: jobs.handleRetryVision,
    handleReformatFromOcr: jobs.handleReformatFromOcr,
    handleImportPaste,
    handleImportFileChange,
    handleBatchImportStart: () => void jobs.handleBatchImportStart(),
    handlePdfImportStart: () => void jobs.handlePdfImportStart(selectedPdfDocumentId, pdfPageSelection),
    handlePdfUpload: async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      const document = await uploadPdfDocumentApi(file)
      await refreshPdfDocuments()
      setSelectedPdfDocumentId(document.id)
      setPdfPageSelection(document.page_count > 1 ? `1-${document.page_count}` : '1')
    },
    handlePdfDelete: async (documentId: string) => {
      await deletePdfDocumentApi(documentId)
      await refreshPdfDocuments()
    },
    handleDeleteBatchImage: batch.handleDeleteBatchImage,
    handleMoveBatchImage: batch.handleMoveBatchImage,
    clearBatchQueue: batch.clearBatchQueue,
    handleImportApplyReplace: apply.handleApplyReplace,
    handleImportApplyAppend: apply.handleApplyAppend,
    handleImportSelectHistory: jobs.handleImportSelectHistory,
    handleImportDeleteHistory: jobs.handleImportDeleteHistory,
    handleImportRerunHistory: jobs.handleImportRerunHistory,
    handleUndoLastImport: apply.handleUndoLastImport,
    aiRunConfigDialog,
  }
}
