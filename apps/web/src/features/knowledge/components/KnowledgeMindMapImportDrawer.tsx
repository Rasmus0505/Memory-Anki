import { MindMapImportDrawer, useMindMapImport } from '@/features/mindmap-import'

interface KnowledgeMindMapImportDrawerProps {
  mindMapImport: ReturnType<typeof useMindMapImport>
  targetNodeLabel: string
}

export function KnowledgeMindMapImportDrawer({
  mindMapImport,
  targetNodeLabel,
}: KnowledgeMindMapImportDrawerProps) {
  return (
    <MindMapImportDrawer
      open={mindMapImport.importOpen}
      onOpenChange={mindMapImport.setImportOpen}
      mode={mindMapImport.importMode}
      onModeChange={mindMapImport.setImportMode}
      sourceKind={mindMapImport.importSourceKind}
      onSourceKindChange={mindMapImport.setImportSourceKind}
      onWorkflowChange={mindMapImport.setMindMapImportWorkflow}
      loading={mindMapImport.importLoading}
      streamPhase={mindMapImport.importStreamPhase}
      streamStatusMessage={mindMapImport.importStreamStatusMessage}
      streamStep={mindMapImport.importStreamStep}
      streamTotalSteps={mindMapImport.importStreamTotalSteps}
      streamPreviewText={mindMapImport.importStreamPreviewText}
      applying={mindMapImport.importApplying}
      undoing={mindMapImport.importUndoing}
      error={mindMapImport.importError}
      sourceTree={mindMapImport.importSourceTree}
      previewEditorDoc={mindMapImport.importPreviewEditorDoc}
      extractedText={mindMapImport.importExtractedText}
      imagePreviewUrl={mindMapImport.importImagePreviewUrl}
      batchImages={mindMapImport.importBatchImages}
      structureImageId={mindMapImport.importStructureImageId}
      batchStatus={mindMapImport.importBatchStatus}
      batchMeta={mindMapImport.importBatchMeta}
      importWarnings={mindMapImport.importWarnings}
      currentJobId={mindMapImport.currentJobId}
      currentJobStatus={mindMapImport.currentJobStatus}
      currentJobStage={mindMapImport.currentJobStage}
      currentJobUsage={mindMapImport.currentJobUsage}
      currentJobResolvedAi={mindMapImport.currentJobResolvedAi}
      currentJobPauseRequested={mindMapImport.currentJobPauseRequested}
      canResumeJob={mindMapImport.canResumeJob}
      canPauseJob={mindMapImport.canPauseJob}
      reusedExistingResult={mindMapImport.importReusedExistingResult}
      onResumeJob={mindMapImport.handleResumeJob}
      onPauseJob={mindMapImport.handlePauseJob}
      targetNodeLabel={targetNodeLabel}
      canAppend={mindMapImport.importCanAppend}
      canUndoLastImport={mindMapImport.importCanUndoLastImport}
      onPaste={mindMapImport.handleImportPaste}
      onFileChange={mindMapImport.handleImportFileChange}
      onBatchStart={mindMapImport.handleBatchImportStart}
      onBatchDeleteImage={mindMapImport.handleDeleteBatchImage}
      onBatchMoveImage={mindMapImport.handleMoveBatchImage}
      onBatchSetStructureImage={mindMapImport.handleSetStructureImage}
      onApplyReplace={mindMapImport.handleImportApplyReplace}
      onApplyAppend={mindMapImport.handleImportApplyAppend}
      onUndoLastImport={mindMapImport.handleUndoLastImport}
      history={mindMapImport.importHistory}
      onSelectHistory={mindMapImport.handleImportSelectHistory}
      onDeleteHistory={mindMapImport.handleImportDeleteHistory}
    />
  )
}
