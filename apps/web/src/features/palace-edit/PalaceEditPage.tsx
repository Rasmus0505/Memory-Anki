import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, History, Search, Volume2 } from 'lucide-react'
import {
  BilinkPanel,
  BilinkPreviewPopover,
  BilinkSearchPopover,
} from '@/features/bilink'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import {
  MindMapFrame,
  MindMapPageToolbar,
  type MindMapFrameHandle,
} from '@/shared/components/mindmap-host'
import { Button } from '@/shared/components/ui/button'
import { Badge } from '@/shared/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { cn } from '@/shared/lib/utils'
import { PalaceAttachmentPanel } from '@/features/palace-edit/components/PalaceAttachmentPanel'
import { PalaceChapterPanel } from '@/features/palace-edit/components/PalaceChapterPanel'
import { PalaceMetaPanel } from '@/features/palace-edit/components/PalaceMetaPanel'
import { PalaceSegmentsPanel } from '@/features/palace-edit/components/PalaceSegmentsPanel'
import { PalaceVersionDialog } from '@/features/palace-edit/components/PalaceVersionDialog'
import { MindMapImportDrawer, useMindMapImport } from '@/features/mindmap-import'
import { usePalaceEditPage } from '@/features/palace-edit/hooks/usePalaceEditPage'
import { PalaceKnowledgeOutlinePanel } from '@/features/palace-edit/components/PalaceKnowledgeOutlinePanel'
import { useQuizLauncher } from '@/features/palace-quiz/QuizLauncherProvider'
import {
  useVoiceCoachController,
  VoiceCoachSettingsDialog,
} from '@/features/voice-coach'
import { MiniPalacePanel } from '@/features/mini-palace'
import { useRouteResidency } from '@/shared/routing/RouteResidency'
import { PalaceEditSkeleton } from './PalaceEditSkeleton'

export default function PalaceEdit() {
  const { isActive } = useRouteResidency()
  const page = usePalaceEditPage()
  const { openQuizLauncher } = useQuizLauncher()
  const mindMapFrameRef = useRef<MindMapFrameHandle | null>(null)
  const [voiceCoachDialogOpen, setVoiceCoachDialogOpen] = useState(false)
  const [mindMapUiCleared, setMindMapUiCleared] = useState(false)
  const [mindMapNativeFullscreen, setMindMapNativeFullscreen] = useState(false)
  const voiceCoach = useVoiceCoachController({
    scene: page.editorMode === 'practice' ? 'practice' : 'edit',
    timer: page.timer,
  })

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
    applyEditorState: page.applyImportedPalaceEditorState,
    selectedNodeUid,
    subjectOptions: importSubjectOptions,
    defaultSubjectId:
      page.palace?.chapters.find((chapter) => chapter.id === page.primaryChapterId)?.subject?.id ??
      page.palace?.chapters.find((chapter) => chapter.subject?.id)?.subject?.id ??
      null,
  })

  const selectedNodeLabel = page.selectedNodes?.[0]?.text ?? ''
  const miniPalaceFrameEditorState =
    page.miniPalace.visibleEditorState ??
    (page.miniPalace.isActive ? page.editorState : null)
  const activeFrameEditorState =
    miniPalaceFrameEditorState ?? page.activeMindMapEditorState
  const miniPalaceFrameActive = page.miniPalace.isActive
  const readonlyMindMap = page.editorMode === 'practice' || miniPalaceFrameActive
  const segmentToolbarOptions = useMemo(
    () =>
      page.segments
        .filter((segment) => !segment.is_virtual_default)
        .map((segment) => ({
          id: segment.id,
          name: segment.name,
        })),
    [page.segments],
  )

  const handleImmersiveToolbarToggle = async () => {
    if (mindMapNativeFullscreen) {
      await mindMapFrameRef.current?.exitNativeFullscreen()
      page.toggleMindMapFullscreen(true)
      return
    }
    page.toggleMindMapFullscreen()
  }

  const handleNativeFullscreenToolbarToggle = async () => {
    if (mindMapNativeFullscreen) {
      await mindMapFrameRef.current?.exitNativeFullscreen()
      return
    }
    if (page.mindMapFullscreen) {
      page.toggleMindMapFullscreen(false)
    }
    await mindMapFrameRef.current?.enterNativeFullscreen()
  }

  const handleOpenQuizPage = () => {
    if (!page.palaceId) return
    openQuizLauncher({
      palaceId: page.palaceId,
      scene: page.editorMode === 'practice' ? 'practice' : 'edit',
    })
  }

  useEffect(() => {
    if (isActive) return
    if (!mindMapNativeFullscreen) return
    void mindMapFrameRef.current?.exitNativeFullscreen()
  }, [isActive, mindMapNativeFullscreen])

  if (!page.palaceId) {
    return <PalaceEditSkeleton />
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => setVoiceCoachDialogOpen(true)}
              >
                <Volume2 className="mr-2 h-4 w-4" />
                {voiceCoach.enabled ? '语音教练' : '开启语音'}
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
            selectionPending={page.chapterSelectionPending}
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
              {activeFrameEditorState ? (
                <div className="flex h-full min-h-0 flex-col gap-3">
                  <MindMapPageToolbar
                    segmentControl={{
                      active: page.isSegmentRangeMode,
                      targetSegmentId: page.rangeTargetSegmentId,
                      options: segmentToolbarOptions,
                      onToggle: () =>
                        page.handleSegmentRangeModeToggle({
                          active: !page.isSegmentRangeMode,
                          targetSegmentId: page.rangeTargetSegmentId || 'new',
                        }),
                      onTargetChange: (targetSegmentId) =>
                        page.handleSegmentRangeModeToggle({
                          active: true,
                          targetSegmentId,
                        }),
                      onConfirm: page.handleConfirmSegmentRange,
                      onCancel: () =>
                        page.handleSegmentRangeModeToggle({
                          active: false,
                          targetSegmentId: null,
                        }),
                    }}
                    modeToggle={
                      miniPalaceFrameActive
                        ? null
                        : {
                            label: page.editorMode === 'practice' ? '编辑' : '练习',
                            onClick: page.toggleInlinePractice,
                          }
                    }
                    importMindMapAction={{
                      label: '转脑图',
                      onClick: () => {
                        mindMapImport.setImportMode('mindmap')
                        mindMapImport.setImportOpen(true)
                      },
                    }}
                    importTextAction={{
                      label: '转文字',
                      onClick: () => {
                        mindMapImport.setImportMode('text')
                        mindMapImport.setImportOpen(true)
                      },
                    }}
                    englishAction={{
                      label: '英语区',
                      onClick: () => {
                        void page.handleOpenEnglishArea()
                      },
                    }}
                    bilinkSearchAction={{
                      label: '搜索',
                      onClick: () =>
                        page.openBilinkSearch({
                          mode: 'toolbar',
                          nodeUid: page.selectedNode?.uid ?? null,
                          position: null,
                        }),
                    }}
                    quizAction={
                      page.palaceId
                        ? {
                            label: '做题',
                            onClick: handleOpenQuizPage,
                          }
                        : null
                    }
                    miniPalaceAction={
                      page.palaceId
                        ? {
                            label: '小宫殿',
                            onClick: page.miniPalace.openPanel,
                          }
                        : null
                    }
                    immersiveAction={{
                      label: '半屏编辑',
                      active: page.mindMapFullscreen,
                      onClick: () => {
                        void handleImmersiveToolbarToggle()
                      },
                    }}
                    nativeFullscreenAction={{
                      label: '全屏编辑',
                      active: mindMapNativeFullscreen,
                      onClick: () => {
                        void handleNativeFullscreenToolbarToggle()
                      },
                    }}
                    clearUiAction={{
                      label: '清屏',
                      active: mindMapUiCleared,
                      onClick: () => mindMapFrameRef.current?.toggleUiCleared(),
                    }}
                  />

                  <MindMapFrame
                    ref={mindMapFrameRef}
                    editorState={activeFrameEditorState}
                    readonly={readonlyMindMap}
                    practiceModeActive={page.editorMode === 'practice' || page.miniPalace.isPracticing}
                    viewMemoryScope={
                      page.palaceId ? `palace-edit:${page.palaceId}` : null
                    }
                    immersiveModeActive={page.mindMapFullscreen}
                    aiSplitBusy={page.editorMode === 'edit' && !miniPalaceFrameActive ? page.aiSplitBusy : false}
                    syncOnPropChange
                    syncIntent={page.editorMode === 'practice' || miniPalaceFrameActive ? 'replace' : 'soft'}
                    syncReason={
                      miniPalaceFrameActive
                        ? 'mini_palace'
                        : page.editorMode === 'practice'
                          ? 'review_flip'
                          : null
                    }
                    preserveViewOnSync={
                      miniPalaceFrameActive ||
                      page.editorMode === 'practice' ||
                      mindMapImport.importAppliedSyncVersion > 0 ||
                      page.aiSplitAppliedSyncVersion > 0
                    }
                    initialViewPolicy={page.editorMode === 'practice' || miniPalaceFrameActive ? 'preserve' : 'reset'}
                    externalSyncKey={
                      miniPalaceFrameActive
                        ? page.miniPalace.visibleSyncKey
                        : page.editorMode === 'practice'
                          ? page.practiceVisibleEditorSyncKey
                          : mindMapImport.importExternalSyncKey
                    }
                    forceSyncKey={`${page.editorMode}:${page.replaceSyncVersion}:${mindMapImport.importAppliedSyncVersion}${miniPalaceFrameActive ? `:${page.miniPalace.visibleSyncKey}` : ''}`}
                    forceSyncIntent="replace"
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
                    focusNodeUids={page.focusNodeUids}
                    focusRequestNodeUid={page.modeFocusRequestNodeUid}
                    focusRequestNonce={page.modeFocusRequestNonce}
                    miniPalaceDraft={page.miniPalace.hostDraft}
                    bilinkInsertionText={page.bilinkInsertionText}
                    bilinkInsertionNonce={page.bilinkInsertionNonce}
                    reviewFxSignal={page.editorMode === 'practice' ? page.reviewFxSignal : null}
                    feedbackFxSignal={page.feedbackFxSignal}
                    onEditorStateChange={page.handleMindMapEditorStateChange}
                    onNodeActive={(nodes) => {
                      page.timer.registerActivity('node_switch', { source: 'node_active' })
                      page.handleMindMapNodeActive(nodes)
                    }}
                    onNodeClick={
                      miniPalaceFrameActive
                        ? page.miniPalace.handleNodeClick
                        : page.handleInlinePracticeNodeClick
                    }
                    onNodeContextMenu={
                      miniPalaceFrameActive
                        ? page.miniPalace.handleNodeContextMenu
                        : page.editorMode === 'edit'
                          ? page.handleEditNodeContextMenu
                          : page.handleInlinePracticeNodeContextMenu
                    }
                    onSegmentSelect={page.setActiveSegmentId}
                    onCreateSegmentFromSelection={page.handleOpenCreateSegment}
                    onSegmentRangeDraftChange={page.handleSegmentRangeDraftChange}
                    onSegmentRangeModeToggle={page.handleSegmentRangeModeToggle}
                    onSegmentRangeConfirm={page.handleConfirmSegmentRange}
                    onAiSplitRequest={page.editorMode === 'edit' && !miniPalaceFrameActive ? page.handleAiSplitRequest : undefined}
                    onFullscreenChange={(active) => {
                      setMindMapNativeFullscreen(active)
                      page.handleMindMapNativeFullscreenChange(active)
                    }}
                    onFullscreenToggle={page.toggleMindMapFullscreen}
                    onUiClearedChange={setMindMapUiCleared}
                    onBilinkTrigger={page.handleBilinkTrigger}
                    onBilinkNodeClick={page.handleBilinkNodeClick}
                    onMiniPalacePour={page.miniPalace.isPracticing ? page.miniPalace.handleSpacePour : undefined}
                    className={cn(
                      'w-full flex-1 rounded-2xl border border-border/70 bg-background',
                      page.mindMapFullscreen ? 'h-full' : 'h-[64vh]',
                    )}
                  />
                </div>
              ) : (
                <PalaceEditSkeleton />
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

      <MiniPalacePanel controller={page.miniPalace} onEditSave={page.handleMiniPalaceEditSave} onEditCancel={page.handleMiniPalaceEditCancel} />

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
        className={page.mindMapFullscreen ? 'z-[130]' : 'z-[120]'}
        overlayClassName={page.mindMapFullscreen ? 'z-[120]' : 'z-[110]'}
      />
      {mindMapImport.aiRunConfigDialog}
      {page.aiRunConfigDialog}

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
        highlightQuery={page.bilinkPreviewHighlightQuery}
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

      <VoiceCoachSettingsDialog
        open={voiceCoachDialogOpen}
        onOpenChange={setVoiceCoachDialogOpen}
        onTest={voiceCoach.playTestEvent}
      />
    </div>
  )
}
