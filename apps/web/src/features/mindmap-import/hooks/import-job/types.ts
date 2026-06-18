import type { RefObject } from 'react'
import type {
  AiRuntimeOptions,
  MindMapEditorState,
  PdfImportOptions,
} from '@/shared/api/contracts'
import type {
  BatchImportMeta,
  BatchImportImageItem,
  ImportMode,
  ImportSourceKind,
  MindMapImportWorkflow,
} from '@/features/mindmap-import/model/mindmap-import-types'

export interface UseImportJobControllerOptions {
  entityKey: string | null
  mode: ImportMode
  sourceKind: ImportSourceKind
  setModeState: (mode: ImportMode) => void
  setSourceKindState: (sourceKind: ImportSourceKind) => void
  setMindMapWorkflowState: (workflow: MindMapImportWorkflow) => void
  batchImagesRef: RefObject<BatchImportImageItem[]>
  setBatchStatus: (status: 'idle' | 'ready' | 'loading' | 'success' | 'error') => void
  setLastBatchMeta: (value: BatchImportMeta | null) => void
  selectedPdfPages: number[]
  setSelectedPdfPages: (value: number[]) => void
  selectedSubjectDocumentId: number | null
  subjectDocuments: Array<{ id: number; original_name: string }>
  pdfPageMeta: Array<{ page_number: number; preview_url: string; thumbnail_url: string }>
  pdfImportMode: 'direct_generation' | 'structured_merge'
  setPdfImportModeState: (value: 'direct_generation' | 'structured_merge') => void
  structurePage: number | null
  setStructurePage: (value: number | null) => void
  analyzedPdfPages: number[]
  setAnalyzedPdfPages: (value: number[]) => void
  persistAnalyzedPdfPages: (documentId: number, pages: number[]) => void
  rangePrompt: string
  pdfImportOptions: PdfImportOptions
  promptForAiOptions: (request: {
    scenarioKey: string
    entrypointKey: string
    title: string
    description?: string
  }) => Promise<AiRuntimeOptions | undefined>
}

export interface ImportJobHydrateOptions {
  reused?: boolean
  preservePreviewUrl?: boolean
}

export type ImportPreviewEditorDoc = MindMapEditorState['editor_doc']
