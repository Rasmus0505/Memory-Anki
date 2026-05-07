import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, FileText } from 'lucide-react'
import { api } from '@/api/client'
import { PageIntro } from '@/components/layout/PageIntro'
import { MindMapFrame } from '@/components/mindmap-host'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { usePersistedMindMapEditor } from '@/hooks/usePersistedMindMapEditor'

interface PalaceMeta {
  id: number
  title: string
  description: string
  archived: boolean
  mastered: boolean
  attachments: Array<{ id: number; original_name: string }>
  chapters: Array<{ id: number; name: string; subject?: { id: number; name: string } | null }>
}

export default function PalaceView() {
  const { id } = useParams()
  const palaceId = id ? Number(id) : null

  const { meta, editorState, isLoading, error } = usePersistedMindMapEditor({
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

  if (!palaceId || (!palace && isLoading)) {
    return <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">正在加载宫殿详情...</div>
  }

  if (!palace || !editorState) {
    return <div className="flex min-h-[60vh] items-center justify-center text-sm text-destructive">{error || '未找到该宫殿。'}</div>
  }

  return (
    <div className="space-y-5">
      <PageIntro
        eyebrow="宫殿详情"
        title={palace.title}
        description="这是只读脑图视图。难度与旧的 review mode 已从产品界面移除。"
        actions={
          <>
            <Link to="/palaces">
              <Button variant="outline" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" />
                返回列表
              </Button>
            </Link>
            <Badge variant="secondary">只读脑图</Badge>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="min-h-[72vh] border-border/70 bg-card/92">
          <CardHeader>
            <CardTitle className="text-base">宫殿脑图</CardTitle>
          </CardHeader>
          <CardContent className="min-h-[62vh]">
            <MindMapFrame
              key={`readonly-${palace.id}`}
              editorState={editorState}
              readonly
              showToolbarWhenReadonly
              onEditorStateChange={() => {}}
              className="h-[62vh] w-full rounded-2xl border border-border/70 bg-white"
            />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-border/70 bg-card/92">
            <CardHeader>
              <CardTitle className="text-base">概要</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              {palace.mastered ? <Badge variant="secondary">已掌握</Badge> : null}
              {palace.archived ? <Badge variant="secondary">已归档</Badge> : null}
              <div className="rounded-2xl bg-background/70 p-3 whitespace-pre-wrap">
                {palace.description || '当前宫殿没有补充描述。'}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/92">
            <CardHeader>
              <CardTitle className="text-base">关联章节</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {palace.chapters.length > 0 ? (
                palace.chapters.map((chapter) => (
                  <div key={chapter.id} className="rounded-2xl border border-border/70 bg-background/70 px-3 py-3">
                    <div className="font-medium">{chapter.name}</div>
                    <div className="text-muted-foreground">{chapter.subject?.name || '未分类学科'}</div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-border/80 px-3 py-4 text-muted-foreground">
                  该宫殿还没有关联章节。
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/92">
            <CardHeader>
              <CardTitle className="text-base">附件</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {palace.attachments.length > 0 ? (
                palace.attachments.map((attachment) => (
                  <a
                    key={attachment.id}
                    href={`/api/attachments/${attachment.id}`}
                    target="_blank"
                    className="block rounded-2xl border border-border/70 bg-background/70 px-3 py-3 transition-colors hover:text-foreground"
                  >
                    <span className="inline-flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      {attachment.original_name}
                    </span>
                  </a>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-border/80 px-3 py-4 text-muted-foreground">
                  没有附件。
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
