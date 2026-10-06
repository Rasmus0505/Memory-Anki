import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, CheckCircle2, LayoutTemplate, LoaderCircle, PencilLine } from 'lucide-react'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import { MindMapDocumentConflictDialog } from '@/shared/components/mindmap-document-conflict'
import { MindMapSplitLayout } from '@/shared/components/layout/MindMapSplitLayout'
import {
  MindMapEditorSurface,
  ArticleTransferDialog,
  useArticleTransfer,
  normalizeMindMapDocument,
  type MindMapEditorSurfaceHandle,
  type MindMapPageToolbarProps,
} from '@/modules/content/public'
import { Button } from '@/shared/components/ui/button'
import { Badge } from '@/shared/components/ui/badge'
import { Card, CardContent } from '@/shared/components/ui/card'
import { cn } from '@/shared/lib/utils'
import { PalaceAttachmentPanel } from '@/modules/content/public'
import { PalaceMetaPanel } from '@/modules/content/public'
import { PalaceTemplateDialog } from '@/modules/content/public'
import { PalaceVersionDialog } from './PalaceVersionDialog'
import { usePalaceMindMapFileTransfer } from '@/modules/content/public'
import { MindMapImportDrawer, readClipboardTextForMindMapImport, useMindMapImport } from '@/modules/produce/public'
import { usePalaceEditPage } from '@/modules/content/public'
import { PalaceCreateSetup } from './PalaceCreateSetup'
import {
  PalaceKnowledgeBindingCard,
  PalaceKnowledgeWorkspaceProvider,
  PalaceSubjectMindMapCard,
} from './PalaceMindMapWorkspace'
import { useQuizLauncher } from '@/widgets/quiz-launcher'
import { PalaceMemoryLookupDialog } from '@/widgets/palace-memory-lookup'
import { useRouteResidency } from '@/shared/routing/RouteResidency'
import { useMindMapExperience } from '@/modules/content/public'
import { createPalaceTemplateApi } from '@/modules/content/public'
import { appPrompt } from '@/shared/components/ui/native-dialog'
import { toast } from '@/shared/feedback/toast'
import { PalaceEditorSkeleton } from './PalaceEditorSkeleton'
import { FlipCardMindMapPanel } from '@/widgets/mindmap-review-flow'
import { PalaceReviewUnitsPanel } from '@/modules/practice/public'
import { usePalaceEditorQuizBindings } from './usePalaceEditorQuizBindings'
import type { MindMapSelection } from '@/modules/content/public'
import {
  buildEditorParentMap,
  collectPermanentMarkUids,
  colorForPermanentLevel,
  derivePermanentMarkLevels,
  togglePermanentMarkInDoc,
  type EditorDoc,
} from '@/shared/lib/mindmap-split-marks/splitMarks'

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
  const [, setMindMapUiCleared] = useState(false)
  const [mindMapNativeFullscreen, setMindMapNativeFullscreen] = useState(false)
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [memoryLookupOpen, setMemoryLookupOpen] = useState(false)
  const [activeMindMapKey, setActiveMindMapKey] = useState('palace')
  const [templateSaving, setTemplateSaving] = useState(false)
  const [permanentMarkMode, setPermanentMarkMode] = useState(false)
  const [reviewUnitsPanelOpen, setReviewUnitsPanelOpen] = useState(false)
  const [sidePanelCollapsed, setSidePanelCollapsed] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(max-width: 767px)').matches))

  // Re-read on every residency activation: keep-alive can remount search without
  // remounting this component, so a bare [] would miss later ?mode=permanent-mark.
  useEffect(() => {
    if (!isActive) return
    if (new URLSearchParams(window.location.search).get('mode') === 'permanent-mark') {
      setPermanentMarkMode(true)
    }
  }, [becameActiveAt, isActive])

  const selectedNodeUid =
    page.selectedNodes?.[0]?.uid ||
    (page.selectedNodes?.[0]?.rawData?.uid as string | undefined) ||
    (page.selectedNodes?.[0]?.rawData?.data as Record<string, unknown> | undefined)?.uid as string | undefined
  const articleTransfer = useArticleTransfer({
    ownerId: `palace:${page.palaceId ?? 'new'}`,
    active: isActive,
    pendingConflict: Boolean(page.pendingConflict),
    selectedUid: selectedNodeUid,
    flushSave: page.flushSave,
    readHost: () => {
      const state = page.readCurrentDocumentState()
      if (!state.editorState || state.pendingConflict || state.entityId !== page.palaceId) return null
      return {
        ownerId: `palace:${state.entityId}`, palaceId: state.entityId,
        revision: state.revision || null, dirty: state.dirty,
        document: normalizeMindMapDocument(state.editorState.editor_doc),
      }
    },
    onApplied: async (result, captured) => {
      if (result.palace_id !== captured.palaceId) {
        navigate(`/palaces/${result.palace_id}/edit`)
        return
      }
      page.adoptArticleTransferState({
        editor_doc: result.editor_doc, editor_fingerprint: result.editor_fingerprint,
        editor_config: result.snapshot.editorPreferences,
        editor_local_config: result.snapshot.localPreferences, lang: result.snapshot.language,
      })
    },
  })
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
  const quizBindingsHost = usePalaceEditorQuizBindings({
    palaceId: page.palaceId,
    editorDoc: page.editorState?.editor_doc,
  })
  const setMindMapTask = mindMapExperience.setTask
  const editorMode = page.editorMode
  const exitInlinePractice = page.exitInlinePractice
  const pageHandleMindMapNodeActive = page.handleMindMapNodeActive
  const lastBuildActivationRef = useRef<number | null>(null)
  const handleMindMapNodeActive = useCallback((nodes: MindMapSelection[]) => {
    pageHandleMindMapNodeActive(nodes)
  }, [pageHandleMindMapNodeActive])
  useEffect(() => {
    if (!isActive || lastBuildActivationRef.current === becameActiveAt) return
    lastBuildActivationRef.current = becameActiveAt
    setMindMapTask('build')
    if (editorMode !== 'edit') exitInlinePractice()
  }, [becameActiveAt, editorMode, exitInlinePractice, isActive, setMindMapTask])

  const permanentMarkChips = useMemo(() => {
    const doc = page.editorState?.editor_doc as EditorDoc | null | undefined
    const marked = collectPermanentMarkUids(doc)
    const parentMap = buildEditorParentMap(doc)
    const rootData =
      doc?.root?.data && typeof doc.root.data === 'object'
        ? (doc.root.data as Record<string, unknown>)
        : {}
    const rootUid = String(rootData.uid || rootData.memoryAnkiId || 'root')
    const levels = derivePermanentMarkLevels(marked, parentMap, rootUid)
    const chips: Record<
      string,
      Array<{ text: string; tone: 'warning' | 'info' | 'success' | 'danger' | 'neutral'; style: 'filled' }>
    > = {}
    for (const [uid, level] of levels.entries()) {
      const color = colorForPermanentLevel(level)
      chips[uid] = [{ text: color.label, tone: level === 1 ? 'warning' : level === 2 ? 'info' : 'success', style: 'filled' }]
    }
    return chips
  }, [page.editorState])

  const permanentMarkHighlights = useMemo(
    () => Object.keys(permanentMarkChips),
    [permanentMarkChips],
  )

  const handlePermanentMarkClick = useCallback(
    (nodes: MindMapSelection[]) => {
      const uid = nodes[0]?.uid
      if (!uid || !page.editorState) return
      const doc = page.editorState.editor_doc as EditorDoc
      const result = togglePermanentMarkInDoc(doc, String(uid))
      if (result.doc === doc) return
      // Keep marks local + plain autosave while still in mark mode; reconcile only
      // when exiting permanent-mark mode or leaving the editor.
      page.handleMindMapEditorStateChange({
        ...page.editorState,
        editor_doc: result.doc,
      })
      toast.success(result.marked ? '已添加永久标记（层级自动）' : '已取消永久标记')
    },
    [page],
  )

  const handleTogglePermanentMarkMode = useCallback(() => {
    setPermanentMarkMode((current) => {
      const next = !current
      if (current && !next) {
        // Finished this mark pass: one reconcile for the whole batch.
        void page.flushSaveWithReconcile('mark_change', { reconcileUnits: true })
        toast.success(
          permanentMarkHighlights.length
            ? `已退出永久标记（已标 ${permanentMarkHighlights.length}）；复习进度整理中`
            : '已退出永久标记；复习进度整理中',
        )
      } else {
        toast.success(
          next
            ? permanentMarkHighlights.length
              ? `永久标记中：已显示 ${permanentMarkHighlights.length} 个 L 级标记，点击即保存；退出标记或离开后进入复习`
              : '永久标记：点击即保存；退出标记或离开页面后进入复习列表'
            : '已退出永久标记',
        )
      }
      return next
    })
  }, [page, permanentMarkHighlights.length])

  const recallModeActive = page.editorMode === 'recall'
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
  const textToMindMapAction = {
    label: '文字转脑图',
    onClick: () => {
      void readClipboardTextForMindMapImport().then((text) => {
        mindMapImport.openManualJsonPreview(text)
      })
    },
    opensOverlay: true,
  }
  const fileTransferActions = mindMapFileTransfer.toolbarActions.flatMap((action) =>
    action.label === '复制导图' ? [action, textToMindMapAction] : [action],
  )
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
    | 'moreActions'
    | 'importMindMapAction'
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
      // Global palace lookup (list + mind-map preview), not in-palace node search.
      value: '',
      onChange: () => setMemoryLookupOpen(true),
      onFocus: () => setMemoryLookupOpen(true),
      onClick: () => setMemoryLookupOpen(true),
      readOnly: true,
      placeholder: '搜索全局记忆宫殿…',
    },
    focusAction: selectedNodeUid
      ? {
          label: '聚焦节点',
          onClick: () => mindMapFrameRef.current?.focusNode(selectedNodeUid),
        }
      : null,
    moreActions: [
      {
        label: '文章导入 / 导出',
        onClick: () => articleTransfer.setOpen(true),
        disabled: articleTransfer.busy || Boolean(page.pendingConflict),
        opensOverlay: true,
      },
      {
        label: '恢复点',
        onClick: () => { void page.handleOpenVersions() },
        opensOverlay: true,
      },
      {
        label: permanentMarkMode
          ? `退出永久标记${permanentMarkHighlights.length ? `（已标 ${permanentMarkHighlights.length}）` : ''}`
          : permanentMarkHighlights.length
            ? `永久标记（已标 ${permanentMarkHighlights.length}）`
            : '永久标记',
        onClick: handleTogglePermanentMarkMode,
      },
      {
        label: '复习进度',
        onClick: () => {
          if (!page.palaceId) {
            toast.message('当前没有可查看的宫殿')
            return
          }
          setReviewUnitsPanelOpen(true)
        },
      },
      {
        label: `结构检查（${mindMapExperience.structureIssues.length}）`,
        onClick: () => {
          const issue = mindMapExperience.structureIssues[0]
          if (!issue) return toast.success('未发现结构问题')
          mindMapFrameRef.current?.focusNode(issue.nodeUid)
          toast.warning(issue.message)
        },
      },
      ...fileTransferActions,
      quizBindingsHost.moreAction,
    ],
    importMindMapAction: null,
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
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <MindMapDocumentConflictDialog pendingConflict={page.pendingConflict} resolveConflict={page.resolveConflict} />
      <ArticleTransferDialog transfer={articleTransfer} />
      {mindMapFileTransfer.input}
      <PalaceMemoryLookupDialog
        open={memoryLookupOpen}
        onOpenChange={setMemoryLookupOpen}
        currentPalaceId={page.palaceId}
      />
      {!page.mindMapFullscreen ? (
        <PageIntro
          compact
          collapsible
          title={page.palace?.title || '宫殿编辑器'}
          actions={
            <>
              {page.palace ? (
                <>
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

      {page.palace ? (
        <PalaceKnowledgeWorkspaceProvider
          palace={page.palace}
          activeKey={activeMindMapKey}
          onActiveKeyChange={setActiveMindMapKey}
          onReload={page.reload}
        >
          <MindMapSplitLayout
            collapsed={sidePanelCollapsed}
            onCollapsedChange={setSidePanelCollapsed}
            hidden={page.mindMapFullscreen}
            collapseLabel="收起学科与绑定"
            expandLabel="展开学科与绑定"
            sidePanel={(
              <div className="space-y-3 p-0.5">
                <PalaceKnowledgeBindingCard />
                <PalaceMetaPanel
                  palace={page.palace}
                  title={page.title}
                  createdAt={page.createdAt}
                  onTitleChange={page.setTitle}
                  onCreatedAtChange={page.setCreatedAt}
                  onSave={page.handleSaveMeta}
                  onEstablishCreatedAt={page.handleEstablishCreatedAt}
                />
                <PalaceAttachmentPanel
                  palace={page.palace}
                  onUpload={page.handleAttachmentUpload}
                  onDelete={page.handleAttachmentDelete}
                />
              </div>
            )}
          >
            <section className="flex min-h-0 flex-1 flex-col">
              {activeMindMapKey === 'palace' ? (
                <Card
                  className={cn(
                    'flex min-h-0 flex-1 flex-col border-border/70 bg-card/92',
                    page.mindMapFullscreen &&
                      'fixed inset-0 z-[90] min-h-0 rounded-none bg-card/96 shadow-2xl',
                  )}
                >
                  <CardContent
                    className={cn(
                      'flex min-h-0 flex-1 flex-col p-0',
                      page.mindMapFullscreen && 'h-full',
                    )}
                  >
                    {activeFrameEditorState ? (
                      <div className="flex h-full min-h-0 flex-col gap-2">
                        {mindMapExperience.task === 'learn' ? (
                          <div className="grid shrink-0 gap-2 rounded-xl border bg-muted/15 p-3 sm:grid-cols-2 lg:grid-cols-3">
                            <button type="button" className="rounded-xl border bg-background p-3 text-left hover:border-primary" onClick={() => page.enterInlinePractice()}><div className="font-medium">主动回忆</div><div className="mt-1 text-xs text-muted-foreground">连续揭示并回忆整张脑图</div></button>
                            <button type="button" className="rounded-xl border bg-background p-3 text-left hover:border-primary" onClick={() => navigate(`/freestyle?palaceId=${page.palaceId}`)}><div className="font-medium">开始随心复习</div><div className="mt-1 text-xs text-muted-foreground">在随心模式中复习当前宫殿</div></button>
                            <button type="button" className="rounded-xl border bg-background p-3 text-left hover:border-primary" onClick={handleOpenQuizPage}><div className="font-medium">做题训练</div><div className="mt-1 text-xs text-muted-foreground">基于当前宫殿进入题目训练</div></button>
                          </div>
                        ) : null}
                        <FlipCardMindMapPanel
                          ref={mindMapFrameRef}
                          // Keep one mind-map host mounted across build/learn so fullscreen and ReactFlow survive.
                          displayMode={recallModeActive ? 'review' : 'edit'}
                          editorReadonly={Boolean(page.pendingConflict) || articleTransfer.busy}
                          fullscreen={page.mindMapFullscreen}
                          sessionKind="practice"
                          modeSyncVersion={page.replaceSyncVersion + mindMapImport.importAppliedSyncVersion}
                          viewMemoryScope={page.palaceId ? `palace-edit:${page.palaceId}` : null}
                          toolbarExtensions={mindMapToolbarExtensions}
                          revealSettings={page.flipCardRevealSettings}
                          hidePresentationOverflowActions
                          visibleEditorState={activeFrameEditorState}
                          editableEditorState={page.editorState}
                          visibleEditorSyncKey={page.practiceVisibleEditorSyncKey}
                          hostForceSyncKey={`edit:${page.replaceSyncVersion}:${mindMapImport.importAppliedSyncVersion}`}
                          hostExternalSyncKey={mindMapImport.importExternalSyncKey}
                          // Keep camera continuity across build/learn/recall; canvas re-anchors the center card.
                          preserveViewOnSync
                          initialViewPolicy="preserve"
                          forceSyncIntent="soft"
                          reviewFxSignal={page.reviewFxSignal}
                          feedbackFxSignal={page.feedbackFxSignal}
                          statusChipsByNodeUid={
                            permanentMarkMode || permanentMarkHighlights.length
                              ? permanentMarkChips
                              : undefined
                          }
                          highlightedNodeUids={
                            permanentMarkHighlights.length
                              ? permanentMarkHighlights
                              : mindMapExperience.highlightedNodeUids
                          }
                          countBadgeByNodeUid={quizBindingsHost.countBadgeByNodeUid}
                          onCountBadgeClick={quizBindingsHost.openNodeQuiz}
                          confirmDeleteNodes={quizBindingsHost.confirmDeleteNodes}
                          focusRequestNodeUid={page.modeFocusRequestNodeUid}
                          focusRequestNonce={page.modeFocusRequestNonce}
                          onEditorStateChange={(state) => { if (!articleTransfer.busy) page.handleMindMapEditorStateChange(state) }}
                          onNodeActive={handleMindMapNodeActive}
                          onNodeClick={page.handleInlinePracticeNodeClick}
                          onNodeContextMenu={page.handleInlinePracticeNodeContextMenu}
                          onEditNodeClick={
                            permanentMarkMode && !recallModeActive
                              ? handlePermanentMarkClick
                              : undefined
                          }
                          onNativeFullscreenChange={setMindMapNativeFullscreen}
                          onToggleFullscreen={page.toggleMindMapFullscreen}
                          onUiClearedChange={setMindMapUiCleared}
                          className="flex min-h-0 flex-1 flex-col"
                          surfaceClassName="h-full min-h-0 w-full flex-1 rounded-lg border border-border/70 bg-zinc-50"
                        />
                      </div>
                    ) : (
                      <PalaceEditorSkeleton />
                    )}
                  </CardContent>
                </Card>
              ) : (
                <PalaceSubjectMindMapCard />
              )}
            </section>
          </MindMapSplitLayout>
        </PalaceKnowledgeWorkspaceProvider>
      ) : null}

      <MindMapImportDrawer
        open={mindMapImport.importOpen}
        onOpenChange={mindMapImport.setImportOpen}
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
            className="h-full w-full rounded-[inherit] bg-zinc-50"
          />
        )}
        targetNodeLabel={selectedNodeLabel}
        canAppend={mindMapImport.importCanAppend}
        canUndoLastImport={mindMapImport.importCanUndoLastImport}
        manualImportText={mindMapImport.manualImportText}
        onManualImportTextChange={mindMapImport.setManualImportText}
        manualImportFileName={mindMapImport.manualImportFileName}
        manualImportFormatPrompt={mindMapImport.manualImportFormatPrompt}
        onManualImportParse={mindMapImport.handleManualImportParse}
        onManualImportFileChange={(event) => void mindMapImport.handleManualImportFileChange(event)}
        onApplyReplace={mindMapImport.handleImportApplyReplace}
        onApplyAppend={mindMapImport.handleImportApplyAppend}
        onUndoLastImport={mindMapImport.handleUndoLastImport}
        className={page.mindMapFullscreen ? 'z-[130]' : 'z-[120]'}
        overlayClassName={page.mindMapFullscreen ? 'z-[120]' : 'z-[110]'}
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

      <PalaceTemplateDialog
        open={templateDialogOpen}
        onOpenChange={setTemplateDialogOpen}
        onCreated={(palaceId) => navigate(`/palaces/${palaceId}/edit`, { replace: true })}
      />

      {quizBindingsHost.dialogs}

      {page.palaceId ? (
        <PalaceReviewUnitsPanel
          open={reviewUnitsPanelOpen}
          palaceId={page.palaceId}
          onClose={() => setReviewUnitsPanelOpen(false)}
        />
      ) : null}

    </div>
  )
}
