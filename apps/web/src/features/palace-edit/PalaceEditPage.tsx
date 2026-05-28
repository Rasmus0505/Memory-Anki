import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, History, Search } from 'lucide-react'
import {
  BilinkPanel,
  BilinkPreviewPopover,
  BilinkSearchPopover,
} from '@/features/bilink'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import { MindMapFrame } from '@/shared/components/mindmap-host'
import { Button } from '@/shared/components/ui/button'
import { Badge } from '@/shared/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { SessionTimerBar } from '@/shared/components/session/SessionTimerBar'
import { cn } from '@/shared/lib/utils'
import { PalaceAttachmentPanel } from '@/features/palace-edit/components/PalaceAttachmentPanel'
import { PalaceChapterPanel } from '@/features/palace-edit/components/PalaceChapterPanel'
import { PalaceMetaPanel } from '@/features/palace-edit/components/PalaceMetaPanel'
import { PalaceSegmentsPanel } from '@/features/palace-edit/components/PalaceSegmentsPanel'
import { PalaceVersionDialog } from '@/features/palace-edit/components/PalaceVersionDialog'
import { PalaceMindMapImportDrawer } from '@/features/palace-edit/components/PalaceMindMapImportDrawer'
import { useMindMapImport } from '@/features/palace-edit/hooks/useMindMapImport'
import { usePalaceEditPage } from '@/features/palace-edit/hooks/usePalaceEditPage'
import { PalaceKnowledgeOutlinePanel } from '@/features/palace-edit/components/PalaceKnowledgeOutlinePanel'

export default function PalaceEdit() {
  const page = usePalaceEditPage()

  const selectedNodeUid =
    page.selectedNodes?.[0]?.uid ||
    (page.selectedNodes?.[0]?.rawData?.uid as string | undefined) ||
    (page.selectedNodes?.[0]?.rawData?.data as Record<string, unknown> | undefined)?.uid as string | undefined
  const importEntityKey = useMemo(
    () => (page.palaceId ? `palace_${page.palaceId}` : null),
    [page.palaceId],
  )
  const importSubjectOptions = useMemo(() => {
    const seen = new Set<number>()
    return (page.palace?.chapters || [])
      .map((chapter) => chapter.subject)
      .filter((subject): subject is { id: number; name: string } => Boolean(subject?.id && subject?.name))
      .filter((subject) => {
        if (seen.has(subject.id)) return false
        seen.add(subject.id)
        return true
      })
  }, [page.palace?.chapters])
  const mindMapImport = useMindMapImport({
    entityKey: importEntityKey,
    editorState: page.editorState,
    setEditorState: page.setEditorState,
    selectedNodeUid,
    subjectOptions: importSubjectOptions,
    defaultSubjectId:
      page.palace?.chapters.find((chapter) => chapter.id === page.primaryChapterId)?.subject?.id ??
      page.palace?.chapters.find((chapter) => chapter.subject?.id)?.subject?.id ??
      null,
  })

  const selectedNodeLabel = page.selectedNodes?.[0]?.text ?? ''

  if (!page.palaceId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">
        正在为新宫殿创建草稿…
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {!page.mindMapFullscreen ? (
        <PageIntro
          title={page.palace?.title || '宫殿编辑器'}
          actions={
            <>
              <Link to="/palaces">
                <Button variant="outline" size="sm">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  返回列表
                </Button>
              </Link>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  page.openBilinkSearch({
                    mode: 'toolbar',
                    nodeUid: page.selectedNode?.uid ?? null,
                    position: null,
                  })
                }
              >
                <Search className="mr-2 h-4 w-4" />
                全局搜索
              </Button>
              {page.palace ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void page.handleOpenVersions()}
                  >
                    <History className="mr-2 h-4 w-4" />
                    恢复点
                  </Button>
                </>
              ) : null}
              <Badge variant={page.statusBadge.variant}>
                {page.statusBadge.label}
              </Badge>
            </>
          }
        />
      ) : null}

      <div
        className={cn(
          'grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]',
          page.mindMapFullscreen && 'grid-cols-1',
        )}
      >
        <div className={cn('space-y-4', page.mindMapFullscreen && 'hidden')}>
          <SessionTimerBar
            effectiveSeconds={page.timer.effectiveSeconds}
            idleSeconds={page.timer.idleSeconds}
            pauseCount={page.timer.pauseCount}
            status={page.timer.status}
            onStart={() => page.timer.start({ source: 'manual' })}
            onPause={() => page.timer.pause({ source: 'manual' })}
            onResume={() => page.timer.resume({ source: 'manual' })}
            onAdjustDuration={page.timer.adjustDuration}
            showCompleteAction={false}
            className="sticky top-5 z-20"
          />

          <PalaceMetaPanel
            palace={page.palace}
            title={page.title}
            createdAt={page.createdAt}
            onTitleChange={page.setTitle}
            onCreatedAtChange={page.setCreatedAt}
            onSave={page.handleSaveMeta}
            onEstablishCreatedAt={page.handleEstablishCreatedAt}
          />

          <PalaceChapterPanel
            chapterOptions={page.chapterOptions}
            explicitChapterIds={page.explicitChapterIds}
            inheritedChapterIds={page.inheritedChapterIds}
            primaryChapterId={page.primaryChapterId}
            onToggleChapter={page.handleChapterToggle}
          />

          <PalaceSegmentsPanel
            segments={page.segments}
            selectedNodeCount={page.isSegmentRangeMode ? page.selectedRangeNodeCount : page.selectedNodes.length}
            activeSegmentId={page.activeSegmentId}
            segmentDialogOpen={page.segmentDialogOpen}
            segmentName={page.segmentName}
            setSegmentName={page.setSegmentName}
            segmentColor={page.segmentColor}
            setSegmentColor={page.setSegmentColor}
            segmentCreatedAt={page.segmentCreatedAt}
            setSegmentCreatedAt={page.setSegmentCreatedAt}
            editingSegmentId={page.editingSegmentId}
            segmentSaving={page.segmentSaving}
            segmentMergingId={page.segmentMergingId}
            segmentError={page.segmentError}
            isSegmentRangeMode={page.isSegmentRangeMode}
            rangeTargetSegmentId={page.rangeTargetSegmentId}
            onOpenDialog={page.handleOpenCreateSegment}
            onOpenEdit={page.handleOpenEditSegment}
            onOpenChange={page.setSegmentDialogOpen}
            onSave={page.handleSaveSegment}
            onDelete={page.handleDeleteSegment}
            onAdjustRange={page.handleAdjustSegmentRange}
            onMerge={page.handleMergeSegment}
          />

          <PalaceAttachmentPanel
            palace={page.palace}
            onUpload={page.handleAttachmentUpload}
            onDelete={page.handleAttachmentDelete}
          />

          <BilinkPanel
            items={page.bilinks}
            loading={page.bilinksLoading}
            error={page.bilinksError}
            onPreview={page.handleBilinkPanelPreview}
            onDelete={page.handleBilinkDelete}
          />
        </div>

        <div className={cn('space-y-4', page.mindMapFullscreen && 'space-y-0')}>
          <Card
            className={cn(
              'min-h-[74vh] border-border/70 bg-card/92',
              page.mindMapFullscreen &&
                'fixed inset-x-5 bottom-5 top-5 z-[90] min-h-0 bg-card/96 shadow-2xl',
            )}
          >
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">宫殿脑图</CardTitle>
              </div>
              {page.selectedNode?.memoryAnkiId ? (
                <Badge variant="secondary">
                  {page.selectedNode.memoryAnkiNodeType} #
                  {page.selectedNode.memoryAnkiId}
                </Badge>
              ) : null}
            </CardHeader>
            <CardContent
              className={cn(
                'min-h-[64vh]',
                page.mindMapFullscreen && 'h-[calc(100vh-108px)] min-h-0',
              )}
            >
              {page.activeMindMapEditorState ? (
                <MindMapFrame
                  key={`${page.palaceId}-${page.frameVersion}`}
                  editorState={page.activeMindMapEditorState}
                  readonly={page.editorMode === 'practice'}
                  showToolbarWhenReadonly={page.editorMode === 'practice'}
                  practiceModeActive={page.editorMode === 'practice'}
                  practiceToggleLabel={page.editorMode === 'practice' ? '复习' : '练习'}
                  immersiveModeActive={page.mindMapFullscreen}
                  showImportButtons
                  syncOnPropChange
                  preserveViewOnSync={
                    page.editorMode === 'practice' || mindMapImport.importAppliedSyncVersion > 0
                  }
                  externalSyncKey={mindMapImport.importExternalSyncKey}
                  forceSyncKey={`${page.frameVersion}:${page.editorMode}:${mindMapImport.importAppliedSyncVersion}`}
                  segments={page.segments
                    .filter((segment) => !segment.is_virtual_default)
                    .map((segment) => ({
                      id: segment.id,
                      name: segment.name,
                      color: segment.color,
                      created_at: segment.created_at,
                      node_uids: segment.node_uids,
                    }))}
                  activeSegmentId={page.activeSegmentId}
                  segmentColorMode="all-with-active-emphasis"
                  segmentRangeDraft={{
                    active: page.isSegmentRangeMode,
                    targetSegmentId: page.rangeTargetSegmentId,
                    selectedNodeUids: page.selectedRangeNodeUids,
                    overriddenConflictNodeUids: page.overriddenConflictNodeUids,
                  }}
                  bilinkCounts={page.bilinkCounts}
                  bilinkItems={page.bilinks}
                  bilinkCurrentPalaceId={page.palaceId}
                  bilinkInsertionText={page.bilinkInsertionText}
                  bilinkInsertionNonce={page.bilinkInsertionNonce}
                  showBilinkSearchButton
                  onEditorStateChange={(nextState: MindMapEditorState) => {
                    page.timer.registerActivity('edit_operation', { source: 'mind_map_edit' })
                    page.setEditorState(nextState)
                  }}
                  onNodeActive={(nodes) => {
                    page.timer.registerActivity('node_switch', { source: 'node_active' })
                    page.setSelectedNodes(nodes)
                  }}
                  onNodeClick={page.handleInlinePracticeNodeClick}
                  onNodeContextMenu={page.handleInlinePracticeNodeContextMenu}
                  onSegmentSelect={page.setActiveSegmentId}
                  onCreateSegmentFromSelection={page.handleOpenCreateSegment}
                  onSegmentRangeDraftChange={page.handleSegmentRangeDraftChange}
                  onSegmentRangeModeToggle={page.handleSegmentRangeModeToggle}
                  onSegmentRangeConfirm={page.handleConfirmSegmentRange}
                  onPracticeToggle={page.toggleInlinePractice}
                  onMindMapImportOpen={() => {
                    mindMapImport.setImportMode('mindmap')
                    mindMapImport.setImportOpen(true)
                  }}
                  onImageTextImportOpen={() => {
                    mindMapImport.setImportMode('text')
                    mindMapImport.setImportOpen(true)
                  }}
                  onFullscreenChange={page.handleMindMapNativeFullscreenChange}
                  onFullscreenToggle={page.toggleMindMapFullscreen}
                  onBilinkTrigger={page.handleBilinkTrigger}
                  onBilinkNodeClick={page.handleBilinkNodeClick}
                  onBilinkToolbarSearch={() =>
                    page.openBilinkSearch({
                      mode: 'toolbar',
                      nodeUid: page.selectedNode?.uid ?? null,
                      position: null,
                    })
                  }
                  className={cn(
                    'w-full rounded-2xl border border-border/70 bg-white',
                    page.mindMapFullscreen ? 'h-full' : 'h-[64vh]',
                  )}
                />
              ) : (
                <div className="flex h-[64vh] items-center justify-center rounded-2xl border border-dashed border-border/80 bg-background/60 text-sm text-muted-foreground">
                  正在加载宫殿编辑器…
                </div>
              )}
            </CardContent>
          </Card>

          {!page.mindMapFullscreen ? (
            <PalaceKnowledgeOutlinePanel
              palace={page.palace}
              explicitChapterIds={page.explicitChapterIds}
              chapterOptions={page.chapterOptions}
            />
          ) : null}
        </div>
      </div>

      <PalaceMindMapImportDrawer
        open={mindMapImport.importOpen}
        onOpenChange={mindMapImport.setImportOpen}
        mode={mindMapImport.importMode}
        onModeChange={mindMapImport.setImportMode}
        sourceKind={mindMapImport.importSourceKind}
        onSourceKindChange={mindMapImport.setImportSourceKind}
        onWorkflowChange={mindMapImport.setMindMapImportWorkflow}
        loading={mindMapImport.importLoading}
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
        importCanApply={mindMapImport.importCanApply}
        importMatchMode={mindMapImport.importMatchMode}
        onTogglePdfPage={mindMapImport.toggleImportPdfPage}
        onPdfStart={mindMapImport.handlePdfImportStart}
        targetNodeLabel={selectedNodeLabel}
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
        className={page.mindMapFullscreen ? 'z-[130]' : ''}
        overlayClassName={page.mindMapFullscreen ? 'z-[120]' : ''}
      />

      <BilinkSearchPopover
        open={page.bilinkSearchOpen}
        mode={page.bilinkSearchMode}
        position={page.bilinkSearchPosition}
        query={page.bilinkSearchQuery}
        loading={page.bilinkSearchLoading}
        error={page.bilinkSearchError}
        results={page.bilinkSearchResults}
        onQueryChange={page.setBilinkSearchQuery}
        onClose={page.closeBilinkSearch}
        onSelect={page.handleBilinkSearchSelect}
        onPreview={page.handleBilinkResultPreview}
      />

      <BilinkPreviewPopover
        open={page.bilinkPreviewOpen}
        loading={page.bilinkPreviewLoading}
        error={page.bilinkPreviewError}
        context={page.bilinkPreviewContext}
        editorState={page.bilinkPreviewEditorState}
        onClose={() => page.setBilinkPreviewOpen(false)}
        onJump={page.jumpToBilinkContext}
      />

      <PalaceVersionDialog
        open={page.versionOpen}
        versions={page.versions}
        removedDuplicateCount={page.removedDuplicateCount}
        previewingVersionId={page.previewingVersionId}
        previewVersionDetail={page.previewVersionDetail}
        previewLoading={page.previewLoading}
        previewError={page.previewError}
        editorStateLang={page.editorState?.lang || 'zh'}
        onOpenChange={(open) => {
          page.setVersionOpen(open)
          if (!open) page.handleCloseVersions()
        }}
        onClose={page.handleCloseVersions}
        onPreviewVersion={page.handlePreviewVersion}
        onRestoreVersion={page.handleRestoreVersion}
        onBackToList={page.resetVersionPreview}
      />
    </div>
  )
}
