import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { api, type MindMapEditorState } from '@/api/client'
import { PageIntro } from '@/components/layout/PageIntro'
import { MindMapReviewFlow, type ReviewFlowSnapshot } from '@/components/review/MindMapReviewFlow'
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
  const [initialSnapshot, setInitialSnapshot] = useState<ReviewFlowSnapshot | null>(null)
  const [flowKey, setFlowKey] = useState(0)
  const [hasResumeProgress, setHasResumeProgress] = useState(false)

  useEffect(() => {
    if (!palaceId) return
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const editor = await api.getPalaceEditor(palaceId)
        const data = editor
        setPalace(data.palace as PalaceMeta)
        setEditorState({
          editor_doc: editor.editor_doc,
          editor_config: editor.editor_config,
          editor_local_config: editor.editor_local_config,
          lang: editor.lang,
        })
        const progressResponse = await api.getPracticeSessionProgress(palaceId)
        const progress = progressResponse.progress
        setHasResumeProgress(Boolean(progress && !progress.completed))
        setInitialSnapshot(
          progress && !progress.completed
            ? {
                revealMap: progress.reveal_map,
                redNodeIds: progress.red_node_ids,
                completed: progress.completed,
              }
            : null,
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载练习内容失败。')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [palaceId])

  const practiceBadge = useMemo(() => {
    if (!palaceId) return null
    if (hasResumeProgress) {
      return <Badge variant="secondary">已接续上次练习</Badge>
    }
    return <Badge variant="outline">项目内续练</Badge>
  }, [flowKey, hasResumeProgress, palaceId])

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
        actions={
          <>
            <Link to="/palaces">
              <Button variant="outline" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" />
                返回列表
              </Button>
            </Link>
            {practiceBadge}
          </>
        }
      />

      <Card className="border-border/70 bg-card/92">
        <CardContent className="p-5">
          <MindMapReviewFlow
            key={`${palace.id}-${flowKey}`}
            title={palace.title}
            palaceId={palace.id}
            sessionKind="practice"
            editorState={editorState}
            initialSnapshot={initialSnapshot}
            persistProgress
            onSnapshotChange={async (snapshot) => {
              if (snapshot.completed) {
                setHasResumeProgress(false)
                await api.clearPracticeSessionProgress(palace.id)
                return
              }
              setHasResumeProgress(true)
              await api.savePracticeSessionProgress(palace.id, {
                completed: snapshot.completed,
                reveal_map: snapshot.revealMap,
                red_node_ids: snapshot.redNodeIds,
              })
            }}
            onRestart={async () => {
              await api.clearPracticeSessionProgress(palace.id)
              setHasResumeProgress(false)
              setInitialSnapshot(null)
              setFlowKey((value) => value + 1)
            }}
            onComplete={async () => {
              await api.clearPracticeSessionProgress(palace.id)
              setHasResumeProgress(false)
            }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
