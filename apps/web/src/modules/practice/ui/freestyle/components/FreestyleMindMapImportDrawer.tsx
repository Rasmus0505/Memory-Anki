import { MindMapEditorSurface } from '@/modules/content/public'
import { MindMapImportDrawer, useMindMapImport } from '@/modules/produce/public'

interface FreestyleMindMapImportDrawerProps {
  mindMapImport: ReturnType<typeof useMindMapImport>
  targetNodeLabel: string
}

export function FreestyleMindMapImportDrawer({
  mindMapImport,
  targetNodeLabel,
}: FreestyleMindMapImportDrawerProps) {
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
      renderMindMapPreview={(editorState, version) => (
        <MindMapEditorSurface
          key={`freestyle-import-preview-${version}`}
          editorState={editorState}
          readonly
          syncOnPropChange
          forceSyncKey={`preview:${version}`}
          preserveViewOnSync={false}
          onEditorStateChange={() => {}}
          className="h-full w-full rounded-[inherit] bg-zinc-50"
        />
      )}
      extractedText={mindMapImport.importExtractedText}
      imagePreviewUrl={mindMapImport.importImagePreviewUrl}
      batchImages={mindMapImport.importBatchImages}
      batchStatus={mindMapImport.importBatchStatus}
      batchMeta={mindMapImport.importBatchMeta}
      importWarnings={mindMapImport.importWarnings}
      reviewPreview={mindMapImport.importReviewPreview}
      currentJobId={mindMapImport.currentJobId}
      currentJobStatus={mindMapImport.currentJobStatus}
      currentJobStage={mindMapImport.currentJobStage}
      currentJobUsage={mindMapImport.currentJobUsage}
      currentJobError={mindMapImport.currentJobError}
      currentJobResolvedAi={mindMapImport.currentJobResolvedAi}
      currentJobResult={mindMapImport.currentJobResult}
      onRetryVision={() => void mindMapImport.handleRetryVision()}
      onReformatFromOcr={() => void mindMapImport.handleReformatFromOcr()}
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
      pdfDocuments={mindMapImport.pdfDocuments}
      selectedPdfDocumentId={mindMapImport.selectedPdfDocumentId}
      onSelectedPdfDocumentIdChange={mindMapImport.setSelectedPdfDocumentId}
      pdfPageSelection={mindMapImport.pdfPageSelection}
      onPdfPageSelectionChange={mindMapImport.setPdfPageSelection}
      pdfLibraryLoading={mindMapImport.pdfLibraryLoading}
      pdfOcrCoverage={mindMapImport.pdfOcrCoverage}
      onPdfUpload={mindMapImport.handlePdfUpload}
      onPdfDelete={(documentId) => void mindMapImport.handlePdfDelete(documentId)}
      onPdfStart={mindMapImport.handlePdfImportStart}
      manualImportText={mindMapImport.manualImportText}
      onManualImportTextChange={mindMapImport.setManualImportText}
      manualImportFileName={mindMapImport.manualImportFileName}
      manualImportFormatPrompt={mindMapImport.manualImportFormatPrompt}
      onManualImportParse={mindMapImport.handleManualImportParse}
      onManualImportFileChange={(event) => void mindMapImport.handleManualImportFileChange(event)}
      onApplyReplace={mindMapImport.handleImportApplyReplace}
      onApplyAppend={mindMapImport.handleImportApplyAppend}
      onUndoLastImport={mindMapImport.handleUndoLastImport}
      history={mindMapImport.importHistory}
      onSelectHistory={mindMapImport.handleImportSelectHistory}
      onDeleteHistory={mindMapImport.handleImportDeleteHistory}
      onRerunHistory={mindMapImport.handleImportRerunHistory}
    />
  )
}
