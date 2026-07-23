import { buildImportJobActions } from '@/modules/produce/ui/mindmap-import/hooks/import-job/actions'
import type { UseImportJobControllerOptions } from '@/modules/produce/ui/mindmap-import/hooks/import-job/types'
import { useImportJobRuntime } from '@/modules/produce/ui/mindmap-import/hooks/import-job/useImportJobRuntime'
import { useImportJobState } from '@/modules/produce/ui/mindmap-import/hooks/import-job/useImportJobState'

export function useImportJobController(options: UseImportJobControllerOptions) {
  const state = useImportJobState(options)
  const runtime = useImportJobRuntime({
    entityKey: options.entityKey,
    state,
  })
  const actions = buildImportJobActions({
    options,
    state,
    runtime,
  })

  return {
    importOpen: state.importOpen,
    setImportOpen: runtime.handleOpenChange,
    importLoading: state.importLoading,
    importStreamPhase: state.importStreamPhase,
    importStreamStatusMessage: state.importStreamStatusMessage,
    importStreamStep: state.importStreamStep,
    importStreamTotalSteps: state.importStreamTotalSteps,
    importStreamPreviewText: state.importStreamPreviewText,
    importError: state.importError,
    setImportError: state.setImportError,
    importSourceTree: state.importSourceTree,
    importPreviewEditorDoc: state.importPreviewEditorDoc,
    importExtractedText: state.importExtractedText,
    importImagePreviewUrl: state.importImagePreviewUrl,
    importHistory: state.importHistory,
    importWarnings: state.importWarnings,
    importReviewPreview: state.importReviewPreview,
    currentJobId: state.currentJobId,
    currentJobStatus: state.currentJobStatus,
    currentJobStage: state.currentJobStage,
    currentJobUsage: state.currentJobUsage,
    currentJobError: state.currentJobError,
    currentJobResolvedAi: state.currentJobResolvedAi,
    currentJobResult: state.currentJobResult,
    currentJobPauseRequested: state.currentJobPauseRequested,
    importReusedExistingResult: state.importReusedExistingResult,
    applyManualImportResult: state.applyManualImportResult,
    clearPreviewState: state.clearPreviewState,
    ...actions,
    handleResumeJob: runtime.handleResumeJob,
    handlePauseJob: runtime.handlePauseJob,
    handleImportSelectHistory: runtime.handleImportSelectHistory,
    handleImportDeleteHistory: runtime.handleImportDeleteHistory,
    handleImportRerunHistory: runtime.handleImportRerunHistory,
    handleRetryVision: runtime.handleRetryVision,
    handleReformatFromOcr: runtime.handleReformatFromOcr,
    canResumeJob: Boolean(
      state.currentJobId &&
        state.currentJobStatus &&
        state.currentJobStatus !== 'completed' &&
        state.currentJobStatus !== 'running',
    ),
    canPauseJob: Boolean(state.currentJobId && state.currentJobStatus === 'running'),
  }
}
