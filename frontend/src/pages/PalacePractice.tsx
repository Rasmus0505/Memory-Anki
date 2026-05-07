import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, RotateCcw } from 'lucide-react'
import { api, type MindMapEditorState } from '@/api/client'
import { PageIntro } from '@/components/layout/PageIntro'
import { MindMapReviewFlow, type ReviewRating } from '@/components/review/MindMapReviewFlow'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

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
  const [editorState, setEditorState] = useState<MindMapEditorState | null>(null)
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
        setEditorState({
          editor_doc: data.editor_doc,
          editor_config: data.editor_config,
          editor_local_config: data.editor_local_config,
          lang: data.lang,
        })
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

  if (!palace || !editorState || error) {
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

      <div className="space-y-4">
        <Card className="border-border/70 bg-card/92">
          <CardContent className="p-5">
            <MindMapReviewFlow
              key={restartKey}
              title={palace.title}
              description={palace.description}
              editorState={editorState}
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
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
