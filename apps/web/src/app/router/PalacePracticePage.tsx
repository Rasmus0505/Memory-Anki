import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import type { MindMapEditorState } from '@/shared/api/contracts'
import {
  MindMapReviewFlow,
  type ReviewFlowSnapshot,
} from '@/features/review/components/MindMapReviewFlow'
import {
  clearPracticeSessionProgressApi,
  getPalaceEditorApi,
  getPracticeSessionProgressApi,
  savePracticeSessionProgressApi,
  togglePalaceFocusNodeApi,
  updatePalacePracticeFlagApi,
} from '@/shared/api/modules/palaces'

interface PalaceMeta {
  id: number
  title: string
  description: string
  archived: boolean
  mastered: boolean
  focus_node_uids?: string[]
  focus_count?: number
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
        const editor = await getPalaceEditorApi(palaceId)
        const data = editor
        setPalace(data.palace as PalaceMeta)
        setEditorState({
          editor_doc: editor.editor_doc,
          editor_config: editor.editor_config,
          editor_local_config: editor.editor_local_config,
          lang: editor.lang,
        })
        const progressResponse = await getPracticeSessionProgressApi(palaceId)
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
  }, [hasResumeProgress, palaceId])

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
        compact
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

      <MindMapReviewFlow
        key={`${palace.id}-${flowKey}`}
        title={palace.title}
        palaceId={palace.id}
        sessionKind="practice"
        persistKey={`practice:palace:${palace.id}`}
        reviewEditorState={editorState}
        initialSnapshot={initialSnapshot}
        focusNodeUids={palace.focus_node_uids ?? []}
        persistProgress
        onSnapshotChange={async (snapshot) => {
          if (snapshot.completed) {
            setHasResumeProgress(false)
            await clearPracticeSessionProgressApi(palace.id)
            return
          }
          setHasResumeProgress(true)
          await savePracticeSessionProgressApi(palace.id, {
            completed: snapshot.completed,
            reveal_map: snapshot.revealMap,
            red_node_ids: snapshot.redNodeIds,
          })
        }}
        onRestart={async () => {
          await clearPracticeSessionProgressApi(palace.id)
          setHasResumeProgress(false)
          setInitialSnapshot(null)
        }}
        onComplete={async () => {
          await clearPracticeSessionProgressApi(palace.id)
          await updatePalacePracticeFlagApi(palace.id, { needs_practice: false })
          setHasResumeProgress(false)
        }}
        onToggleFocusNode={async (nodeUid) => {
          await togglePalaceFocusNodeApi(
            palace.id,
            nodeUid,
            !(palace.focus_node_uids ?? []).includes(nodeUid),
          )
        }}
      />
    </div>
  )
}
