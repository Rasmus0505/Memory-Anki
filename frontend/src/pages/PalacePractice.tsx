import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, FileText, RotateCcw } from 'lucide-react'
import { api } from '@/api/client'
import { PageIntro } from '@/components/layout/PageIntro'
import { MindMapReviewFlow, type ReviewRating } from '@/components/review/MindMapReviewFlow'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface PalaceMeta {
  id: number
  title: string
  description: string
  archived: boolean
  mastered: boolean
  attachments: Array<{ id: number; original_name: string }>
  chapters: Array<{ id: number; name: string; subject?: { id: number; name: string } | null }>
}

export default function PalacePractice() {
  const { id } = useParams()
  const palaceId = id ? Number(id) : null
  const [palace, setPalace] = useState<PalaceMeta | null>(null)
  const [editorDoc, setEditorDoc] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ReviewRating | null>(null)
  const [restartKey, setRestartKey] = useState(0)

  useEffect(() => {
    if (!palaceId) return
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const data = await api.getPalaceEditor(palaceId)
        setPalace(data.palace as PalaceMeta)
        setEditorDoc(data.editor_doc)
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载练习内容失败。')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [palaceId])

  if (!palaceId || loading) {
    return <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">正在加载练习内容...</div>
  }

  if (!palace || error) {
    return <div className="flex min-h-[60vh] items-center justify-center text-sm text-destructive">{error || '未找到可练习的宫殿。'}</div>
  }

  return (
    <div className="space-y-5">
      <PageIntro
        eyebrow="练习"
        title={palace.title}
        description="练习会模拟正式复习的揭示流程，但不会写入任何复习记录，也不会影响后续排程。"
        actions={
          <>
            <Link to="/palaces">
              <Button variant="outline" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" />
                返回列表
              </Button>
            </Link>
            <Badge variant="secondary">不影响计划</Badge>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="border-border/70 bg-card/92">
          <CardContent className="p-5">
            <MindMapReviewFlow
              key={restartKey}
              title={palace.title}
              description={palace.description}
              editorDoc={editorDoc}
              onSubmit={(rating) => setResult(rating)}
              result={result}
              resultActions={
                <div className="flex flex-wrap gap-3">
                  <Button variant="outline" onClick={() => { setResult(null); setRestartKey((value) => value + 1) }}>
                    <RotateCcw className="mr-2 h-4 w-4" />
                    重新练习
                  </Button>
                  <Link to={`/palaces/${palace.id}`}>
                    <Button variant="outline">查看宫殿详情</Button>
                  </Link>
                  <Link to="/palaces">
                    <Button>返回宫殿列表</Button>
                  </Link>
                </div>
              }
              startLabel="开始练习"
            />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-border/70 bg-card/92">
            <CardHeader>
              <CardTitle className="text-base">练习说明</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div>练习只模拟正式复习流程，不会生成 review log，也不会改动 review schedule。</div>
              <div>建议先在脑中完整回忆，再按主分支逐条核对。</div>
              <div>评分只用于本次页面反馈，刷新页面后不会保留。</div>
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
