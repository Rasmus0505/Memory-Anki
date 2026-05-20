import { Link } from 'react-router-dom'
import { ArrowLeft, History, ImagePlus } from 'lucide-react'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import { MindMapFrame } from '@/shared/components/mindmap-host'
import { Button } from '@/shared/components/ui/button'
import { Badge } from '@/shared/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { SessionTimerBar } from '@/shared/components/session/SessionTimerBar'
import { cn } from '@/shared/lib/utils'
import { PalaceAttachmentPanel } from '@/features/palace-edit/components/PalaceAttachmentPanel'
import { PalaceBindingPanel } from '@/features/palace-edit/components/PalaceBindingPanel'
import { PalaceChapterPanel } from '@/features/palace-edit/components/PalaceChapterPanel'
import { PalaceMindMapImportDrawer } from '@/features/palace-edit/components/PalaceMindMapImportDrawer'
import { PalaceMetaPanel } from '@/features/palace-edit/components/PalaceMetaPanel'
import { PalaceSegmentsPanel } from '@/features/palace-edit/components/PalaceSegmentsPanel'
import { PalaceVersionDialog } from '@/features/palace-edit/components/PalaceVersionDialog'
import { usePalaceEditPage } from '@/features/palace-edit/hooks/usePalaceEditPage'

export default function PalaceEdit() {
  const page = usePalaceEditPage()

  if (!page.palaceId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">
        正在为新宫殿创建草稿…
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageIntro
        title={page.palace?.resolved_title || page.palace?.title || '宫殿编辑器'}
        actions={
          <>
            <Link to="/palaces">
              <Button variant="outline" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" />
                返回列表
              </Button>
            </Link>
            {page.palace ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void page.handleOpenVersions()}
              >
                <History className="mr-2 h-4 w-4" />
                恢复点
              </Button>
            ) : null}
            <Badge variant={page.statusBadge.variant}>
              {page.statusBadge.label}
            </Badge>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-4">
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
            className={
              page.mindMapFullscreen
                ? 'fixed right-5 top-5 z-[100]'
                : 'sticky top-5 z-20'
            }
          />

          <PalaceMetaPanel
            palace={page.palace}
            title={page.title}
            createdAt={page.createdAt}
            isTitleSynced={page.isTitleSynced}
            onTitleChange={page.setTitle}
            onCreatedAtChange={page.setCreatedAt}
            onSave={page.handleSaveMeta}
            onEstablishCreatedAt={page.handleEstablishCreatedAt}
            onDisconnectTitleSync={page.handleDisconnectTitleSync}
          />

          <PalaceChapterPanel
            chapterOptions={page.chapterOptions}
            selectedChapterIds={page.selectedChapterIds}
            primaryChapterId={page.primaryChapterId}
            onToggleChapter={page.handleChapterToggle}
            onSetPrimaryChapter={page.handleSetPrimaryChapter}
          />

          <PalaceBindingPanel
            titleMode={page.titleMode}
            manualTitle={page.manualTitle}
            groupingMode={page.groupingMode}
            manualGroupChapterId={page.manualGroupChapterId}
            chapterOptions={page.chapterOptions}
            primaryChapterName={page.palace?.primary_chapter?.name ?? null}
            resolvedParentChapterName={page.palace?.resolved_parent_chapter?.name ?? null}
            bindingStatus={page.palace?.binding_status ?? 'unbound'}
            onTitleModeChange={page.setTitleMode}
            onManualTitleChange={page.setManualTitle}
            onGroupingModeChange={page.setGroupingMode}
            onManualGroupChapterChange={page.setManualGroupChapterId}
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
        </div>

        <Card
          className={cn(
            'min-h-[74vh] border-border/70 bg-card/92',
            page.mindMapFullscreen &&
              'fixed inset-4 z-[90] min-h-0 bg-card/96 shadow-2xl',
          )}
        >
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">宫殿脑图</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={page.handleOpenMindMapImport}>
                <ImagePlus className="mr-2 h-4 w-4" />
                图片转脑图
              </Button>
              {page.selectedNode?.memoryAnkiId ? (
                <Badge variant="secondary">
                  {page.selectedNode.memoryAnkiNodeType} #
                  {page.selectedNode.memoryAnkiId}
                </Badge>
              ) : null}
            </div>
          </CardHeader>
          <CardContent
            className={cn(
              'min-h-[64vh]',
              page.mindMapFullscreen && 'h-[calc(100vh-120px)] min-h-0',
            )}
          >
            {page.editorState ? (
              <MindMapFrame
                editorState={page.editorState}
                syncOnPropChange
                preserveViewOnSync
                segments={page.hostSegments}
                activeSegmentId={page.activeSegmentId}
                segmentColorMode="all-with-active-emphasis"
                segmentRangeDraft={{
                  active: page.isSegmentRangeMode,
                  targetSegmentId: page.rangeTargetSegmentId,
                  selectedNodeUids: page.selectedRangeNodeUids,
                  overriddenConflictNodeUids: page.overriddenConflictNodeUids,
                }}
                onEditorStateChange={(nextState: MindMapEditorState) => {
                  page.timer.registerActivity({ source: 'mind_map_edit' })
                  page.setEditorState(nextState)
                }}
                onNodeActive={(nodes) => {
                  page.timer.registerActivity({ source: 'node_active' })
                  page.setSelectedNodes(nodes)
                }}
                onEdgeContextMenu={(edge) => {
                  page.handleEdgeInsertIntermediate(edge.sourceUid, edge.targetUid)
                }}
                onEdgeDoubleClick={(edge) => {
                  page.handleEdgeInsertIntermediate(edge.sourceUid, edge.targetUid)
                }}
                onSegmentSelect={page.setActiveSegmentId}
                onCreateSegmentFromSelection={page.handleOpenCreateSegment}
                onSegmentRangeDraftChange={page.handleSegmentRangeDraftChange}
                onSegmentRangeModeToggle={page.handleSegmentRangeModeToggle}
                onSegmentRangeConfirm={page.handleConfirmSegmentRange}
                onFullscreenChange={page.setMindMapFullscreen}
                focusRequest={page.focusRequest}
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
      </div>

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

      <PalaceMindMapImportDrawer
        open={page.mindMapImportOpen}
        onOpenChange={(open) => {
          page.setMindMapImportOpen(open)
          if (!open) page.resetMindMapImportState()
        }}
        loading={page.mindMapImportLoading}
        applying={page.mindMapImportApplying}
        error={page.mindMapImportError}
        sourceTree={page.mindMapImportSourceTree}
        imagePreviewUrl={page.mindMapImportImagePreviewUrl}
        targetNodeLabel={page.selectedNode?.text || ''}
        canAppend={Boolean(page.selectedNode?.uid)}
        onPaste={(event) => void page.handleMindMapImportPaste(event)}
        onFileChange={(event) => void page.handleMindMapImportFileChange(event)}
        onApplyReplace={() => void page.handleApplyMindMapImport('replace')}
        onApplyAppend={() => void page.handleApplyMindMapImport('append')}
      />
    </div>
  )
}
