import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import type { MindMapEditorState, PalaceSegmentSummary } from '@/shared/api/contracts'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  clearSegmentPracticeSessionProgressApi,
  getPalaceSegmentApi,
  getSegmentPracticeSessionProgressApi,
  saveSegmentPracticeSessionProgressApi,
} from '@/shared/api/modules/palaces'
import {
  MindMapReviewFlow,
  type ReviewFlowSnapshot,
} from '@/features/review/components/MindMapReviewFlow'

export default function SegmentPracticePage() {
  const { id } = useParams()
  const segmentId = id ? Number(id) : null
  const [segment, setSegment] = useState<PalaceSegmentSummary | null>(null)
  const [title, setTitle] = useState('')
  const [editorState, setEditorState] = useState<MindMapEditorState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [initialSnapshot, setInitialSnapshot] = useState<ReviewFlowSnapshot | null>(null)
  const [flowKey, setFlowKey] = useState(0)
  const [hasResumeProgress, setHasResumeProgress] = useState(false)

  useEffect(() => {
    if (!segmentId) return
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const payload = await getPalaceSegmentApi(segmentId)
        setSegment(payload.item)
        setTitle(`${payload.palace.title} / ${payload.item.name}`)
        setEditorState({
          editor_doc: payload.editor_doc,
          editor_config: {},
          editor_local_config: {},
          lang: 'zh',
        })
        const progressResponse = await getSegmentPracticeSessionProgressApi(segmentId)
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
        setError(err instanceof Error ? err.message : '加载分块练习内容失败。')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [segmentId])

  if (!segmentId || loading) {
    return <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">正在加载分块练习内容...</div>
  }

  if (!segment || !editorState || error) {
    return <div className="flex min-h-[60vh] items-center justify-center text-sm text-destructive">{error || '未找到可练习的分块。'}</div>
  }

  return (
    <div className="space-y-5">
      <PageIntro
        eyebrow="分块练习"
        title={title}
        compact
        actions={
          <>
            <Link to="/palaces">
              <Button variant="outline" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" />
                返回列表
              </Button>
            </Link>
            {hasResumeProgress ? <Badge variant="secondary">已接续上次练习</Badge> : <Badge variant="outline">分块练习</Badge>}
          </>
        }
      />

      <MindMapReviewFlow
        key={`${segment.id}-${flowKey}`}
        title={title}
        palaceId={segment.palace_id}
        sessionKind="practice"
        displayMode={displayMode}
        persistKey={`practice:segment:${segment.id}`}
        reviewEditorState={editorState}
        editEditorState={editEditorState}
        onModeToggle={() =>
          setDisplayMode((current) => (current === 'edit' ? 'review' : 'edit'))
        }
        onEditEditorStateChange={setEditEditorState}
        initialSnapshot={initialSnapshot}
        persistProgress
        onSnapshotChange={async (snapshot) => {
          if (snapshot.completed) {
            setHasResumeProgress(false)
            await clearSegmentPracticeSessionProgressApi(segment.id)
            return
          }
          setHasResumeProgress(true)
          await saveSegmentPracticeSessionProgressApi(segment.id, {
            completed: snapshot.completed,
            reveal_map: snapshot.revealMap,
            red_node_ids: snapshot.redNodeIds,
          })
        }}
        onRestart={async () => {
          await clearSegmentPracticeSessionProgressApi(segment.id)
          setHasResumeProgress(false)
          setInitialSnapshot(null)
        }}
        onComplete={async () => {
          await clearSegmentPracticeSessionProgressApi(segment.id)
          setHasResumeProgress(false)
        }}
      />
    </div>
  )
}
