import type { ChangeEvent, ClipboardEvent, ReactNode, RefObject } from 'react'
import type { PdfDocument, PdfOcrCoverage } from '@/modules/produce/domain/knowledge-import-entity/model'
import type {
  BatchImportImageItem,
  BatchImportMeta,
  ImportSourceKind,
  MindMapImportWorkflow,
} from '@/modules/produce/ui/mindmap-import/model/mindmap-import-types'
import type { ImportHistoryItem } from '@/modules/produce/ui/mindmap-import/model/mindmap-import'
import type {
  MindMapEditorState,
  MindMapImportJobError,
  MindMapImportJobResult,
  MindMapImportJobStage,
  MindMapImportJobStatus,
  MindMapImportJobUsage,
  MindMapReviewPreview,
  MindMapImportSourceTree,
  ResolvedAiRuntimeMeta,
} from '@/shared/api/contracts'

export interface MindMapImportDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'mindmap' | 'text'
  onModeChange: (mode: 'mindmap' | 'text') => void
  sourceKind: ImportSourceKind
  onSourceKindChange: (sourceKind: ImportSourceKind) => void
  onWorkflowChange: (workflow: MindMapImportWorkflow) => void
  loading: boolean
  streamPhase: string
  streamStatusMessage: string
  streamStep: number | null
  streamTotalSteps: number | null
  streamPreviewText: string
  applying: boolean
  undoing: boolean
  error: string
  sourceTree: MindMapImportSourceTree | null
  previewEditorDoc: MindMapEditorState['editor_doc']
  renderMindMapPreview: (editorState: MindMapEditorState, version: number) => ReactNode
  extractedText: string
  imagePreviewUrl: string
  batchImages: BatchImportImageItem[]
  batchStatus: 'idle' | 'ready' | 'loading' | 'success' | 'error'
  batchMeta: BatchImportMeta | null
  importWarnings: string[]
  reviewPreview?: MindMapReviewPreview | null
  currentJobId: string | null
  currentJobStatus: MindMapImportJobStatus | null
  currentJobStage: MindMapImportJobStage | null
  currentJobUsage: MindMapImportJobUsage | null
  currentJobError: MindMapImportJobError | null
  currentJobResolvedAi: ResolvedAiRuntimeMeta | null
  currentJobResult?: MindMapImportJobResult | null
  currentJobPauseRequested: boolean
  canResumeJob: boolean
  canPauseJob: boolean
  reusedExistingResult: boolean
  onResumeJob: () => void
  onPauseJob: () => void
  onRetryVision?: () => void
  onReformatFromOcr?: () => void
  targetNodeLabel: string
  canAppend: boolean
  canUndoLastImport: boolean
  history: ImportHistoryItem[]
  onPaste: (event: ClipboardEvent<HTMLDivElement>) => void
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void
  onBatchStart: () => void
  onBatchDeleteImage: (id: string) => void
  onBatchMoveImage: (id: string, direction: 'up' | 'down') => void
  pdfDocuments?: PdfDocument[]
  selectedPdfDocumentId?: string
  onSelectedPdfDocumentIdChange?: (documentId: string) => void
  pdfPageSelection?: string
  onPdfPageSelectionChange?: (value: string) => void
  pdfLibraryLoading?: boolean
  pdfOcrCoverage?: PdfOcrCoverage | null
  onPdfUpload?: (event: ChangeEvent<HTMLInputElement>) => void
  onPdfDelete?: (documentId: string) => void
  onPdfStart?: () => void
  manualImportText?: string
  onManualImportTextChange?: (value: string) => void
  manualImportFileName?: string
  manualImportFormatPrompt?: string
  onManualImportParse?: () => void
  onManualImportFileChange?: (event: ChangeEvent<HTMLInputElement>) => void
  onApplyReplace: () => void
  onApplyAppend: () => void
  onUndoLastImport: () => void
  onSelectHistory: (item: ImportHistoryItem) => void
  onDeleteHistory: (id: string) => void
  onRerunHistory?: (id: string) => void
  className?: string
  overlayClassName?: string
}

export type MindMapImportHistoryViewModel = Pick<
  MindMapImportDrawerProps,
  'history' | 'onDeleteHistory' | 'onSelectHistory' | 'onRerunHistory'
>

export type MindMapImportFooterModel = Pick<
  MindMapImportDrawerProps,
  | 'applying'
  | 'canAppend'
  | 'canUndoLastImport'
  | 'extractedText'
  | 'loading'
  | 'mode'
  | 'onApplyAppend'
  | 'onApplyReplace'
  | 'onUndoLastImport'
  | 'sourceTree'
  | 'targetNodeLabel'
  | 'undoing'
> & {
  onClose: () => void
}

export type MindMapImportResultsModel = Pick<
  MindMapImportDrawerProps,
  | 'batchMeta'
  | 'extractedText'
  | 'loading'
  | 'mode'
  | 'sourceKind'
  | 'sourceTree'
  | 'reviewPreview'
  | 'renderMindMapPreview'
  | 'currentJobResult'
  | 'onRetryVision'
  | 'onReformatFromOcr'
> & {
  hasStreamProgress: boolean
  onStreamPreviewScroll: () => void
  previewFrameVersion: number
  previewMindMapState: MindMapEditorState | null
  previewSectionRef: RefObject<HTMLElement | null>
  rawModelPreviewText: string
  resolvedPreviewImageUrl: string
  streamPreviewContentRef: RefObject<HTMLPreElement | null>
  streamStepLabel: string
}

export type MindMapImportSourceConfigModel = Pick<
  MindMapImportDrawerProps,
  | 'applying'
  | 'batchImages'
  | 'batchMeta'
  | 'batchStatus'
  | 'canPauseJob'
  | 'canResumeJob'
  | 'currentJobPauseRequested'
  | 'currentJobStage'
  | 'currentJobStatus'
  | 'currentJobError'
  | 'currentJobUsage'
  | 'error'
  | 'extractedText'
  | 'loading'
  | 'mode'
  | 'onBatchDeleteImage'
  | 'onBatchMoveImage'
  | 'onBatchStart'
  | 'onFileChange'
  | 'onPauseJob'
  | 'onResumeJob'
  | 'onSourceKindChange'
  | 'onWorkflowChange'
  | 'reusedExistingResult'
  | 'sourceKind'
  | 'sourceTree'
  | 'streamStatusMessage'
  | 'undoing'
  | 'pdfDocuments'
  | 'selectedPdfDocumentId'
  | 'onSelectedPdfDocumentIdChange'
  | 'pdfPageSelection'
  | 'onPdfPageSelectionChange'
  | 'pdfLibraryLoading'
  | 'pdfOcrCoverage'
  | 'onPdfUpload'
  | 'onPdfDelete'
  | 'onPdfStart'
  | 'manualImportText'
  | 'onManualImportTextChange'
  | 'manualImportFileName'
  | 'manualImportFormatPrompt'
  | 'onManualImportParse'
  | 'onManualImportFileChange'
> & {
  hasCurrentJob: boolean
  nodeCount: number
  normalizedStreamPhase: string
  streamStepLabel: string
  usageLabel: string
}
