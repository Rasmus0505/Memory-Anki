import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { FolderTree, Plus, Save, Sparkles, Trash2 } from 'lucide-react'
import { toast } from '@/shared/feedback/toast'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import { EmptyState } from '@/shared/components/state-placeholders'
import {
  MindMapFrame,
  MindMapPageToolbar,
  type MindMapFrameHandle,
  type MindMapSelection,
} from '@/shared/components/mindmap-host'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { usePersistedMindMapEditor } from '@/shared/hooks/usePersistedMindMapEditor'
import { useProgrammaticEditorStateGuard } from '@/shared/hooks/useProgrammaticEditorStateGuard'
import { applyProgrammaticEditorState } from '@/shared/lib/applyProgrammaticEditorState'
import { cn } from '@/shared/lib/utils'
import { KnowledgeChapterQuizDialog } from '@/features/knowledge/components/KnowledgeChapterQuizDialog'
import { KnowledgeMindMapImportDrawer } from '@/features/knowledge/components/KnowledgeMindMapImportDrawer'
import { useMindMapImport, type ImportApplyContext } from '@/features/mindmap-import'
import {
  createSubjectApi,
  deleteChapterApi,
  DeleteChapterImpactError,
  deleteSubjectApi,
  getChapterApi,
  getSubjectEditorApi,
  getSubjectsApi,
  saveSubjectEditorApi,
  type ChapterDetailResponse,
  type SubjectSummary,
  updateSubjectApi,
} from '@/entities/knowledge/api'
import {
  batchCreateChapterQuizQuestionsApi,
  previewChapterQuizGenerationFromOutlineApi,
} from '@/entities/quiz/api'
import type {
  PalaceQuizGenerationPreview,
  PalaceQuizQuestionDraft,
  PalaceQuizQuestionType,
} from '@/shared/api/contracts'

type ChapterDetail = ChapterDetailResponse

export default function Knowledge() {
  const mindMapFrameRef = useRef<MindMapFrameHandle | null>(null)
  const [subjects, setSubjects] = useState<SubjectSummary[]>([])
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | null>(null)
  const [subjectName, setSubjectName] = useState('')
  const [subjectColor, setSubjectColor] = useState('#6366f1')
  const [newSubjectName, setNewSubjectName] = useState('')
  const [selectedNodes, setSelectedNodes] = useState<MindMapSelection[]>([])
  const [chapterDetail, setChapterDetail] = useState<ChapterDetail | null>(null)
  const [mindMapFullscreen, setMindMapFullscreen] = useState(false)
  const [mindMapNativeFullscreen, setMindMapNativeFullscreen] = useState(false)
  const [mindMapUiCleared, setMindMapUiCleared] = useState(false)
  const [chapterQuizDialogOpen, setChapterQuizDialogOpen] = useState(false)
  const [chapterQuizQuestionTypes, setChapterQuizQuestionTypes] = useState<PalaceQuizQuestionType[]>([
    'multiple_choice',
    'short_answer',
  ])
  const [chapterQuizQuestionCount, setChapterQuizQuestionCount] = useState(5)
  const [chapterQuizExtraPrompt, setChapterQuizExtraPrompt] = useState('')
  const [chapterQuizClassify, setChapterQuizClassify] = useState(false)
  const [chapterQuizPreview, setChapterQuizPreview] = useState<PalaceQuizGenerationPreview | null>(null)
  const [chapterQuizLoading, setChapterQuizLoading] = useState(false)
  const [chapterQuizSaving, setChapterQuizSaving] = useState(false)

  const selectedNodeUid =
    selectedNodes?.[0]?.uid ||
    (selectedNodes?.[0]?.rawData?.uid as string | undefined) ||
    (selectedNodes?.[0]?.rawData?.data as Record<string, unknown> | undefined)?.uid as string | undefined

  const selectedNodeLabel = selectedNodes?.[0]?.text ?? ''

  const selectedNode = selectedNodes[0] ?? null
  const selectedChapterId = selectedNode?.memoryAnkiNodeType === 'chapter' ? selectedNode.memoryAnkiId : null

  const {
    meta,
    setMeta,
    editorState,
    setEditorState,
    replaceEditorState,
    adoptExternalState,
    isLoading,
    isSaving,
    error,
    reload,
    flushSave,
  } = usePersistedMindMapEditor({
    entityId: selectedSubjectId,
    fetcher: getSubjectEditorApi,
    saver: saveSubjectEditorApi,
    selectMeta: (response) => response.subject,
    selectEditorState: (response) => ({
      editor_doc: response.editor_doc,
      editor_config: response.editor_config,
      editor_local_config: response.editor_local_config,
      lang: response.lang,
      editor_fingerprint: response.editor_fingerprint,
    }),
  })
  const programmaticGuard = useProgrammaticEditorStateGuard()
  const importEntityKey = useMemo(
    () => (selectedSubjectId ? `subject_${selectedSubjectId}` : null),
    [selectedSubjectId],
  )
  const selectedSubjectMeta =
    (meta as SubjectSummary | null)?.id === selectedSubjectId ? (meta as SubjectSummary | null) : null
  const activeSubject = selectedSubjectMeta ?? subjects.find((item) => item.id === selectedSubjectId) ?? null
  const isSubjectEditorReady = Boolean(
    selectedSubjectId &&
      selectedSubjectMeta?.id === selectedSubjectId &&
      editorState &&
      !isLoading,
  )
  const applyImportedSubjectEditorState = useCallback(
    async (nextState: MindMapEditorState, context?: ImportApplyContext) => {
      if (!selectedSubjectId) {
        throw new Error('当前还没有选中学科，暂时无法应用导入结果。')
      }
      await applyProgrammaticEditorState({
        previousState: editorState,
        nextState,
        context,
        flushPendingSaves: flushSave,
        beginProtectedWrite: (protectedState) => {
          programmaticGuard.beginGuard(protectedState, 2500)
        },
        releaseProtectedWrite: programmaticGuard.releaseGuard,
        optimisticApply: replaceEditorState,
        rollback: replaceEditorState,
        adoptSavedState: (savedState) => {
          adoptExternalState(savedState, { protectFromStaleLoads: true, releaseAfterMs: 4000 })
        },
        save: () => saveSubjectEditorApi(selectedSubjectId, nextState),
        selectSavedEditorState: (response) => ({
          editor_doc: response.editor_doc,
          editor_config: response.editor_config,
          editor_local_config: response.editor_local_config,
          lang: response.lang,
          editor_fingerprint: response.editor_fingerprint,
        }),
        afterSave: (response) => {
          setMeta(response.subject)
        },
        reload,
      })
    },
    [adoptExternalState, editorState, flushSave, programmaticGuard, reload, replaceEditorState, selectedSubjectId, setMeta],
  )
  const mindMapImport = useMindMapImport({
    entityKey: importEntityKey,
    editorState,
    setEditorState,
    applyEditorState: applyImportedSubjectEditorState,
    selectedNodeUid,
  })

  useEffect(() => {
    void getSubjectsApi().then((items) => {
      setSubjects(items)
      setSelectedSubjectId((current) => current ?? items[0]?.id ?? null)
    })
  }, [])

  useEffect(() => {
    if (!activeSubject) return
    setSubjectName(activeSubject.name)
    setSubjectColor(activeSubject.color || '#6366f1')
  }, [activeSubject])

  useEffect(() => {
    if (!selectedChapterId) {
      setChapterDetail(null)
      return
    }
    void getChapterApi(selectedChapterId).then(setChapterDetail)
  }, [selectedChapterId])

  const selectedPalaces = useMemo(() => chapterDetail?.palaces ?? [], [chapterDetail])
  const selectedChildChapters = useMemo(() => chapterDetail?.chapter.children ?? [], [chapterDetail])
  const canClassifyChapterQuiz = selectedChildChapters.length > 0

  const buildChapterQuizPayloads = useCallback((preview: PalaceQuizGenerationPreview): PalaceQuizQuestionDraft[] => {
    const grouped = preview.grouped_questions
    if (grouped && 'child_chapter_groups' in grouped) {
      const assigned = grouped.child_chapter_groups.flatMap((group) =>
        group.questions.map((question) => ({
          ...question,
          source_chapter_id: preview.chapter_id ?? selectedChapterId ?? null,
          classified_chapter_id: group.classified_chapter_id,
          mini_palace_id: null,
        })),
      )
      const unassigned = grouped.unassigned_questions.map((question) => ({
        ...question,
        source_chapter_id: preview.chapter_id ?? selectedChapterId ?? null,
        classified_chapter_id: null,
        mini_palace_id: null,
      }))
      return [...assigned, ...unassigned]
    }
    return (preview.questions || []).map((question) => ({
      ...question,
      source_chapter_id: preview.chapter_id ?? selectedChapterId ?? null,
      classified_chapter_id: null,
      mini_palace_id: null,
    }))
  }, [selectedChapterId])

  const refreshSubjects = async (nextSelectedId?: number | null) => {
    const items = await getSubjectsApi()
    setSubjects(items)
    if (typeof nextSelectedId === 'number' || nextSelectedId === null) {
      setSelectedSubjectId(nextSelectedId)
      return
    }
    if (selectedSubjectId && items.some((item) => item.id === selectedSubjectId)) return
    setSelectedSubjectId(items[0]?.id ?? null)
  }

  const handleCreateSubject = async () => {
    const name = newSubjectName.trim()
    if (!name) return
    const subject = await createSubjectApi({ name, color: '#6366f1' })
    setNewSubjectName('')
    await refreshSubjects(subject.id)
  }

  const handleSaveSubject = async () => {
    if (!activeSubject) return
    const nextName = subjectName.trim()
    if (!nextName) return
    await updateSubjectApi(activeSubject.id, { name: nextName, color: subjectColor })
    await refreshSubjects(activeSubject.id)
    await reload()
  }

  const handleDeleteSubject = async () => {
    if (!activeSubject) return
    await deleteSubjectApi(activeSubject.id)
    setSelectedNodes([])
    setChapterDetail(null)
    await refreshSubjects(null)
  }

  const handleDeleteChapter = async () => {
    if (!selectedChapterId || !chapterDetail) return
    try {
      await deleteChapterApi(selectedChapterId)
      toast.success('章节已删除')
      setSelectedNodes([])
      setChapterDetail(null)
      await reload()
    } catch (error) {
      if (error instanceof DeleteChapterImpactError) {
        const impact = error.impact
        const confirmed = window.confirm(
          `该章节及其子章节共 ${impact.chapter_count} 个，关联了 ${impact.linked_palace_count} 个宫殿、${impact.question_count} 道题目。删除后题目将一并删除且不可恢复，确定删除吗？`,
        )
        if (!confirmed) return
        try {
          await deleteChapterApi(selectedChapterId, { force: true })
          toast.success('章节已删除')
          setSelectedNodes([])
          setChapterDetail(null)
          await reload()
        } catch (forceError) {
          toast.error(forceError instanceof Error ? forceError.message : '删除章节失败')
        }
        return
      }
      toast.error(error instanceof Error ? error.message : '删除章节失败')
    }
  }

  const handleToggleChapterQuizType = (questionType: PalaceQuizQuestionType) => {
    setChapterQuizQuestionTypes((current) => {
      if (current.includes(questionType)) {
        return current.length === 1 ? current : current.filter((item) => item !== questionType)
      }
      return [...current, questionType]
    })
  }

  const handleOpenChapterQuizDialog = () => {
    setChapterQuizPreview(null)
    setChapterQuizExtraPrompt('')
    setChapterQuizClassify(false)
    setChapterQuizDialogOpen(true)
  }

  const handleGenerateChapterQuiz = async () => {
    if (!selectedChapterId) return
    setChapterQuizLoading(true)
    try {
      const preview = await previewChapterQuizGenerationFromOutlineApi(selectedChapterId, {
        question_types: chapterQuizQuestionTypes,
        question_count: chapterQuizQuestionCount,
        extra_prompt: chapterQuizExtraPrompt,
        classify_by_child_chapter: chapterQuizClassify && canClassifyChapterQuiz,
      })
      setChapterQuizPreview(preview)
      toast.success(`已生成 ${preview.questions.length} 道章节题预览`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '章节题生成失败')
    } finally {
      setChapterQuizLoading(false)
    }
  }

  const handleSaveChapterQuiz = async () => {
    if (!selectedChapterId || !chapterQuizPreview) return
    setChapterQuizSaving(true)
    try {
      const payloads = buildChapterQuizPayloads(chapterQuizPreview)
      const response = await batchCreateChapterQuizQuestionsApi(selectedChapterId, payloads)
      toast.success(`已保存 ${response.items.length} 道章节题`)
      setChapterQuizDialogOpen(false)
      setChapterQuizPreview(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '章节题保存失败')
    } finally {
      setChapterQuizSaving(false)
    }
  }

  const renderStatus = () => {
    if (error) return <Badge variant="destructive">保存异常</Badge>
    if (selectedSubjectId && !isSubjectEditorReady) return <Badge variant="secondary">加载中</Badge>
    if (!editorState) return <Badge variant="secondary">加载中</Badge>
    if (isSaving) return <Badge variant="secondary">自动保存中</Badge>
    return <Badge variant="secondary">已接入 mind-map 宿主模式</Badge>
  }

  const handleImmersiveToolbarToggle = async () => {
    if (mindMapNativeFullscreen) {
      await mindMapFrameRef.current?.exitNativeFullscreen()
      setMindMapFullscreen(true)
      return
    }
    setMindMapFullscreen((current) => !current)
  }

  const handleNativeFullscreenToolbarToggle = async () => {
    if (mindMapNativeFullscreen) {
      await mindMapFrameRef.current?.exitNativeFullscreen()
      return
    }
    if (mindMapFullscreen) {
      setMindMapFullscreen(false)
    }
    await mindMapFrameRef.current?.enterNativeFullscreen()
  }

  return (
    <div className="space-y-5">
      {!mindMapFullscreen ? (
        <PageIntro
          title="知识树编辑器"
          actions={
            <>
              {renderStatus()}
            </>
          }
        />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="border-border/70 bg-card/92">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FolderTree className="size-4" />
              学科
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              {subjects.map((subject) => (
                <button
                  key={subject.id}
                  type="button"
                  onClick={() => {
                    setSelectedSubjectId(subject.id)
                    setSelectedNodes([])
                    setChapterDetail(null)
                  }}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-3 text-left transition-colors ${
                    selectedSubjectId === subject.id
                      ? 'border-primary/40 bg-primary/8 text-foreground'
                      : 'border-border/70 bg-background/70 text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: subject.color || '#6366f1' }} />
                    <span className="font-medium">{subject.name}</span>
                  </span>
                  {selectedSubjectId === subject.id ? <Badge variant="secondary">当前</Badge> : null}
                </button>
              ))}
            </div>

            <div className="space-y-2 rounded-lg border border-dashed border-border/80 bg-background/50 p-3">
              <Label htmlFor="new-subject">新增学科</Label>
              <Input
                id="new-subject"
                value={newSubjectName}
                onChange={(event) => setNewSubjectName(event.target.value)}
                placeholder="例如：英语语法"
              />
              <Button type="button" className="w-full" onClick={handleCreateSubject}>
                <Plus className="mr-2 size-4" />
                创建学科
              </Button>
            </div>

            <div className="space-y-3 rounded-lg border border-border/70 bg-background/60 p-3">
              <div className="text-sm font-semibold">当前学科</div>
              <div className="space-y-2">
                <Label htmlFor="subject-name">名称</Label>
                <Input
                  id="subject-name"
                  value={subjectName}
                  onChange={(event) => setSubjectName(event.target.value)}
                  disabled={!activeSubject}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="subject-color">颜色</Label>
                <Input
                  id="subject-color"
                  type="color"
                  value={subjectColor}
                  onChange={(event) => setSubjectColor(event.target.value)}
                  disabled={!activeSubject}
                />
              </div>
              <div className="flex gap-2">
                <Button type="button" className="flex-1" onClick={handleSaveSubject} disabled={!activeSubject}>
                  <Save className="mr-2 size-4" />
                  保存学科信息
                </Button>
                <Button type="button" variant="outline" onClick={handleDeleteSubject} disabled={!activeSubject}>
                  <Trash2 className="mr-2 size-4" />
                  删除
                </Button>
              </div>
            </div>

            <div className="space-y-4 rounded-lg border border-border/70 bg-background/60 p-3">
              <div className="text-sm font-semibold">当前章节</div>
              {chapterDetail ? (
                <>
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">{chapterDetail.chapter.name}</div>
                        {chapterDetail.chapter.breadcrumbs.length > 0 ? (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {chapterDetail.chapter.breadcrumbs.map((item) => item.name).join(' / ')}
                          </div>
                        ) : null}
                      </div>
                      <Button type="button" size="sm" variant="outline" onClick={handleDeleteChapter}>
                        <Trash2 className="mr-2 size-4" />
                        删除章节
                      </Button>
                    </div>
                  </div>
                  <div className="rounded-lg bg-background/70 p-3 text-sm text-muted-foreground whitespace-pre-wrap">
                    {chapterDetail.chapter.notes || '该章节暂时没有备注。'}
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold">关联宫殿</div>
                      <div className="flex items-center gap-2">
                        {selectedChapterId ? (
                          <Button size="sm" variant="outline" onClick={handleOpenChapterQuizDialog}>
                            <Sparkles className="mr-2 size-4" />
                            AI 出题
                          </Button>
                        ) : null}
                        {selectedChapterId ? (
                          <Link to={`/review?chapterId=${selectedChapterId}`}>
                            <Button size="sm" variant="outline">开始章节复习</Button>
                          </Link>
                        ) : null}
                      </div>
                    </div>
                    {selectedPalaces.length > 0 ? (
                      <div className="space-y-2">
                        {selectedPalaces.map((palace) => (
                          <Link
                            key={palace.id}
                            to={`/palaces/${palace.id}`}
                            className="flex items-center justify-between rounded-lg border border-border/70 bg-background/70 px-3 py-3 text-sm transition-colors hover:text-foreground"
                          >
                            <span>{palace.title}</span>
                            <span className="flex flex-wrap items-center justify-end gap-2">
                              {palace.mastered ? (
                                <Badge variant="secondary">已掌握</Badge>
                              ) : palace.review_stage_total > 0 ? (
                                <Badge variant="outline">
                                  复习 {palace.review_stage_completed}/{palace.review_stage_total}
                                </Badge>
                              ) : null}
                              {palace.next_due_date ? (
                                <span className="text-xs text-muted-foreground">下次 {palace.next_due_date}</span>
                              ) : null}
                              <span className="text-xs text-muted-foreground">查看宫殿</span>
                            </span>
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        variant="link"
                        title="当前章节还没有关联任何宫殿"
                        description="关联宫殿后，可以在此快速跳转复习。"
                      />
                    )}
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-dashed border-border/80 px-3 py-6 text-sm text-muted-foreground">
                  选中一个章节节点后，这里会显示章节信息。
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card
          className={cn(
            'min-h-[72vh] border-border/70 bg-card/92',
            mindMapFullscreen && 'fixed inset-x-5 bottom-5 top-5 z-[90] min-h-0 bg-card/96 shadow-2xl',
          )}
        >
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">{activeSubject?.name ?? '选择一个学科'}</CardTitle>
            </div>
            {selectedChapterId ? <Badge variant="secondary">章节 #{selectedChapterId}</Badge> : null}
          </CardHeader>
          <CardContent className={cn('min-h-[62vh]', mindMapFullscreen && 'h-[calc(100vh-108px)] min-h-0')}>
            {isSubjectEditorReady && editorState ? (
              <div className="flex h-full min-h-0 flex-col gap-3">
                <MindMapPageToolbar
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
                  immersiveAction={{
                    label: '半屏编辑',
                    active: mindMapFullscreen,
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
                  key={`subject-frame:${selectedSubjectId}:${mindMapImport.importAppliedSyncVersion}`}
                  editorState={editorState}
                  immersiveModeActive={mindMapFullscreen}
                  viewMemoryScope={
                    selectedSubjectId ? `knowledge-subject:${selectedSubjectId}` : null
                  }
                  syncOnPropChange
                  syncIntent="soft"
                  externalSyncKey={mindMapImport.importExternalSyncKey}
                  forceSyncKey={`subject:${selectedSubjectId}:${mindMapImport.importAppliedSyncVersion}`}
                  forceSyncIntent="replace"
                  initialViewPolicy="reset"
                  onEditorStateChange={(nextState: MindMapEditorState) => {
                    if (programmaticGuard.shouldBlockIncomingState(nextState)) return
                    setEditorState(nextState)
                  }}
                  onNodeActive={setSelectedNodes}
                  onFullscreenToggle={setMindMapFullscreen}
                  onFullscreenChange={setMindMapNativeFullscreen}
                  onUiClearedChange={setMindMapUiCleared}
                  className={cn(
                    'w-full flex-1 rounded-lg border border-border/70 bg-background',
                    mindMapFullscreen ? 'h-full' : 'h-[62vh]',
                  )}
                />
              </div>
            ) : (
              <div className="flex h-[62vh] items-center justify-center rounded-lg border border-dashed border-border/80 bg-background/60 text-sm text-muted-foreground">
                {selectedSubjectId ? '正在加载当前学科的脑图…' : '先创建或选择一个学科，宿主编辑器才会加载。'}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <KnowledgeMindMapImportDrawer mindMapImport={mindMapImport} targetNodeLabel={selectedNodeLabel} />

      <KnowledgeChapterQuizDialog
        open={chapterQuizDialogOpen}
        onOpenChange={setChapterQuizDialogOpen}
        questionTypes={chapterQuizQuestionTypes}
        onToggleQuestionType={handleToggleChapterQuizType}
        questionCount={chapterQuizQuestionCount}
        onQuestionCountChange={setChapterQuizQuestionCount}
        classify={chapterQuizClassify}
        onClassifyChange={setChapterQuizClassify}
        canClassify={canClassifyChapterQuiz}
        childChapterCount={selectedChildChapters.length}
        extraPrompt={chapterQuizExtraPrompt}
        onExtraPromptChange={setChapterQuizExtraPrompt}
        preview={chapterQuizPreview}
        loading={chapterQuizLoading}
        saving={chapterQuizSaving}
        onGenerate={handleGenerateChapterQuiz}
        onSave={handleSaveChapterQuiz}
      />
    </div>
  )
}
