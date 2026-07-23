import { useEffect, useRef, useState } from 'react'
import type {
  MindMapEditorState,
  MindMapImportJob,
  MindMapImportJobError,
  MindMapImportJobResult,
  MindMapImportJobStage,
  MindMapImportJobStatus,
  MindMapImportJobUsage,
  MindMapReviewPreview,
  MindMapImportSourceTree,
  ResolvedAiRuntimeMeta,
} from '@/shared/api/contracts'
import {
  buildEditorDocFromSourceTree,
  type ImportHistoryItem,
} from '@/modules/produce/ui/mindmap-import/model/mindmap-import'
import {
  describeJobProgress,
  persistLastJobId,
} from '@/modules/produce/ui/mindmap-import/hooks/mindmap-import-utils'
import type { ImportJobHydrateOptions, UseImportJobControllerOptions } from '@/modules/produce/ui/mindmap-import/hooks/import-job/types'

export interface ImportJobStateController {
  importOpen: boolean
  setImportOpenState: (value: boolean) => void
  importLoading: boolean
  setImportLoading: (value: boolean) => void
  importStreamPhase: string
  importStreamStatusMessage: string
  importStreamStep: number | null
  importStreamTotalSteps: number | null
  importStreamPreviewText: string
  importError: string
  setImportError: (value: string) => void
  importSourceTree: MindMapImportSourceTree | null
  importPreviewEditorDoc: MindMapEditorState['editor_doc']
  importExtractedText: string
  importImagePreviewUrl: string
  setImportImagePreviewUrl: (value: string) => void
  importHistory: ImportHistoryItem[]
  setImportHistory: (value: ImportHistoryItem[]) => void
  importWarnings: string[]
  setImportWarnings: (value: string[]) => void
  importReviewPreview: MindMapReviewPreview | null
  currentJobId: string | null
  currentJobStatus: MindMapImportJobStatus | null
  currentJobStage: MindMapImportJobStage | null
  currentJobUsage: MindMapImportJobUsage | null
  currentJobError: MindMapImportJobError | null
  currentJobResolvedAi: ResolvedAiRuntimeMeta | null
  currentJobResult: MindMapImportJobResult | null
  currentJobPauseRequested: boolean
  importReusedExistingResult: boolean
  reusedExistingResultRef: React.MutableRefObject<boolean>
  setImportReusedExistingResult: (value: boolean) => void
  resetStreamState: () => void
  clearCurrentJobState: () => void
  applyJobProgressState: (job: MindMapImportJob | null) => void
  hydrateJobResult: (job: MindMapImportJob, options?: ImportJobHydrateOptions) => void
  applyManualImportResult: (payload: {
    sourceTree: MindMapImportSourceTree
    editorDoc: MindMapEditorState['editor_doc']
    warnings?: string[]
  }) => void
  clearPreviewState: () => void
}

export function useImportJobState({
  entityKey,
  setModeState,
  setSourceKindState,
  setMindMapWorkflowState,
  batchImagesRef,
  setBatchStatus,
  setLastBatchMeta,
}: UseImportJobControllerOptions): ImportJobStateController {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [streamPhase, setStreamPhase] = useState('')
  const [streamStatusMessage, setStreamStatusMessage] = useState('')
  const [streamStep, setStreamStep] = useState<number | null>(null)
  const [streamTotalSteps, setStreamTotalSteps] = useState<number | null>(null)
  const [streamPreviewText, setStreamPreviewText] = useState('')
  const [error, setError] = useState('')
  const [sourceTree, setSourceTree] = useState<MindMapImportSourceTree | null>(null)
  const [importEditorDoc, setImportEditorDoc] = useState<MindMapEditorState['editor_doc']>(null)
  const [extractedText, setExtractedText] = useState('')
  const [imagePreviewUrl, setImagePreviewUrl] = useState('')
  const [history, setHistory] = useState<ImportHistoryItem[]>([])
  const [importWarnings, setImportWarnings] = useState<string[]>([])
  const [reviewPreview, setReviewPreview] = useState<MindMapReviewPreview | null>(null)
  const [currentJobId, setCurrentJobId] = useState<string | null>(null)
  const [currentJobStatus, setCurrentJobStatus] = useState<MindMapImportJobStatus | null>(null)
  const [currentJobStage, setCurrentJobStage] = useState<MindMapImportJobStage | null>(null)
  const [currentJobUsage, setCurrentJobUsage] = useState<MindMapImportJobUsage | null>(null)
  const [currentJobError, setCurrentJobError] = useState<MindMapImportJobError | null>(null)
  const [currentJobResolvedAi, setCurrentJobResolvedAi] = useState<ResolvedAiRuntimeMeta | null>(null)
  const [currentJobResult, setCurrentJobResult] = useState<MindMapImportJobResult | null>(null)
  const [currentJobPauseRequested, setCurrentJobPauseRequested] = useState(false)
  const [reusedExistingResult, setReusedExistingResultState] = useState(false)
  const reusedExistingResultRef = useRef(false)
  const imagePreviewUrlRef = useRef('')

  useEffect(() => {
    persistLastJobId(entityKey, currentJobId)
  }, [currentJobId, entityKey])

  useEffect(() => {
    imagePreviewUrlRef.current = imagePreviewUrl
  }, [imagePreviewUrl])

  const setImportReusedExistingResult = (value: boolean) => {
    reusedExistingResultRef.current = value
    setReusedExistingResultState(value)
  }

  const resetStreamState = () => {
    setStreamPhase('')
    setStreamStatusMessage('')
    setStreamStep(null)
    setStreamTotalSteps(null)
    setStreamPreviewText('')
  }

  const clearCurrentJobState = () => {
    setCurrentJobId(null)
    setCurrentJobStatus(null)
    setCurrentJobStage(null)
    setCurrentJobUsage(null)
    setCurrentJobError(null)
    setCurrentJobResolvedAi(null)
    setCurrentJobResult(null)
    setCurrentJobPauseRequested(false)
  }

  const applyJobProgressState = (job: MindMapImportJob | null) => {
    const progress = describeJobProgress(job)
    setStreamPhase(progress.phase)
    setStreamStatusMessage(progress.message)
    setStreamStep(progress.step)
    setStreamTotalSteps(progress.total)
    setStreamPreviewText(job?.progress?.preview_text || '')
    setLoading(Boolean(job && (job.status === 'running' || job.pause_requested)))
  }

  const hydrateJobResult = (
    job: MindMapImportJob,
    options?: ImportJobHydrateOptions,
  ) => {
    const result = job.result || null
    setCurrentJobId(job.id)
    setCurrentJobStatus(job.status)
    setCurrentJobStage(job.stage)
    setCurrentJobUsage(job.usage ?? null)
    setCurrentJobError(job.error ?? null)
    setCurrentJobResolvedAi(job.vision_resolved_ai ?? job.resolved_ai ?? null)
    setCurrentJobResult(result)
    setCurrentJobPauseRequested(Boolean(job.pause_requested))
    setImportReusedExistingResult(Boolean(options?.reused))
    setModeState(job.mode)
    setSourceKindState(job.source_kind)
    setMindMapWorkflowState(job.source_kind === 'image-batch' ? 'batch' : 'single')
    setImportWarnings(result?.warnings || [])
    setReviewPreview(result?.review_preview ?? null)
    setError(job.error?.message || '')
    applyJobProgressState(job)

    if (job.source_kind === 'image-batch') {
      setBatchStatus(
        job.status === 'running'
          ? 'loading'
          : result?.source_tree
            ? 'success'
            : batchImagesRef.current.length > 0
              ? 'ready'
              : 'idle',
      )
      setLastBatchMeta(
        result?.image_count
          ? {
              imageCount: result.image_count,
            }
          : batchImagesRef.current.length > 0
            ? { imageCount: batchImagesRef.current.length }
            : null,
      )
      if (result?.source_tree) {
        const previewItem = batchImagesRef.current[0]
        if (previewItem?.previewUrl) {
          setImagePreviewUrl(previewItem.previewUrl)
        } else if (!options?.preservePreviewUrl) {
          setImagePreviewUrl('')
        }
      }
    } else if (job.source_kind === 'image-single' && !options?.preservePreviewUrl) {
      if (!imagePreviewUrlRef.current) {
        setImagePreviewUrl('')
      }
    }

    if (result?.source_tree) {
      setSourceTree(result.source_tree)
      setImportEditorDoc(result.editor_doc ?? buildEditorDocFromSourceTree(result.source_tree))
    } else if (job.mode === 'mindmap') {
      setSourceTree(null)
      setImportEditorDoc(null)
    }

    if (typeof result?.extracted_text === 'string') {
      setExtractedText(result.extracted_text)
    } else if (job.mode === 'text') {
      setExtractedText('')
    }
  }

  const clearPreviewState = () => {
    clearCurrentJobState()
    setSourceTree(null)
    setImportEditorDoc(null)
    setExtractedText('')
    setImagePreviewUrl('')
    setError('')
    setImportWarnings([])
    setReviewPreview(null)
    setImportReusedExistingResult(false)
    setLastBatchMeta(null)
    resetStreamState()
  }

  const applyManualImportResult = (payload: {
    sourceTree: MindMapImportSourceTree
    editorDoc: MindMapEditorState['editor_doc']
    warnings?: string[]
  }) => {
    clearCurrentJobState()
    resetStreamState()
    setLoading(false)
    setSourceTree(payload.sourceTree)
    setImportEditorDoc(payload.editorDoc)
    setExtractedText('')
    setImagePreviewUrl('')
    setError('')
    setImportWarnings(payload.warnings ?? [])
    setReviewPreview(null)
    setImportReusedExistingResult(false)
    setLastBatchMeta(null)
    setSourceKindState('manual-json')
    setModeState('mindmap')
  }

  return {
    importOpen: open,
    setImportOpenState: setOpen,
    importLoading: loading,
    setImportLoading: setLoading,
    importStreamPhase: streamPhase,
    importStreamStatusMessage: streamStatusMessage,
    importStreamStep: streamStep,
    importStreamTotalSteps: streamTotalSteps,
    importStreamPreviewText: streamPreviewText,
    importError: error,
    setImportError: setError,
    importSourceTree: sourceTree,
    importPreviewEditorDoc: importEditorDoc,
    importExtractedText: extractedText,
    importImagePreviewUrl: imagePreviewUrl,
    setImportImagePreviewUrl: setImagePreviewUrl,
    importHistory: history,
    setImportHistory: setHistory,
    importWarnings,
    setImportWarnings,
    importReviewPreview: reviewPreview,
    currentJobId,
    currentJobStatus,
    currentJobStage,
    currentJobUsage,
    currentJobError,
    currentJobResolvedAi,
    currentJobResult,
    currentJobPauseRequested,
    importReusedExistingResult: reusedExistingResult,
    reusedExistingResultRef,
    setImportReusedExistingResult,
    resetStreamState,
    clearCurrentJobState,
    applyJobProgressState,
    hydrateJobResult,
    applyManualImportResult,
    clearPreviewState,
  }
}
