import type { ChangeEvent, ClipboardEvent, RefObject } from 'react'
import type {
  BatchImportMeta,
  BatchImportImageItem,
  ImportSourceKind,
  MindMapImportWorkflow,
} from '@/features/palace-edit/model/mindmap-import-types'
import type { ImportSubjectOption } from '@/entities/knowledge-import/model'
import type { ImportHistoryItem } from '@/features/palace-edit/model/mindmap-import'
import type {
  MindMapEditorState,
  MindMapImportJobStage,
  MindMapImportJobStatus,
  MindMapImportJobUsage,
  MindMapImportSourceTree,
  PdfImportMode,
  PdfImportOptions,
  PdfPageSummary,
  ResolvedAiRuntimeMeta,
  SubjectDocumentSummary,
} from '@/shared/api/contracts'

export interface PalaceMindMapImportDrawerProps {
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
  extractedText: string
  imagePreviewUrl: string
  batchImages: BatchImportImageItem[]
  structureImageId: string | null
  batchStatus: 'idle' | 'ready' | 'loading' | 'success' | 'error'
  batchMeta: BatchImportMeta | null
  subjectOptions: ImportSubjectOption[]
  selectedSubjectId: number | null
  onSelectedSubjectIdChange: (subjectId: number | null) => void
  subjectDocuments: SubjectDocumentSummary[]
  subjectDocumentsLoading: boolean
  selectedSubjectDocumentId: number | null
  onSelectedSubjectDocumentIdChange: (documentId: number | null) => void
  pdfPageMeta: PdfPageSummary[]
  pdfPagesLoading: boolean
  selectedPdfPages: number[]
  pdfPageInput: string
  onPdfPageInputChange: (value: string) => void
  pdfSelectionError: string
  pdfImportMode: PdfImportMode
  onPdfImportModeChange: (mode: PdfImportMode) => void
  structurePage: number | null
  onStructurePageChange: (pageNumber: number | null) => void
  pdfPreviewPage: number | null
  onPdfPreviewPageChange: (pageNumber: number | null) => void
  analyzedPdfPages: number[]
  rangePrompt: string
  onRangePromptChange: (value: string) => void
  pdfImportOptions: PdfImportOptions
  onPdfImportOptionChange: (key: keyof PdfImportOptions, value: boolean) => void
  importWarnings: string[]
  pdfOcrGroundingUsed: boolean | null
  pdfOcrTextChars: number | null
  currentJobId: string | null
  currentJobStatus: MindMapImportJobStatus | null
  currentJobStage: MindMapImportJobStage | null
  currentJobUsage: MindMapImportJobUsage | null
  currentJobResolvedAi: ResolvedAiRuntimeMeta | null
  currentJobPauseRequested: boolean
  canResumeJob: boolean
  canPauseJob: boolean
  reusedExistingResult: boolean
  onResumeJob: () => void
  onPauseJob: () => void
  onTogglePdfPage: (pageNumber: number) => void
  onPdfStart: () => void
  targetNodeLabel: string
  canAppend: boolean
  canUndoLastImport: boolean
  history: ImportHistoryItem[]
  onPaste: (event: ClipboardEvent<HTMLDivElement>) => void
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void
  onBatchStart: () => void
  onBatchDeleteImage: (id: string) => void
  onBatchMoveImage: (id: string, direction: 'up' | 'down') => void
  onBatchSetStructureImage: (id: string) => void
  onApplyReplace: () => void
  onApplyAppend: () => void
  onUndoLastImport: () => void
  onSelectHistory: (item: ImportHistoryItem) => void
  onDeleteHistory: (id: string) => void
  className?: string
  overlayClassName?: string
}

export type PalaceImportHistoryViewModel = Pick<
  PalaceMindMapImportDrawerProps,
  'history' | 'onDeleteHistory' | 'onSelectHistory'
>

export type PalaceImportPdfSidebarModel = Pick<
  PalaceMindMapImportDrawerProps,
  | 'analyzedPdfPages'
  | 'onPdfPreviewPageChange'
  | 'onStructurePageChange'
  | 'onTogglePdfPage'
  | 'pdfImportMode'
  | 'pdfPageMeta'
  | 'pdfPagesLoading'
  | 'pdfPreviewPage'
  | 'selectedPdfPages'
  | 'sourceKind'
  | 'structurePage'
>

export type PalaceImportFooterModel = Pick<
  PalaceMindMapImportDrawerProps,
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

export type PalaceImportResultsModel = Pick<
  PalaceMindMapImportDrawerProps,
  | 'batchMeta'
  | 'extractedText'
  | 'importWarnings'
  | 'loading'
  | 'mode'
  | 'pdfImportMode'
  | 'selectedPdfPages'
  | 'sourceKind'
  | 'sourceTree'
  | 'structurePage'
> & {
  hasStreamProgress: boolean
  onStreamPreviewScroll: () => void
  pdfModeLabel: string
  pdfOcrStatusLabel: string
  pdfPageSummary: string
  previewFrameVersion: number
  previewMindMapState: MindMapEditorState | null
  previewSectionRef: RefObject<HTMLElement | null>
  rawModelPreviewText: string
  resolvedPreviewImageUrl: string
  streamPreviewContentRef: RefObject<HTMLPreElement | null>
  streamStepLabel: string
}

export type PalaceImportSourceConfigModel = Pick<
  PalaceMindMapImportDrawerProps,
  | 'applying'
  | 'batchImages'
  | 'batchMeta'
  | 'batchStatus'
  | 'canPauseJob'
  | 'canResumeJob'
  | 'currentJobPauseRequested'
  | 'currentJobStage'
  | 'currentJobStatus'
  | 'currentJobUsage'
  | 'error'
  | 'extractedText'
  | 'importWarnings'
  | 'loading'
  | 'mode'
  | 'onBatchDeleteImage'
  | 'onBatchMoveImage'
  | 'onBatchSetStructureImage'
  | 'onBatchStart'
  | 'onFileChange'
  | 'onPauseJob'
  | 'onPdfImportModeChange'
  | 'onPdfImportOptionChange'
  | 'onPdfPageInputChange'
  | 'onPdfStart'
  | 'onRangePromptChange'
  | 'onResumeJob'
  | 'onSelectedSubjectDocumentIdChange'
  | 'onSelectedSubjectIdChange'
  | 'onSourceKindChange'
  | 'onWorkflowChange'
  | 'pdfImportMode'
  | 'pdfImportOptions'
  | 'pdfPageInput'
  | 'pdfSelectionError'
  | 'rangePrompt'
  | 'reusedExistingResult'
  | 'selectedSubjectDocumentId'
  | 'selectedSubjectId'
  | 'sourceKind'
  | 'sourceTree'
  | 'structureImageId'
  | 'structurePage'
  | 'subjectDocuments'
  | 'subjectDocumentsLoading'
  | 'subjectOptions'
  | 'streamStatusMessage'
  | 'undoing'
> & {
  canStartPdfImport: boolean
  hasCurrentJob: boolean
  nodeCount: number
  normalizedStreamPhase: string
  selectedPdfPageCount: number
  streamStepLabel: string
  usageLabel: string
}
