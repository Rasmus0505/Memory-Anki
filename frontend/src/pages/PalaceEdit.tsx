import { type ChangeEvent, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Eye, History, Link2, Paperclip, Save, Upload } from 'lucide-react'
import { api, type MindMapEditorState, type PalaceVersionDetail, type PalaceVersionSummary } from '@/api/client'
import { PageIntro } from '@/components/layout/PageIntro'
import { MindMapFrame, type MindMapSelection } from '@/components/mindmap-host'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { usePersistedMindMapEditor } from '@/hooks/usePersistedMindMapEditor'
import { SessionTimerBar } from '@/components/session/SessionTimerBar'
import { useTimedSession } from '@/hooks/useTimedSession'
import { cn } from '@/lib/utils'

interface PalaceMeta {
  id: number
  title: string
  description: string
  created_at: string | null
  attachments: Array<{ id: number; original_name: string; file_size: number }>
  chapters: Array<{ id: number; name: string; subject?: { id: number; name: string } | null }>
}

interface ChapterOption {
  id: number
  label: string
}

function formatDateTimeInputValue(value: string | null): string {
  if (!value) return ''
  const match = value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/)
  if (match) {
    return `${match[1]}T${match[2]}`
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const hours = `${date.getHours()}`.padStart(2, '0')
  const minutes = `${date.getMinutes()}`.padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

function toLocalDateTimePayload(value: string): string {
  return `${value}:00`
}

function formatVersionSavedAt(value: string | null): string {
  if (!value) return '未知时间'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date).replace(/\//g, '/')
}

function normalizePreviewEditorDoc(value: Record<string, unknown> | string | null): Record<string, unknown> | string {
  if (!value) return ''
  return value
}

function normalizePreviewConfig(value: Record<string, unknown> | string | null): Record<string, unknown> {
  if (!value) {
    return {
      theme: { template: 'avocado', config: {} },
      layout: 'logicalStructure',
      config: {},
    }
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>
      return {
        theme: { template: 'avocado', config: {}, ...((parsed.theme as Record<string, unknown> | undefined) ?? {}) },
        layout: parsed.layout ?? 'logicalStructure',
        config: (parsed.config as Record<string, unknown> | undefined) ?? {},
        ...parsed,
      }
    } catch {
      return {
        theme: { template: 'avocado', config: {} },
        layout: 'logicalStructure',
        config: {},
      }
    }
  }
  return {
    theme: { template: 'avocado', config: {}, ...((value.theme as Record<string, unknown> | undefined) ?? {}) },
    layout: value.layout ?? 'logicalStructure',
    config: (value.config as Record<string, unknown> | undefined) ?? {},
    ...value,
  }
}

export default function PalaceEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const palaceId = id ? Number(id) : null
  const [isCreatingDraft, setIsCreatingDraft] = useState(false)
  const [frameVersion, setFrameVersion] = useState(0)
  const [selectedNodes, setSelectedNodes] = useState<MindMapSelection[]>([])
  const [title, setTitle] = useState('')
  const [createdAt, setCreatedAt] = useState('')
  const [chapterOptions, setChapterOptions] = useState<ChapterOption[]>([])
  const [selectedChapterIds, setSelectedChapterIds] = useState<number[]>([])
  const [versionOpen, setVersionOpen] = useState(false)
  const [mindMapFullscreen, setMindMapFullscreen] = useState(false)
  const [versions, setVersions] = useState<PalaceVersionSummary[]>([])
  const [removedDuplicateCount, setRemovedDuplicateCount] = useState(0)
  const [previewingVersionId, setPreviewingVersionId] = useState<number | null>(null)
  const [previewVersionDetail, setPreviewVersionDetail] = useState<PalaceVersionDetail | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')

  const {
    meta,
    editorState,
    setEditorState,
    isSaving,
    error,
    reload,
  } = usePersistedMindMapEditor({
    entityId: palaceId,
    fetcher: api.getPalaceEditor,
    saver: api.savePalaceEditor,
    selectMeta: (response) => response.palace as PalaceMeta,
    selectEditorState: (response) => ({
      editor_doc: response.editor_doc,
      editor_config: response.editor_config,
      editor_local_config: response.editor_local_config,
      lang: response.lang,
    }),
    onSaveError: async (nextError, pendingState) => {
      if (!palaceId || !nextError.message.includes('危险结构变更')) return false
      const confirmed = window.confirm('这次保存会让宫殿节点数量骤减。只有在你确实要大幅删除宫殿结构时才继续。确定继续保存吗？')
      if (!confirmed) return true
      await api.savePalaceEditorWithOptions(palaceId, {
        ...pendingState,
        confirm_dangerous_change: true,
        editor_source: 'palace_edit',
      })
      await reload()
      setFrameVersion((value) => value + 1)
      return true
    },
  })

  const palace = meta as PalaceMeta | null
  const selectedNode = selectedNodes[0] ?? null
  const timer = useTimedSession({
    kind: 'palace_edit',
    title: title || palace?.title || '未命名宫殿',
    palaceId,
  })

  useEffect(() => {
    return () => {
      if (timer.startedAt && timer.status !== 'completed') {
        timer.complete('left_page')
      }
    }
  }, [timer])

  useEffect(() => {
    if (!mindMapFullscreen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [mindMapFullscreen])

  useEffect(() => {
    if (palaceId || isCreatingDraft) return
    setIsCreatingDraft(true)
    void api.createPalace({ title: '未命名宫殿', description: '', pegs: [] }).then((created) => {
      navigate(`/palaces/${created.id}/edit`, { replace: true })
    })
  }, [isCreatingDraft, navigate, palaceId])

  useEffect(() => {
    if (!palace) return
    setTitle(palace.title)
    setCreatedAt(formatDateTimeInputValue(palace.created_at))
    setSelectedChapterIds(palace.chapters.map((chapter) => chapter.id))
  }, [palace])

  useEffect(() => {
    const loadChapterOptions = async () => {
      const subjects = await api.getSubjects()
      const trees = await Promise.all(subjects.map((subject) => api.getSubjectTree(subject.id)))
      const options: ChapterOption[] = []

      const walk = (nodes: any[], depth: number, subjectName: string) => {
        for (const node of nodes) {
          options.push({
            id: node.id,
            label: `${subjectName} / ${'· '.repeat(depth)}${node.name}`,
          })
          walk(node.children || [], depth + 1, subjectName)
        }
      }

      trees.forEach((tree) => {
        walk(tree.chapters || [], 0, tree.subject?.name || '未命名学科')
      })
      setChapterOptions(options)
    }

    void loadChapterOptions()
  }, [])

  const handleSaveMeta = async () => {
    if (!palace) return
    timer.registerActivity({ source: 'save_meta' })
    await api.updatePalace(palace.id, {
      title: title.trim() || '未命名宫殿',
      created_at: createdAt ? toLocalDateTimePayload(createdAt) : null,
    })
    await reload()
    setFrameVersion((value) => value + 1)
  }

  const handleEstablishCreatedAt = async () => {
    if (!palace) return
    timer.registerActivity({ source: 'establish_created_at' })
    const now = new Date()
    await api.updatePalace(palace.id, {
      created_at: now.toISOString(),
    })
    await reload()
  }

  const handleAttachmentUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !palace) return
    timer.registerActivity({ source: 'attachment_upload' })
    await api.uploadAttachment(palace.id, file)
    await reload()
    event.target.value = ''
  }

  const handleAttachmentDelete = async (attachmentId: number) => {
    timer.registerActivity({ source: 'attachment_delete' })
    await api.deleteAttachment(attachmentId)
    await reload()
  }

  const handleChapterToggle = async (chapterId: number) => {
    if (!palace) return
    timer.registerActivity({ source: 'chapter_toggle' })
    const nextIds = selectedChapterIds.includes(chapterId)
      ? selectedChapterIds.filter((item) => item !== chapterId)
      : [...selectedChapterIds, chapterId]
    setSelectedChapterIds(nextIds)
    await api.linkPalaceChapters(palace.id, nextIds)
    await reload()
  }

  const handleOpenVersions = async () => {
    if (!palace) return
    const result = await api.getPalaceVersions(palace.id)
    setVersions(result.versions)
    setRemovedDuplicateCount(result.removed_duplicates ?? 0)
    setPreviewingVersionId(null)
    setPreviewVersionDetail(null)
    setPreviewError('')
    setPreviewLoading(false)
    setVersionOpen(true)
  }

  const handlePreviewVersion = async (versionId: number) => {
    if (!palace) return
    setPreviewingVersionId(versionId)
    setPreviewLoading(true)
    setPreviewError('')
    try {
      const detail = await api.getPalaceVersionDetail(palace.id, versionId)
      setPreviewVersionDetail(detail)
    } catch (err) {
      setPreviewVersionDetail(null)
      setPreviewError(err instanceof Error ? err.message : '加载版本预览失败。')
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleCloseVersions = () => {
    setVersionOpen(false)
    setPreviewingVersionId(null)
    setPreviewVersionDetail(null)
    setPreviewError('')
    setPreviewLoading(false)
    setRemovedDuplicateCount(0)
  }

  const handleRestoreVersion = async (versionId: number) => {
    if (!palace) return
    const confirmed = window.confirm('恢复历史版本只会回滚当前宫殿内容，不会影响其他宫殿和复习记录。确定继续吗？')
    if (!confirmed) return
    await api.restorePalaceVersion(palace.id, versionId)
    await reload()
    setFrameVersion((value) => value + 1)
    handleCloseVersions()
  }

  const statusBadge = useMemo(() => {
    if (!palaceId) return <Badge variant="secondary">正在创建草稿</Badge>
    if (error) return <Badge variant="destructive">保存异常</Badge>
    if (!editorState) return <Badge variant="secondary">加载中</Badge>
    if (isSaving) return <Badge variant="secondary">自动保存脑图中</Badge>
    return <Badge variant="secondary">宿主桥已连接</Badge>
  }, [editorState, error, isSaving, palaceId])

  if (!palaceId) {
    return <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">正在为新宫殿创建草稿…</div>
  }

  return (
    <div className="space-y-5">
      <PageIntro
        title={palace?.title || '宫殿编辑器'}
        actions={
          <>
            <Link to="/palaces">
              <Button variant="outline" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" />
                返回列表
              </Button>
            </Link>
            {palace ? (
              <Button variant="outline" size="sm" onClick={() => void handleOpenVersions()}>
                <History className="mr-2 h-4 w-4" />
                恢复点
              </Button>
            ) : null}
            {statusBadge}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-4">
          <SessionTimerBar
            effectiveSeconds={timer.effectiveSeconds}
            pauseCount={timer.pauseCount}
            status={timer.status}
            onStart={() => timer.start({ source: 'manual' })}
            onPause={() => timer.pause({ source: 'manual' })}
            onResume={() => timer.resume({ source: 'manual' })}
            onAdjustDuration={timer.adjustDuration}
            showCompleteAction={false}
            className={mindMapFullscreen ? 'fixed right-5 top-5 z-[100]' : 'sticky top-5 z-20'}
          />

          <Card className="border-border/70 bg-card/92">
            <CardHeader>
              <CardTitle className="text-base">宫殿字段</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="palace-title">标题</Label>
                <Input id="palace-title" value={title} onChange={(event) => setTitle(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="palace-created-at">建造状态</Label>
                {palace?.created_at ? (
                  <div className="space-y-3 rounded-2xl border border-border/70 bg-background/70 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      已确立建造宫殿
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="palace-created-at">创建时间</Label>
                      <Input
                        id="palace-created-at"
                        type="datetime-local"
                        value={createdAt}
                        onChange={(event) => setCreatedAt(event.target.value)}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 rounded-2xl border border-dashed border-border/80 bg-background/70 p-4">
                    <p className="text-sm text-muted-foreground">
                      确立后会以你点击按钮的时间作为该宫殿的创建时间，之后仍可继续修改。
                    </p>
                    <Button type="button" variant="outline" className="w-full" onClick={() => void handleEstablishCreatedAt()}>
                      确立建造宫殿
                    </Button>
                  </div>
                )}
              </div>
              <Button type="button" className="w-full" onClick={handleSaveMeta}>
                <Save className="mr-2 h-4 w-4" />
                保存
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/92">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Link2 className="h-4 w-4" />
                章节关联
              </CardTitle>
            </CardHeader>
            <CardContent className="max-h-[280px] space-y-2 overflow-y-auto">
              {chapterOptions.map((option) => (
                <label key={option.id} className="flex items-start gap-3 rounded-2xl border border-border/70 bg-background/70 px-3 py-3 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedChapterIds.includes(option.id)}
                    onChange={() => void handleChapterToggle(option.id)}
                    className="mt-1"
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/92">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Paperclip className="h-4 w-4" />
                附件
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="flex cursor-pointer items-center justify-center rounded-2xl border border-dashed border-border/80 px-3 py-4 text-sm text-muted-foreground transition-colors hover:text-foreground">
                <Upload className="mr-2 h-4 w-4" />
                上传附件
                <input type="file" className="hidden" onChange={handleAttachmentUpload} />
              </label>
              <div className="space-y-2">
                {palace?.attachments?.length ? (
                  palace.attachments.map((attachment) => (
                    <div key={attachment.id} className="flex items-center justify-between rounded-2xl border border-border/70 bg-background/70 px-3 py-3 text-sm">
                      <span>{attachment.original_name}</span>
                      <Button variant="ghost" size="sm" onClick={() => handleAttachmentDelete(attachment.id)}>
                        删除
                      </Button>
                    </div>
                  ))
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card
          className={cn(
            'min-h-[74vh] border-border/70 bg-card/92',
            mindMapFullscreen && 'fixed inset-4 z-[90] min-h-0 bg-card/96 shadow-2xl',
          )}
        >
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">宫殿脑图</CardTitle>
            </div>
            {selectedNode?.memoryAnkiId ? (
              <Badge variant="secondary">
                {selectedNode.memoryAnkiNodeType} #{selectedNode.memoryAnkiId}
              </Badge>
            ) : null}
          </CardHeader>
          <CardContent className={cn('min-h-[64vh]', mindMapFullscreen && 'h-[calc(100vh-120px)] min-h-0')}>
            {editorState ? (
              <MindMapFrame
                key={`${palaceId}-${frameVersion}`}
                editorState={editorState}
                onEditorStateChange={(nextState: MindMapEditorState) => {
                  timer.registerActivity({ source: 'mind_map_edit' })
                  setEditorState(nextState)
                }}
                onNodeActive={(nodes) => {
                  timer.registerActivity({ source: 'node_active' })
                  setSelectedNodes(nodes)
                }}
                onFullscreenChange={setMindMapFullscreen}
                className={cn(
                  'w-full rounded-2xl border border-border/70 bg-white',
                  mindMapFullscreen ? 'h-full' : 'h-[64vh]',
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

      <Dialog open={versionOpen} onOpenChange={setVersionOpen}>
        <DialogContent className="h-[min(80vh,900px)] max-h-[min(80vh,900px)] max-w-3xl overflow-hidden rounded-[28px] border-border/70 bg-background/98 p-0">
          <DialogHeader>
            <div>
              <DialogTitle>宫殿恢复点</DialogTitle>
            </div>
            <DialogClose onClick={handleCloseVersions} />
          </DialogHeader>

          {previewingVersionId == null ? (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6">
              <div className="space-y-3">
              {versions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/80 bg-background/70 px-4 py-8 text-center text-sm text-muted-foreground">
                  当前还没有可恢复的有效快照。
                </div>
              ) : (
                <>
                  {versions.map((version) => (
                    <div
                      key={version.id}
                      className="flex flex-col gap-4 rounded-[24px] border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.82))] px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-950">
                          <span>{version.trigger_reason === 'editor_save' ? '自动恢复点' : version.trigger_reason}</span>
                          <span className="text-muted-foreground">·</span>
                          <span className="text-muted-foreground">{formatVersionSavedAt(version.created_at)}</span>
                          <span className="text-muted-foreground">·</span>
                          <Badge variant="outline" className="rounded-full px-2.5 py-0.5 text-[11px]">
                            恢复点 #{version.id}
                          </Badge>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={() => void handlePreviewVersion(version.id)}>
                          <Eye className="mr-2 h-4 w-4" />
                          预览
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => void handleRestoreVersion(version.id)}>
                          恢复这个版本
                        </Button>
                      </div>
                    </div>
                  ))}
                  <div className="rounded-2xl border border-dashed border-border/80 bg-background/60 px-4 py-3 text-center text-sm text-muted-foreground">
                    已显示全部 {versions.length} 个恢复点{removedDuplicateCount > 0 ? `，本次已自动清理 ${removedDuplicateCount} 条重复快照` : ''}。
                  </div>
                </>
              )}
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6">
              <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button variant="outline" size="sm" onClick={() => {
                  setPreviewingVersionId(null)
                  setPreviewVersionDetail(null)
                  setPreviewError('')
                  setPreviewLoading(false)
                }}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  返回列表
                </Button>
                {previewVersionDetail ? (
                  <Button variant="outline" size="sm" onClick={() => void handleRestoreVersion(previewVersionDetail.id)}>
                    恢复这个版本
                  </Button>
                ) : null}
              </div>

              {previewLoading ? (
                <div className="rounded-2xl border border-dashed border-border/80 bg-background/70 px-4 py-10 text-center text-sm text-muted-foreground">
                  正在加载版本预览…
                </div>
              ) : previewError ? (
                <div className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-4 text-sm text-destructive">
                  {previewError}
                </div>
              ) : previewVersionDetail ? (
                <div className="space-y-4">
                  <div className="rounded-[24px] border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.82))] px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-950">
                      <span>{previewVersionDetail.trigger_reason === 'editor_save' ? '自动恢复点' : previewVersionDetail.trigger_reason}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-muted-foreground">{formatVersionSavedAt(previewVersionDetail.created_at)}</span>
                      <Badge variant="outline" className="rounded-full px-2.5 py-0.5 text-[11px]">
                        恢复点 #{previewVersionDetail.id}
                      </Badge>
                    </div>
                    <div className="mt-2 text-base font-semibold text-slate-950">
                      {previewVersionDetail.title || '未命名宫殿'}
                    </div>
                  </div>

                  <Card className="border-border/70 bg-card/92">
                    <CardContent className="min-h-[56vh] p-4">
                      <MindMapFrame
                        key={`preview-version-${previewVersionDetail.id}`}
                        editorState={{
                          editor_doc: normalizePreviewEditorDoc(previewVersionDetail.editor_doc),
                          editor_config: normalizePreviewConfig(previewVersionDetail.editor_config),
                          editor_local_config: normalizePreviewConfig(previewVersionDetail.editor_local_config),
                          lang: editorState?.lang || 'zh',
                        }}
                        readonly
                        showToolbarWhenReadonly
                        onEditorStateChange={() => {}}
                        className="h-[56vh] w-full rounded-2xl border border-border/70 bg-white"
                      />
                    </CardContent>
                  </Card>
                </div>
              ) : null}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
