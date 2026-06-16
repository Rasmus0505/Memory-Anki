import { PalaceMindMapImportDrawer } from '@/features/palace-edit/components/PalaceMindMapImportDrawer'
import { useMindMapImport } from '@/features/palace-edit/hooks/useMindMapImport'

interface KnowledgeMindMapImportDrawerProps {
  mindMapImport: ReturnType<typeof useMindMapImport>
  targetNodeLabel: string
}

export function KnowledgeMindMapImportDrawer({
  mindMapImport,
  targetNodeLabel,
}: KnowledgeMindMapImportDrawerProps) {
  return (
    <PalaceMindMapImportDrawer
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
      subjectOptions={mindMapImport.importSubjectOptions}
      selectedSubjectId={mindMapImport.importSelectedSubjectId}
      onSelectedSubjectIdChange={mindMapImport.setImportSelectedSubjectId}
      subjectDocuments={mindMapImport.importSubjectDocuments}
      subjectDocumentsLoading={mindMapImport.importSubjectDocumentsLoading}
      selectedSubjectDocumentId={mindMapImport.importSelectedSubjectDocumentId}
      onSelectedSubjectDocumentIdChange={mindMapImport.setImportSelectedSubjectDocumentId}
      pdfPageMeta={mindMapImport.importPdfPageMeta}
      pdfPagesLoading={mindMapImport.importPdfPagesLoading}
      selectedPdfPages={mindMapImport.importPdfPages}
      pdfPageInput={mindMapImport.importPdfPageInput}
      onPdfPageInputChange={mindMapImport.setImportPdfPageInput}
      pdfSelectionError={mindMapImport.importPdfSelectionError}
      pdfImportMode={mindMapImport.importPdfMode}
      onPdfImportModeChange={mindMapImport.setImportPdfMode}
      structurePage={mindMapImport.importStructurePage}
      onStructurePageChange={mindMapImport.setImportStructurePage}
      pdfPreviewPage={mindMapImport.importPdfPreviewPage}
      onPdfPreviewPageChange={mindMapImport.setImportPdfPreviewPage}
      analyzedPdfPages={mindMapImport.importAnalyzedPdfPages}
      rangePrompt={mindMapImport.importRangePrompt}
      onRangePromptChange={mindMapImport.setImportRangePrompt}
      pdfImportOptions={mindMapImport.importPdfOptions}
      onPdfImportOptionChange={mindMapImport.setImportPdfOption}
      importWarnings={mindMapImport.importWarnings}
      pdfOcrGroundingUsed={mindMapImport.importPdfOcrGroundingUsed}
      pdfOcrTextChars={mindMapImport.importPdfOcrTextChars}
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
      onTogglePdfPage={mindMapImport.toggleImportPdfPage}
      onPdfStart={mindMapImport.handlePdfImportStart}
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
