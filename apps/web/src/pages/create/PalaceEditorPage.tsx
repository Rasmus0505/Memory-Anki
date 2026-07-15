import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, ArrowLeft, CheckCircle2, FileStack, History, LayoutTemplate, LoaderCircle, PencilLine } from 'lucide-react'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import {
  MindMapEditorSurface,
  MindMapPageToolbar,
  type MindMapEditorSurfaceHandle,
  type MindMapPageToolbarProps,
} from '@/features/mindmap-editor'
import { Button } from '@/shared/components/ui/button'
import { Badge } from '@/shared/components/ui/badge'
import { Card, CardContent } from '@/shared/components/ui/card'
import { cn } from '@/shared/lib/utils'
import { PalaceAttachmentPanel } from '@/features/palace-edit/components/PalaceAttachmentPanel'
import { PalaceMetaPanel } from '@/features/palace-edit/components/PalaceMetaPanel'
import { PalaceSegmentsPanel } from '@/features/palace-edit/components/PalaceSegmentsPanel'
import { PalaceTemplateDialog } from '@/features/palace-edit/components/PalaceTemplateDialog'
import { PalaceVersionDialog } from './PalaceVersionDialog'
import { usePalaceMindMapFileTransfer } from '@/features/palace-edit/hooks/usePalaceMindMapFileTransfer'
import { MindMapImportDrawer, useMindMapImport } from '@/features/mindmap-import'
import { usePalaceEditPage } from '@/features/palace-edit/hooks/usePalaceEditPage'
import { PalaceCreateSetup } from './PalaceCreateSetup'
import { PalaceMindMapWorkspace } from './PalaceMindMapWorkspace'
import { useQuizLauncher } from '@/widgets/quiz-launcher'
import { useRouteResidency } from '@/shared/routing/RouteResidency'
import { useMindMapExperience } from '@/features/mindmap-experience'
import { createPalaceTemplateApi } from '@/entities/palace/api'
import { appPrompt } from '@/shared/components/ui/native-dialog'
import { toast } from '@/shared/feedback/toast'
import { PalaceEditorSkeleton } from './PalaceEditorSkeleton'
import { FlipCardMindMapPanel } from '@/widgets/mindmap-review-flow'
import { detectClientSource } from '@/shared/lib/clientSource'

function SaveStatusBadge({
  status,
  error,
}: {
  status: 'saved' | 'saving' | 'unsaved' | 'error'
  error?: string | null
}) {
  if (status === 'saving') {
    return (
      <Badge variant="info" title="正在保存编辑内容">
        <LoaderCircle className="size-3 animate-spin" />
        保存中
      </Badge>
    )
  }

  if (status === 'unsaved') {
    return (
      <Badge variant="warning" title="内容已修改，系统会自动保存">
        <PencilLine className="size-3" />
        未保存
      </Badge>
    )
  }

  if (status === 'error') {
    return (
      <Badge variant="destructive" title={error || '自动保存失败，请稍后重试。'}>
        <AlertCircle className="size-3" />
        保存失败
      </Badge>
    )
  }

  return (
    <Badge variant="success" title="最近的编辑内容已保存">
      <CheckCircle2 className="size-3" />
      已保存
    </Badge>
  )
}

export default function PalaceEdit() {
  const { isActive, becameActiveAt } = useRouteResidency()
  const navigate = useNavigate()
  const page = usePalaceEditPage()
  const { openQuizLauncher } = useQuizLauncher()
  const mindMapFrameRef = useRef<MindMapEditorSurfaceHandle | null>(null)
  const [mindMapUiCleared, setMindMapUiCleared] = useState(false)
  const [mindMapNativeFullscreen, setMindMapNativeFullscreen] = useState(false)
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [activeMindMapKey, setActiveMindMapKey] = useState('palace')
  const [templateSaving, setTemplateSaving] = useState(false)

  const selectedNodeUid =
    page.selectedNodes?.[0]?.uid ||
    (page.selectedNodes?.[0]?.rawData?.uid as string | undefined) ||
    (page.selectedNodes?.[0]?.rawData?.data as Record<string, unknown> | undefined)?.uid as string | undefined
  const importEntityKey = useMemo(
    () => (page.palaceId ? `palace_${page.palaceId}` : null),
    [page.palaceId],
  )
  const mindMapImport = useMindMapImport({
    entityKey: importEntityKey,
    editorState: page.editorState,
    setEditorState: page.setEditorState,
    applyEditorState: page.applyImportedPalaceEditorState,
    selectedNodeUid,
  })

  const selectedNodeLabel = page.selectedNodes?.[0]?.text ?? ''
  const activeFrameEditorState = page.activeMindMapEditorState
  const mindMapExperience = useMindMapExperience({
    entityType: 'palace',
    entityId: page.palaceId,
    editorState: page.editorState,
    defaultTask: 'build',
  })
  const setMindMapTask = mindMapExperience.setTask
  const editorMode = page.editorMode
  const exitInlinePractice = page.exitInlinePractice
  const lastBuildActivationRef = useRef<number | null>(null)
  useEffect(() => {
    if (!isActive || lastBuildActivationRef.current === becameActiveAt) return
    lastBuildActivationRef.current = becameActiveAt
    setMindMapTask('build')
    if (editorMode !== 'edit') exitInlinePractice()
  }, [becameActiveAt, editorMode, exitInlinePractice, isActive, setMindMapTask])
  const recallModeActive = page.editorMode === 'recall'
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
  const mindMapSegments = useMemo(
    () =>
      page.segments
        .filter((segment) => !segment.is_virtual_default)
        .map((segment) => ({
          id: segment.id,
          name: segment.name,
          color: segment.color,
          created_at: segment.created_at,
          node_uids: segment.node_uids,
        })),
    [page.segments],
  )
  const showTemplateCreateAction = useMemo(() => {
    if (!page.palaceId || !page.editorState?.editor_doc) return false
    const editorDoc = page.editorState.editor_doc
    if (typeof editorDoc === 'string') return false
    const root = editorDoc.root
    if (!root || typeof root !== 'object' || !('children' in root)) return false
    const children = Array.isArray(root.children) ? root.children : []
    return children.length === 0
  }, [page.editorState?.editor_doc, page.palaceId])

  const handleSaveTemplate = async () => {
    if (!page.palaceId) return
    const defaultName = page.palace?.title || page.title || ''
    const name = await appPrompt('模板名称：', {
      title: '存为宫殿模板',
      defaultValue: defaultName,
      confirmText: '保存',
    })
    if (name === null) return
    setTemplateSaving(true)
    try {
      await createPalaceTemplateApi({ palace_id: page.palaceId, name })
      toast.success('已存为模板')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '存为模板失败。')
    } finally {
      setTemplateSaving(false)
    }
  }

  const mindMapFileTransfer = usePalaceMindMapFileTransfer({
    editorState: page.editorState,
    palaceTitle: page.palace?.title || page.title || '未命名宫殿',
    applyEditorState: page.applyImportedPalaceEditorState,
  })
  const handleOpenQuizPage = () => {
    if (!page.palaceId) return
    openQuizLauncher({
      palaceId: page.palaceId,
      scene: recallModeActive ? 'practice' : 'edit',
    })
  }

  const mindMapToolbarExtensions: Pick<
    MindMapPageToolbarProps,
    | 'embedded'
    | 'taskControl'
    | 'searchControl'
    | 'focusAction'
    | 'segmentControl'
    | 'moreActions'
    | 'importMindMapAction'
    | 'englishAction'
    | 'nativeFullscreenAction'
  > = {
    embedded: true,
    taskControl: {
      value: mindMapExperience.task,
      onChange: (task) => {
        mindMapExperience.setTask(task)
        if (task === 'build') page.exitInlinePractice()
        else page.enterInlinePractice()
      },
    },
    searchControl: {
      value: mindMapExperience.searchQuery,
      onChange: mindMapExperience.setSearchQuery,
      resultCount: mindMapExperience.searchResults.length,
    },
    focusAction: mindMapExperience.selectedResult
      ? {
          label: '定位结果',
          onClick: () => mindMapFrameRef.current?.focusNode(mindMapExperience.selectedResult?.nodeUid ?? null),
        }
      : selectedNodeUid
        ? {
            label: '聚焦节点',
            onClick: () => mindMapFrameRef.current?.focusNode(selectedNodeUid),
          }
        : null,
    segmentControl: mindMapExperience.task === 'build'
      ? {
          active: page.isSegmentRangeMode,
          targetSegmentId: page.rangeTargetSegmentId,
          options: segmentToolbarOptions,
          onToggle: () => page.handleSegmentRangeModeToggle({
            active: !page.isSegmentRangeMode,
            targetSegmentId: page.rangeTargetSegmentId || 'new',
          }),
          onTargetChange: (targetSegmentId) => page.handleSegmentRangeModeToggle({
            active: true,
            targetSegmentId,
          }),
          onConfirm: page.handleConfirmSegmentRange,
          onCancel: () => page.handleSegmentRangeModeToggle({ active: false, targetSegmentId: null }),
        }
      : null,
    moreActions: [
      {
        label: `结构检查（${mindMapExperience.structureIssues.length}）`,
        onClick: () => {
          const issue = mindMapExperience.structureIssues[0]
          if (!issue) return toast.success('未发现结构问题')
          mindMapFrameRef.current?.focusNode(issue.nodeUid)
          toast.warning(issue.message)
        },
      },
      ...mindMapFileTransfer.toolbarActions,
      ...(selectedNodeUid
        ? [
            {
              label: '标记为薄弱',
              onClick: () => { void mindMapExperience.setNodeManualLabel(selectedNodeUid, 'weak') },
              separatorBefore: true,
            },
            {
              label: '标记为已掌握',
              onClick: () => { void mindMapExperience.setNodeManualLabel(selectedNodeUid, 'mastered') },
            },
            {
              label: '清除手动标记',
              onClick: () => { void mindMapExperience.setNodeManualLabel(selectedNodeUid, null) },
            },
          ]
        : []),
    ],
    importMindMapAction: {
      label: '转脑图',
      onClick: () => mindMapImport.setImportOpen(true),
      opensOverlay: true,
    },
    englishAction: {
      label: '英语区',
      onClick: () => { void page.handleOpenEnglishArea() },
    },
    nativeFullscreenAction: {
      label: detectClientSource() === 'pwa' ? mindMapNativeFullscreen ? '退出全屏' : '全屏' : mindMapNativeFullscreen ? '退出系统全屏' : '系统全屏',
      active: mindMapNativeFullscreen,
      onClick: () => {
        if (mindMapNativeFullscreen) void mindMapFrameRef.current?.exitFullscreen()
        else void mindMapFrameRef.current?.enterFullscreen()
      },
    },
  }

  useEffect(() => {
    if (isActive) return
    if (!mindMapNativeFullscreen) return
    void mindMapFrameRef.current?.exitFullscreen()
  }, [isActive, mindMapNativeFullscreen])

  if (!page.palaceId) {
    return (
      <div className="space-y-4">
        <PageIntro
          compact
          title="新建宫殿"
          description="进入此页面不会创建数据。选择一种方式后，才会创建宫殿。"
          actions={
            <Button variant="outline" asChild>
              <Link to="/palaces">
                <ArrowLeft className="mr-2 size-4" />
                返回宫殿
              </Link>
            </Button>
          }
        />
        <PalaceCreateSetup
          busy={page.isCreatingDraft}
          onCreate={page.handleCreateBlankPalace}
        />
        <Card>
          <CardContent className="flex flex-wrap gap-3 p-6">
            <Button variant="outline" onClick={() => setTemplateDialogOpen(true)}>
              <LayoutTemplate className="mr-2 size-4" />
              从模板创建
            </Button>
          </CardContent>
        </Card>
        <PalaceTemplateDialog
          open={templateDialogOpen}
          onOpenChange={setTemplateDialogOpen}
          onCreated={(palaceId) => navigate(`/palaces/${palaceId}/edit`, { replace: true })}
        />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {mindMapFileTransfer.input}
      {!page.mindMapFullscreen ? (
        <PageIntro
          compact
          title={page.palace?.title || '宫殿编辑器'}
          actions={
            <>
              <Link to="/palaces">
                <Button variant="outline" size="sm">
                  <ArrowLeft className="mr-2 size-4" />
                  返回列表
                </Button>
              </Link>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/batch-generation')}
              >
                <FileStack className="mr-2 size-4" />
                整书批量生成
              </Button>
              {page.palace ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void page.handleOpenVersions()}
                  >
                    <History className="mr-2 size-4" />
                    恢复点
                  </Button>
                  {showTemplateCreateAction ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setTemplateDialogOpen(true)}
                    >
                      <LayoutTemplate className="mr-2 size-4" />
                      从模板创建
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={templateSaving}
                    onClick={() => void handleSaveTemplate()}
                  >
                    {templateSaving ? (
                      <LoaderCircle className="mr-2 size-4 animate-spin" />
                    ) : (
                      <LayoutTemplate className="mr-2 size-4" />
                    )}
                    存为模板
                  </Button>
                </>
              ) : null}
              <Badge variant={page.statusBadge.variant}>
                {page.statusBadge.label}
              </Badge>
              {!page.isLoadError ? <SaveStatusBadge status={page.saveStatus} error={page.saveError} /> : null}
            </>
          }
        />
      ) : null}

      {!page.mindMapFullscreen && page.isLoadError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          无法加载宫殿：{page.saveError || '该宫殿可能已被删除，请返回列表重新选择。'}
        </div>
      ) : null}

      {!page.mindMapFullscreen && page.saveStatus === 'error' && !page.isLoadError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          自动保存暂时失败：{page.saveError || '请检查网络后继续编辑，系统会保留未保存内容并稍后重试。'}
        </div>
      ) : null}

      {!page.mindMapFullscreen && page.palace ? (
        <PalaceMindMapWorkspace
          palace={page.palace}
          activeKey={activeMindMapKey}
          onActiveKeyChange={setActiveMindMapKey}
          onReload={page.reload}
        />
      ) : null}

      {activeMindMapKey === 'palace' ? (
      <div
        className={cn(
          'grid gap-3 xl:grid-cols-[340px_minmax(0,1fr)]',
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
            onTogglePractice={page.handleToggleSegmentPractice}
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

        <div className={cn('space-y-4', page.mindMapFullscreen && 'space-y-0')}>
          <Card
            className={cn(
              'min-h-[74vh] border-border/70 bg-card/92',
              page.mindMapFullscreen &&
                'fixed inset-x-5 bottom-5 top-5 z-[90] min-h-0 bg-card/96 shadow-2xl',
            )}
          >
            <CardContent
              className={cn(
                'min-h-[78vh] pt-5',
                page.mindMapFullscreen && 'h-[calc(100vh-72px)] min-h-0',
              )}
            >
              {activeFrameEditorState ? (
                <div className="flex h-full min-h-0 flex-col gap-3">
                  {mindMapExperience.task === 'learn' && !mindMapExperience.searchQuery ? (
                    <div className="grid gap-2 rounded-xl border bg-muted/15 p-3 sm:grid-cols-2 lg:grid-cols-4">
                      <button type="button" className="rounded-xl border bg-background p-3 text-left hover:border-primary" onClick={() => page.enterInlinePractice()}><div className="font-medium">主动回忆</div><div className="mt-1 text-xs text-muted-foreground">连续揭示并回忆整张脑图</div></button>
                      <button type="button" className="rounded-xl border bg-background p-3 text-left hover:border-primary" onClick={() => navigate('/reviews')}><div className="font-medium">正式复习</div><div className="mt-1 text-xs text-muted-foreground">进入复习队列并记录节点评分</div></button>
                      <button type="button" className="rounded-xl border bg-background p-3 text-left hover:border-primary" disabled={!mindMapExperience.weakItems.length} onClick={() => { const item = mindMapExperience.weakItems[0]; if (item) mindMapFrameRef.current?.focusNode(item.node_uid) }}><div className="font-medium">薄弱训练 · {mindMapExperience.weakItems.length}</div><div className="mt-1 text-xs text-muted-foreground">优先定位薄弱和需巩固节点</div></button>
                      <button type="button" className="rounded-xl border bg-background p-3 text-left hover:border-primary" onClick={handleOpenQuizPage}><div className="font-medium">做题训练</div><div className="mt-1 text-xs text-muted-foreground">基于当前宫殿进入题目训练</div></button>
                    </div>
                  ) : null}                  {mindMapExperience.searchQuery && mindMapExperience.searchResults.length ? (
                    <div className="flex gap-2 overflow-x-auto rounded-xl border bg-muted/20 p-2">
                      {mindMapExperience.searchResults.slice(0, 12).map((result) => (
                        <button key={result.nodeUid} type="button" className="shrink-0 rounded-lg border bg-background px-3 py-2 text-left text-xs hover:border-primary" onClick={() => { mindMapExperience.selectSearchResult(result.nodeUid); mindMapFrameRef.current?.focusNode(result.nodeUid) }}>
                          <div className="font-medium">{result.text || '未命名知识点'}</div>
                          <div className="mt-1 max-w-64 truncate text-muted-foreground">{result.path.join(' › ')}</div>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {recallModeActive ? (
                    <FlipCardMindMapPanel
                      ref={mindMapFrameRef}
                      fullscreen={page.mindMapFullscreen}
                      modeSyncVersion={page.replaceSyncVersion + mindMapImport.importAppliedSyncVersion}
                      viewMemoryScope={page.palaceId ? `palace-edit:${page.palaceId}` : null}
                      toolbarExtensions={mindMapToolbarExtensions}
                      visibleEditorState={activeFrameEditorState}
                      visibleEditorSyncKey={page.practiceVisibleEditorSyncKey}
                      currentPalaceId={page.palaceId}
                      reviewFxSignal={page.reviewFxSignal}
                      feedbackFxSignal={page.feedbackFxSignal}
                      highlightedNodeUids={mindMapExperience.highlightedNodeUids}
                      masteryByNodeUid={mindMapExperience.masteryByNodeUid}
                      segments={mindMapSegments}
                      activeSegmentId={page.activeSegmentId}
                      segmentColorMode="all-with-active-emphasis"
                      segmentRangeDraft={{
                        active: page.isSegmentRangeMode,
                        targetSegmentId: page.rangeTargetSegmentId,
                        selectedNodeUids: page.selectedRangeNodeUids,
                        overriddenConflictNodeUids: page.overriddenConflictNodeUids,
                      }}
                      focusRequestNodeUid={page.modeFocusRequestNodeUid}
                      focusRequestNonce={page.modeFocusRequestNonce}
                      onNodeActive={(nodes) => {
                        page.timer.registerActivity('node_switch', { source: 'node_active' })
                        page.handleMindMapNodeActive(nodes)
                      }}
                      onNodeClick={page.handleInlinePracticeNodeClick}
                      onNodeContextMenu={page.handleInlinePracticeNodeContextMenu}
                      onQuizBreakOpen={handleOpenQuizPage}
                      onSegmentSelect={page.setActiveSegmentId}
                      onCreateSegmentFromSelection={page.handleOpenCreateSegment}
                      onSegmentRangeDraftChange={page.handleSegmentRangeDraftChange}
                      onSegmentRangeModeToggle={page.handleSegmentRangeModeToggle}
                      onSegmentRangeConfirm={page.handleConfirmSegmentRange}
                      onNativeFullscreenChange={(active) => {
                        setMindMapNativeFullscreen(active)
                      }}
                      onToggleFullscreen={page.toggleMindMapFullscreen}
                      onUiClearedChange={setMindMapUiCleared}
                      className="flex flex-1 flex-col"
                      surfaceClassName={page.mindMapFullscreen ? 'h-full' : 'h-[78vh]'}
                    />
                  ) : (
                    <MindMapEditorSurface
                      ref={mindMapFrameRef}
                      editorState={activeFrameEditorState}
                      toolbarContent={
                        <MindMapPageToolbar
                          {...mindMapToolbarExtensions}
                          quizAction={{ label: '做题', onClick: handleOpenQuizPage }}
                          clearUiAction={{
                            label: mindMapUiCleared ? '恢复界面' : '清屏',
                            onClick: () => mindMapFrameRef.current?.toggleUiCleared(),
                          }}
                        />
                      }
                      highlightedNodeUids={mindMapExperience.highlightedNodeUids}
                      masteryByNodeUid={mindMapExperience.masteryByNodeUid}
                      viewMemoryScope={page.palaceId ? `palace-edit:${page.palaceId}` : null}
                      immersiveModeActive={page.mindMapFullscreen}
                      aiSplitBusy={page.aiSplitBusy}
                      syncOnPropChange
                      syncIntent="soft"
                      preserveViewOnSync={
                        mindMapImport.importAppliedSyncVersion > 0 || page.aiSplitAppliedSyncVersion > 0
                      }
                      initialViewPolicy="reset"
                      externalSyncKey={mindMapImport.importExternalSyncKey}
                      forceSyncKey={`edit:${page.replaceSyncVersion}:${mindMapImport.importAppliedSyncVersion}`}
                      forceSyncIntent="replace"
                      segments={mindMapSegments}
                      activeSegmentId={page.activeSegmentId}
                      segmentColorMode="all-with-active-emphasis"
                      segmentRangeDraft={{
                        active: page.isSegmentRangeMode,
                        targetSegmentId: page.rangeTargetSegmentId,
                        selectedNodeUids: page.selectedRangeNodeUids,
                        overriddenConflictNodeUids: page.overriddenConflictNodeUids,
                      }}
                      focusRequestNodeUid={page.modeFocusRequestNodeUid}
                      focusRequestNonce={page.modeFocusRequestNonce}
                      feedbackFxSignal={page.feedbackFxSignal}
                      onEditorStateChange={page.handleMindMapEditorStateChange}
                      onNodeActive={(nodes) => {
                        page.timer.registerActivity('node_switch', { source: 'node_active' })
                        page.handleMindMapNodeActive(nodes)
                      }}
                      onNodeClick={page.isSegmentRangeMode ? page.handleSegmentRangeNodeClick : undefined}
                      onSegmentSelect={page.setActiveSegmentId}
                      onCreateSegmentFromSelection={page.handleOpenCreateSegment}
                      onSegmentRangeDraftChange={page.handleSegmentRangeDraftChange}
                      onSegmentRangeModeToggle={page.handleSegmentRangeModeToggle}
                      onSegmentRangeConfirm={page.handleConfirmSegmentRange}
                      onAiSplitRequest={page.handleAiSplitRequest}
                      onFullscreenChange={(active) => {
                        setMindMapNativeFullscreen(active)
                      }}
                      onFullscreenToggle={page.toggleMindMapFullscreen}
                      onUiClearedChange={setMindMapUiCleared}
                      className={cn(
                        'w-full flex-1 rounded-lg border border-border/70 bg-background',
                        page.mindMapFullscreen ? 'h-full' : 'h-[78vh]',
                      )}
                    />
                  )}
                </div>
              ) : (
                <PalaceEditorSkeleton />
              )}
            </CardContent>
          </Card>

        </div>
      </div>
      ) : null}

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
            key={`palace-import-preview-${version}`}
            editorState={editorState}
            readonly
            syncOnPropChange
            forceSyncKey={`preview:${version}`}
            preserveViewOnSync={false}
            onEditorStateChange={() => {}}
            className="h-full w-full rounded-[inherit] bg-background"
          />
        )}
        extractedText={mindMapImport.importExtractedText}
        imagePreviewUrl={mindMapImport.importImagePreviewUrl}
        batchImages={mindMapImport.importBatchImages}
        structureImageId={mindMapImport.importStructureImageId}
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
        targetNodeLabel={selectedNodeLabel}
        canAppend={mindMapImport.importCanAppend}
        canUndoLastImport={mindMapImport.importCanUndoLastImport}
        onPaste={mindMapImport.handleImportPaste}
        onFileChange={mindMapImport.handleImportFileChange}
        onBatchStart={mindMapImport.handleBatchImportStart}
        onBatchDeleteImage={mindMapImport.handleDeleteBatchImage}
        onBatchMoveImage={mindMapImport.handleMoveBatchImage}
        onBatchSetStructureImage={mindMapImport.handleSetStructureImage}
        pdfDocuments={mindMapImport.pdfDocuments}
        selectedPdfDocumentId={mindMapImport.selectedPdfDocumentId}
        onSelectedPdfDocumentIdChange={mindMapImport.setSelectedPdfDocumentId}
        pdfPageSelection={mindMapImport.pdfPageSelection}
        onPdfPageSelectionChange={mindMapImport.setPdfPageSelection}
        pdfLibraryLoading={mindMapImport.pdfLibraryLoading}
        onPdfUpload={mindMapImport.handlePdfUpload}
        onPdfDelete={(documentId) => void mindMapImport.handlePdfDelete(documentId)}
        onPdfStart={mindMapImport.handlePdfImportStart}
        onApplyReplace={mindMapImport.handleImportApplyReplace}
        onApplyAppend={mindMapImport.handleImportApplyAppend}
        onUndoLastImport={mindMapImport.handleUndoLastImport}
        history={mindMapImport.importHistory}
        onSelectHistory={mindMapImport.handleImportSelectHistory}
        onDeleteHistory={mindMapImport.handleImportDeleteHistory}
        onRerunHistory={mindMapImport.handleImportRerunHistory}
        className={page.mindMapFullscreen ? 'z-[130]' : 'z-[120]'}
        overlayClassName={page.mindMapFullscreen ? 'z-[120]' : 'z-[110]'}
      />
      {mindMapImport.aiRunConfigDialog}
      {page.aiRunConfigDialog}

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

      <PalaceTemplateDialog
        open={templateDialogOpen}
        onOpenChange={setTemplateDialogOpen}
        onCreated={(palaceId) => navigate(`/palaces/${palaceId}/edit`, { replace: true })}
      />

    </div>
  )
}


