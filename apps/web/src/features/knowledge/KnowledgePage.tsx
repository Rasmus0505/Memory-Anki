import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { FileText, FolderTree, Plus, Save, Trash2, Upload } from 'lucide-react'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import {
  MindMapFrame,
  type MindMapSelection,
} from '@/shared/components/mindmap-host'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { usePersistedMindMapEditor } from '@/shared/hooks/usePersistedMindMapEditor'
import { PalaceMindMapImportDrawer } from '@/features/palace-edit/components/PalaceMindMapImportDrawer'
import { useMindMapImport } from '@/features/palace-edit/hooks/useMindMapImport'
import {
  createSubjectApi,
  deleteSubjectApi,
  getChapterApi,
  getSubjectEditorApi,
  getSubjectsApi,
  saveSubjectEditorApi,
  updateSubjectApi,
} from '@/shared/api/modules/knowledge'

interface Subject {
  id: number
  name: string
  color: string
  sort_order: number
}

interface ChapterDetail {
  chapter: {
    id: number
    name: string
    notes: string
    breadcrumbs: Array<{ id: number; name: string }>
  }
  palaces: Array<{ id: number; title: string }>
}

export default function Knowledge() {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | null>(null)
  const [subjectName, setSubjectName] = useState('')
  const [subjectColor, setSubjectColor] = useState('#6366f1')
  const [newSubjectName, setNewSubjectName] = useState('')
  const [selectedNodes, setSelectedNodes] = useState<MindMapSelection[]>([])
  const [chapterDetail, setChapterDetail] = useState<ChapterDetail | null>(null)

  const selectedNodeUid =
    selectedNodes?.[0]?.uid ||
    (selectedNodes?.[0]?.rawData?.uid as string | undefined) ||
    (selectedNodes?.[0]?.rawData?.data as Record<string, unknown> | undefined)?.uid as string | undefined

  const selectedNodeLabel = selectedNodes?.[0]?.text ?? ''

  const selectedNode = selectedNodes[0] ?? null
  const selectedChapterId = selectedNode?.memoryAnkiNodeType === 'chapter' ? selectedNode.memoryAnkiId : null

  const {
    meta,
    editorState,
    setEditorState,
    isSaving,
    error,
    reload,
  } = usePersistedMindMapEditor({
    entityId: selectedSubjectId,
    fetcher: getSubjectEditorApi,
    saver: saveSubjectEditorApi,
    selectMeta: (response) => response.subject as Subject,
    selectEditorState: (response) => ({
      editor_doc: response.editor_doc,
      editor_config: response.editor_config,
      editor_local_config: response.editor_local_config,
      lang: response.lang,
    }),
  })
  const importEntityKey = useMemo(
    () => (selectedSubjectId ? `subject_${selectedSubjectId}` : null),
    [selectedSubjectId],
  )
  const activeSubject = (meta as Subject | null) ?? subjects.find((item) => item.id === selectedSubjectId) ?? null
  const mindMapImport = useMindMapImport({
    entityKey: importEntityKey,
    editorState,
    setEditorState,
    selectedNodeUid,
    subjectOptions: activeSubject ? [{ id: activeSubject.id, name: activeSubject.name }] : [],
    defaultSubjectId: selectedSubjectId,
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
    setSubjectColor(activeSubject.color)
  }, [activeSubject])

  useEffect(() => {
    if (!selectedChapterId) {
      setChapterDetail(null)
      return
    }
    void getChapterApi(selectedChapterId).then(setChapterDetail)
  }, [selectedChapterId])

  const selectedPalaces = useMemo(() => chapterDetail?.palaces ?? [], [chapterDetail])

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

  const renderStatus = () => {
    if (error) return <Badge variant="destructive">保存异常</Badge>
    if (!editorState) return <Badge variant="secondary">加载中</Badge>
    if (isSaving) return <Badge variant="secondary">自动保存中</Badge>
    return <Badge variant="secondary">已接入 mind-map 宿主模式</Badge>
  }

  const handleSubjectDocumentUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      await mindMapImport.handleSubjectDocumentUpload(file)
    } finally {
      event.target.value = ''
    }
  }

  return (
    <div className="space-y-5">
      <PageIntro
        title="知识树编辑器"
        actions={
          <>
            {renderStatus()}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="border-border/70 bg-card/92">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FolderTree className="h-4 w-4" />
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
                  className={`flex w-full items-center justify-between rounded-2xl border px-3 py-3 text-left transition-colors ${
                    selectedSubjectId === subject.id
                      ? 'border-primary/40 bg-primary/8 text-foreground'
                      : 'border-border/70 bg-background/70 text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: subject.color }} />
                    <span className="font-medium">{subject.name}</span>
                  </span>
                  {selectedSubjectId === subject.id ? <Badge variant="secondary">当前</Badge> : null}
                </button>
              ))}
            </div>

            <div className="space-y-2 rounded-2xl border border-dashed border-border/80 bg-background/50 p-3">
              <Label htmlFor="new-subject">新增学科</Label>
              <Input
                id="new-subject"
                value={newSubjectName}
                onChange={(event) => setNewSubjectName(event.target.value)}
                placeholder="例如：英语语法"
              />
              <Button type="button" className="w-full" onClick={handleCreateSubject}>
                <Plus className="mr-2 h-4 w-4" />
                创建学科
              </Button>
            </div>

            <div className="space-y-3 rounded-2xl border border-border/70 bg-background/60 p-3">
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
                  <Save className="mr-2 h-4 w-4" />
                  保存学科信息
                </Button>
                <Button type="button" variant="outline" onClick={handleDeleteSubject} disabled={!activeSubject}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  删除
                </Button>
              </div>
            </div>

            <div className="space-y-3 rounded-2xl border border-border/70 bg-background/60 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <FileText className="h-4 w-4" />
                学科 PDF 资料库
              </div>
              <label className="flex cursor-pointer items-center justify-center rounded-2xl border border-dashed border-border/80 px-3 py-4 text-sm text-muted-foreground transition-colors hover:text-foreground">
                <Upload className="mr-2 h-4 w-4" />
                上传 PDF
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  onChange={(event) => void handleSubjectDocumentUpload(event)}
                  disabled={!activeSubject}
                />
              </label>
              {mindMapImport.importSubjectDocumentsLoading ? (
                <div className="text-sm text-muted-foreground">正在加载资料…</div>
              ) : mindMapImport.importSubjectDocuments.length > 0 ? (
                <div className="space-y-2">
                  {mindMapImport.importSubjectDocuments.map((document) => (
                    <div
                      key={document.id}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/70 px-3 py-3 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{document.original_name}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{document.page_count} 页</div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => void mindMapImport.handleSubjectDocumentDelete(document.id)}
                      >
                        删除
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-border/80 px-3 py-4 text-sm text-muted-foreground">
                  还没有上传 PDF 资料。
                </div>
              )}
            </div>

            <div className="space-y-4 rounded-2xl border border-border/70 bg-background/60 p-3">
              <div className="text-sm font-semibold">当前章节</div>
              {chapterDetail ? (
                <>
                  <div>
                    <div className="text-sm font-semibold">{chapterDetail.chapter.name}</div>
                    {chapterDetail.chapter.breadcrumbs.length > 0 ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {chapterDetail.chapter.breadcrumbs.map((item) => item.name).join(' / ')}
                      </div>
                    ) : null}
                  </div>
                  <div className="rounded-2xl bg-background/70 p-3 text-sm text-muted-foreground whitespace-pre-wrap">
                    {chapterDetail.chapter.notes || '该章节暂时没有备注。'}
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold">关联宫殿</div>
                      {selectedChapterId ? (
                        <Link to={`/review?chapterId=${selectedChapterId}`}>
                          <Button size="sm" variant="outline">开始章节复习</Button>
                        </Link>
                      ) : null}
                    </div>
                    {selectedPalaces.length > 0 ? (
                      <div className="space-y-2">
                        {selectedPalaces.map((palace) => (
                          <Link
                            key={palace.id}
                            to={`/palaces/${palace.id}`}
                            className="flex items-center justify-between rounded-2xl border border-border/70 bg-background/70 px-3 py-3 text-sm transition-colors hover:text-foreground"
                          >
                            <span>{palace.title}</span>
                            <span className="text-xs text-muted-foreground">查看宫殿</span>
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-border/80 px-3 py-4 text-sm text-muted-foreground">
                        当前章节还没有关联任何宫殿。
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border border-dashed border-border/80 px-3 py-6 text-sm text-muted-foreground">
                  选中一个章节节点后，这里会显示章节信息。
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="min-h-[72vh] border-border/70 bg-card/92">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">{activeSubject?.name ?? '选择一个学科'}</CardTitle>
            </div>
            {selectedChapterId ? <Badge variant="secondary">章节 #{selectedChapterId}</Badge> : null}
          </CardHeader>
          <CardContent className="min-h-[62vh]">
            {selectedSubjectId && editorState ? (
              <MindMapFrame
                editorState={editorState}
                showImportButtons
                syncOnPropChange
                syncIntent="soft"
                externalSyncKey={mindMapImport.importExternalSyncKey}
                onEditorStateChange={(nextState: MindMapEditorState) => {
                  setEditorState(nextState)
                }}
                onNodeActive={setSelectedNodes}
                onMindMapImportOpen={() => {
                  mindMapImport.setImportMode('mindmap')
                  mindMapImport.setImportOpen(true)
                }}
                onImageTextImportOpen={() => {
                  mindMapImport.setImportMode('text')
                  mindMapImport.setImportOpen(true)
                }}
                className="h-[62vh] w-full rounded-2xl border border-border/70 bg-white"
              />
            ) : (
              <div className="flex h-[62vh] items-center justify-center rounded-2xl border border-dashed border-border/80 bg-background/60 text-sm text-muted-foreground">
                先创建或选择一个学科，宿主编辑器才会加载。
              </div>
            )}
          </CardContent>
        </Card>
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
      />

    </div>
  )
}
