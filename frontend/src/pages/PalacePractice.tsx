import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { api, type MindMapEditorState } from '@/api/client'
import { PageIntro } from '@/components/layout/PageIntro'
import { MindMapReviewFlow, type ReviewFlowSnapshot } from '@/components/review/MindMapReviewFlow'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  clearPracticeProgress,
  getPracticeProgress,
  savePracticeProgress,
} from '@/lib/session-records'

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
        const progress = getPracticeProgress(palaceId)
        setInitialSnapshot(
          progress && !progress.completed
            ? {
                revealMap: progress.revealMap,
                redNodeIds: progress.redNodeIds,
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
    const progress = getPracticeProgress(palaceId)
    if (progress && !progress.completed) {
      return <Badge variant="secondary">已接续上次练习</Badge>
    }
    return <Badge variant="outline">本地续练</Badge>
  }, [flowKey, palaceId])

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
            canPersistEdits
            onEditorStateChange={async (nextState) => {
              setEditorState(nextState)
              const saved = await api.savePalaceEditor(palace.id, nextState)
              setEditorState({
                editor_doc: saved.editor_doc,
                editor_config: saved.editor_config,
                editor_local_config: saved.editor_local_config,
                lang: saved.lang,
              })
            }}
            initialSnapshot={initialSnapshot}
            persistProgress
            onSnapshotChange={(snapshot) => {
              if (snapshot.completed) {
                clearPracticeProgress(palace.id)
                return
              }
              savePracticeProgress({
                palaceId: palace.id,
                updatedAt: new Date().toISOString(),
                completed: snapshot.completed,
                revealMap: snapshot.revealMap,
                redNodeIds: snapshot.redNodeIds,
              })
            }}
            onRestart={() => {
              clearPracticeProgress(palace.id)
              setInitialSnapshot(null)
              setFlowKey((value) => value + 1)
            }}
            onComplete={() => {
              clearPracticeProgress(palace.id)
            }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
