import { buildImportJobActions } from '@/features/palace-edit/hooks/import-job/actions'
import type { UseImportJobControllerOptions } from '@/features/palace-edit/hooks/import-job/types'
import { useImportJobRuntime } from '@/features/palace-edit/hooks/import-job/useImportJobRuntime'
import { useImportJobState } from '@/features/palace-edit/hooks/import-job/useImportJobState'

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
    importPdfOcrGroundingUsed: state.importPdfOcrGroundingUsed,
    importPdfOcrTextChars: state.importPdfOcrTextChars,
    currentJobId: state.currentJobId,
    currentJobStatus: state.currentJobStatus,
    currentJobStage: state.currentJobStage,
    currentJobUsage: state.currentJobUsage,
    currentJobResolvedAi: state.currentJobResolvedAi,
    currentJobPauseRequested: state.currentJobPauseRequested,
    importReusedExistingResult: state.importReusedExistingResult,
    ...actions,
    handleResumeJob: runtime.handleResumeJob,
    handlePauseJob: runtime.handlePauseJob,
    handleImportSelectHistory: runtime.handleImportSelectHistory,
    handleImportDeleteHistory: runtime.handleImportDeleteHistory,
    canResumeJob: Boolean(
      state.currentJobId &&
        state.currentJobStatus &&
        state.currentJobStatus !== 'completed' &&
        state.currentJobStatus !== 'running',
    ),
    canPauseJob: Boolean(state.currentJobId && state.currentJobStatus === 'running'),
  }
}
