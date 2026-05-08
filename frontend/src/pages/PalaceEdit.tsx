import { type ChangeEvent, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Link2, Paperclip, Save, Upload } from 'lucide-react'
import { api, type MindMapEditorState } from '@/api/client'
import { PageIntro } from '@/components/layout/PageIntro'
import { MindMapFrame, type MindMapSelection } from '@/components/mindmap-host'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { usePersistedMindMapEditor } from '@/hooks/usePersistedMindMapEditor'

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
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const hours = `${date.getHours()}`.padStart(2, '0')
  const minutes = `${date.getMinutes()}`.padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

function formatCreatedAtDisplay(value: string | null): string {
  if (!value) return '尚未确立建造时间'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '尚未确立建造时间'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date).replace(/\//g, '-')
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
  })

  const palace = meta as PalaceMeta | null
  const selectedNode = selectedNodes[0] ?? null

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
    await api.updatePalace(palace.id, {
      title: title.trim() || '未命名宫殿',
      created_at: createdAt ? new Date(createdAt).toISOString() : null,
    })
    await reload()
    setFrameVersion((value) => value + 1)
  }

  const handleEstablishCreatedAt = async () => {
    if (!palace) return
    const now = new Date()
    await api.updatePalace(palace.id, {
      created_at: now.toISOString(),
    })
    await reload()
  }

  const handleAttachmentUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !palace) return
    await api.uploadAttachment(palace.id, file)
    await reload()
    event.target.value = ''
  }

  const handleAttachmentDelete = async (attachmentId: number) => {
    await api.deleteAttachment(attachmentId)
    await reload()
  }

  const handleChapterToggle = async (chapterId: number) => {
    if (!palace) return
    const nextIds = selectedChapterIds.includes(chapterId)
      ? selectedChapterIds.filter((item) => item !== chapterId)
      : [...selectedChapterIds, chapterId]
    setSelectedChapterIds(nextIds)
    await api.linkPalaceChapters(palace.id, nextIds)
    await reload()
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
            {statusBadge}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-4">
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
                      <p className="text-xs text-muted-foreground">
                        当前记录：{formatCreatedAtDisplay(palace.created_at)}
                      </p>
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
                保存业务字段
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

        <Card className="min-h-[74vh] border-border/70 bg-card/92">
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
          <CardContent className="min-h-[64vh]">
            {editorState ? (
              <MindMapFrame
                key={`${palaceId}-${frameVersion}`}
                editorState={editorState}
                onEditorStateChange={(nextState: MindMapEditorState) => setEditorState(nextState)}
                onNodeActive={setSelectedNodes}
                className="h-[64vh] w-full rounded-2xl border border-border/70 bg-white"
              />
            ) : (
              <div className="flex h-[64vh] items-center justify-center rounded-2xl border border-dashed border-border/80 bg-background/60 text-sm text-muted-foreground">
                正在加载宫殿编辑器…
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
