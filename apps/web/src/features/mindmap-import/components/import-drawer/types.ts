import type { ChangeEvent, ClipboardEvent, RefObject } from 'react'
import type {
  BatchImportImageItem,
  BatchImportMeta,
  ImportSourceKind,
  MindMapImportWorkflow,
} from '@/features/mindmap-import/model/mindmap-import-types'
import type { ImportHistoryItem } from '@/features/mindmap-import/model/mindmap-import'
import type {
  MindMapEditorState,
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
  extractedText: string
  imagePreviewUrl: string
  batchImages: BatchImportImageItem[]
  structureImageId: string | null
  batchStatus: 'idle' | 'ready' | 'loading' | 'success' | 'error'
  batchMeta: BatchImportMeta | null
  importWarnings: string[]
  reviewPreview?: MindMapReviewPreview | null
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

export type MindMapImportHistoryViewModel = Pick<
  MindMapImportDrawerProps,
  'history' | 'onDeleteHistory' | 'onSelectHistory'
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
  | 'currentJobUsage'
  | 'error'
  | 'extractedText'
  | 'loading'
  | 'mode'
  | 'onBatchDeleteImage'
  | 'onBatchMoveImage'
  | 'onBatchSetStructureImage'
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
  | 'structureImageId'
  | 'undoing'
> & {
  hasCurrentJob: boolean
  nodeCount: number
  normalizedStreamPhase: string
  streamStepLabel: string
  usageLabel: string
}
