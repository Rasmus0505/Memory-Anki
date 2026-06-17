import { ArrowLeft, FileText } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { LoadingState } from '@/shared/components/state-placeholders'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  buildAttachmentUrl,
  getPalaceEditorApi,
  togglePalaceFocusNodeApi,
} from '@/shared/api/modules/palaces/catalogApi'
import {
  savePalaceEditorApi,
  savePalaceEditorWithOptionsApi,
} from '@/shared/api/modules/palaces/editorApi'
import type {
  MindMapEditorState,
  MiniPalaceSummary,
  ReviewPalaceSummary,
} from '@/shared/api/contracts'
import { usePersistedMindMapEditor } from '@/shared/hooks/usePersistedMindMapEditor'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import {
  MindMapReviewFlow,
  type ReviewFlowSnapshot,
} from '@/features/review/components/MindMapReviewFlow'
import { StageSelectDialog } from '@/features/review/components/StageSelectDialog'
import type { RevealFlowMode } from '@/entities/review/model/review-flow-tree'

type ReviewDisplayMode = 'review' | 'edit'

export interface ReviewSessionContainerSession {
  id: number
  palace_id: number | null
  algorithm_used: string
  review_type: string
  review_number: number
  palace: ReviewPalaceSummary | null
  stageLabels: string[] | null
  revealMode?: RevealFlowMode
  checkpointNodeUids?: string[]
  mini_palace?: MiniPalaceSummary | null
  editor_doc?: Record<string, unknown> | string | null
  reviewStages: Array<{
    review_number: number
    label: string
    completed: boolean
    completed_at: string | null
    scheduled_at: string | null
  }> | null
}

interface ReviewSessionContainerProps {
  eyebrow: string
  buildTitle: (session: ReviewSessionContainerSession) => string
  buildReviewEditorState: (session: ReviewSessionContainerSession) => MindMapEditorState
  loadSession: (sessionId: number) => Promise<ReviewSessionContainerSession>
  loadProgress: (sessionId: number) => Promise<{ progress: {
    reveal_map: Record<string, 'hidden' | 'placeholder' | 'revealed'>
    red_node_ids: string[]
    completed: boolean
  } | null }>
  saveProgress: (
    sessionId: number,
    data: {
      reveal_map: Record<string, 'hidden' | 'placeholder' | 'revealed'>
      red_node_ids: string[]
      completed: boolean
    },
  ) => Promise<unknown>
  clearProgress: (sessionId: number) => Promise<unknown>
  submitSession: (
    sessionId: number,
    data: {
      chapter_id?: number
      duration_seconds?: number
      completion_mode?: 'manual_complete' | 'auto_complete'
      revealed_remaining?: boolean
      red_marked_count?: number
      target_review_number?: number
      needs_practice?: boolean
    },
  ) => Promise<unknown>
  backHref: (chapterId: number | null) => string
  refreshReviewStateOnExitEdit?: boolean
  renderBelowFlow?: (args: {
    session: ReviewSessionContainerSession
    mindMapFullscreen: boolean
  }) => React.ReactNode
}

function formatReviewStage(reviewType: string, reviewNumber: number) {
  if (reviewType === '1h') return '首日 1 小时'
  if (reviewType === 'sleep') return '首日睡前'
  return `第 ${reviewNumber + 1} 次`
}

function toSnapshot(progress: {
  reveal_map: Record<string, 'hidden' | 'placeholder' | 'revealed'>
  red_node_ids: string[]
  completed: boolean
} | null): ReviewFlowSnapshot | null {
  if (!progress || progress.completed) return null
  return {
    revealMap: progress.reveal_map,
    redNodeIds: progress.red_node_ids,
    completed: progress.completed,
  }
}

function renderAttachments(session: ReviewSessionContainerSession) {
  if (!session.palace?.attachments.length) return null
  return (
    <Card className="border-border/70 bg-card/92">
      <CardHeader>
        <CardTitle className="text-base">附件</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {session.palace.attachments.map((attachment) => (
          <a
            key={attachment.id}
            href={buildAttachmentUrl(attachment.id)}
            target="_blank"
            className="block rounded-2xl border border-border/70 bg-background/70 px-3 py-3 transition-colors hover:text-foreground"
          >
            <span className="inline-flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {attachment.original_name}
            </span>
          </a>
        ))}
      </CardContent>
    </Card>
  )
}

export function ReviewSessionContainer({
  eyebrow,
  buildTitle,
  buildReviewEditorState,
  loadSession,
  loadProgress,
  saveProgress,
  clearProgress,
  submitSession,
  backHref,
  refreshReviewStateOnExitEdit = false,
  renderBelowFlow,
}: ReviewSessionContainerProps) {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const chapterIdParam = searchParams.get('chapterId')
  const chapterId = chapterIdParam ? Number(chapterIdParam) : null
  const [session, setSession] = useState<ReviewSessionContainerSession | null>(null)
  const [reviewEditorState, setReviewEditorState] = useState<MindMapEditorState | null>(null)
  const [initialSnapshot, setInitialSnapshot] = useState<ReviewFlowSnapshot | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [mindMapFullscreen, setMindMapFullscreen] = useState(false)
  const [displayMode, setDisplayMode] = useState<ReviewDisplayMode>('review')
  const [modeSyncVersion, setModeSyncVersion] = useState(0)
  const [stageDialogOpen, setStageDialogOpen] = useState(false)
  const [pendingPayload, setPendingPayload] = useState<{
    durationSeconds: number
    completionMode: 'manual_complete' | 'auto_complete'
    revealedRemaining: boolean
    redNodeIds: string[]
  } | null>(null)
  const modeTransitioningRef = useRef(false)
  const editorReloadRef = useRef<() => Promise<void>>(async () => {})
  const activePalaceId = session?.palace_id ?? null

  const reloadSession = useCallback(async (sessionId: number) => {
    const nextSession = await loadSession(sessionId)
    setSession(nextSession)
    setReviewEditorState(buildReviewEditorState(nextSession))
    return nextSession
  }, [buildReviewEditorState, loadSession])

  const {
    meta: editorPalace,
    editorState: editEditorState,
    setEditorState: setEditEditorState,
    isLoading: editorLoading,
    isSaving: editorSaving,
    error: editorError,
    reload: reloadEditor,
    flushSave,
  } = usePersistedMindMapEditor({
    entityId: activePalaceId,
    fetcher: getPalaceEditorApi,
    saver: savePalaceEditorApi,
    selectMeta: (response) => response.palace as ReviewPalaceSummary,
    selectEditorState: (response) => ({
      editor_doc: response.editor_doc,
      editor_config: response.editor_config,
      editor_local_config: response.editor_local_config,
      lang: response.lang,
      editor_fingerprint: response.editor_fingerprint,
    }),
    onSaveError: async (nextError, pendingState) => {
      if (!activePalaceId || !nextError.message.includes('危险结构变更')) return false
      const confirmed = window.confirm(
        '这次保存会让宫殿节点数量骤减。只有在你确实要大幅删除宫殿结构时才继续。确定继续保存吗？',
      )
      if (!confirmed) return true
      await savePalaceEditorWithOptionsApi(activePalaceId, {
        ...pendingState,
        confirm_dangerous_change: true,
        editor_source: 'palace_edit',
      })
      await editorReloadRef.current()
      setModeSyncVersion((value) => value + 1)
      return true
    },
  })

  useEffect(() => {
    editorReloadRef.current = reloadEditor
  }, [reloadEditor])

  useEffect(() => {
    if (!id) return
    let active = true
    const sessionId = Number(id)
    const load = async () => {
      const [nextSession, progressResponse] = await Promise.all([
        loadSession(sessionId),
        loadProgress(sessionId),
      ])
      if (!active) return
      setSession(nextSession)
      setReviewEditorState(buildReviewEditorState(nextSession))
      setInitialSnapshot(toSnapshot(progressResponse.progress))
      setDisplayMode('review')
      setModeSyncVersion(0)
    }
    void load()
    return () => {
      active = false
    }
  }, [buildReviewEditorState, id, loadProgress, loadSession])

  const handleModeToggle = useCallback(async () => {
    if (!id || modeTransitioningRef.current) return
    modeTransitioningRef.current = true
    const sessionId = Number(id)
    try {
      if (displayMode === 'edit') {
        await flushSave()
        await reloadSession(sessionId)
      }
      setDisplayMode((current) => (current === 'edit' ? 'review' : 'edit'))
      setModeSyncVersion((current) => current + 1)
    } finally {
      modeTransitioningRef.current = false
    }
  }, [displayMode, flushSave, id, refreshReviewStateOnExitEdit, reloadSession])

  const submitCompletion = useCallback(async (payload: {
    durationSeconds: number
    completionMode: 'manual_complete' | 'auto_complete'
    revealedRemaining: boolean
    redNodeIds: string[]
  }) => {
    if (!session) return
    await flushSave()
    await clearProgress(session.id)
    if (payload.completionMode === 'auto_complete') {
      setSubmitting(true)
      try {
        await submitSession(session.id, {
          chapter_id: chapterId ?? undefined,
          duration_seconds: payload.durationSeconds,
          completion_mode: payload.completionMode,
          revealed_remaining: payload.revealedRemaining,
          red_marked_count: payload.redNodeIds.length,
        })
      } finally {
        setSubmitting(false)
      }
      return
    }
    setPendingPayload(payload)
    setStageDialogOpen(true)
  }, [chapterId, clearProgress, flushSave, session, submitSession])

  const handleStageConfirm = useCallback(async (targetReviewNumber: number, needsPractice: boolean) => {
    if (!session || !pendingPayload) return
    setStageDialogOpen(false)
    setSubmitting(true)
    try {
      await flushSave()
      await submitSession(session.id, {
        chapter_id: chapterId ?? undefined,
        duration_seconds: pendingPayload.durationSeconds,
        completion_mode: pendingPayload.completionMode,
        revealed_remaining: pendingPayload.revealedRemaining,
        red_marked_count: pendingPayload.redNodeIds.length,
        target_review_number: targetReviewNumber,
        needs_practice: needsPractice,
      })
    } finally {
      setSubmitting(false)
      setPendingPayload(null)
    }
  }, [chapterId, flushSave, pendingPayload, session, submitSession])

  const handleStageCancel = useCallback(() => {
    setStageDialogOpen(false)
    setPendingPayload(null)
  }, [])

  const palace = session?.palace ?? editorPalace ?? null
  const displayLoadError = (!reviewEditorState || !editEditorState) ? editorError : null
  const waitingForEditorState =
    activePalaceId != null && !editEditorState && !displayLoadError

  if (!session || !reviewEditorState || editorLoading || waitingForEditorState) {
    return <LoadingState text="正在加载复习会话…" />
  }

  if (!palace || !editEditorState || displayLoadError) {
    return <div className="flex items-center justify-center py-32 text-sm text-destructive">{displayLoadError || '未找到可复习的宫殿。'}</div>
  }

  const title = buildTitle(session)
  const resolvedViewMemoryScope = `review-session:${session.id}:${displayMode}`

  return (
    <div className="space-y-5">
      {!mindMapFullscreen ? (
        <PageIntro
          eyebrow={eyebrow}
          title={title}
          compact
          actions={
            <>
              <Link to={backHref(chapterId)}>
                <Button variant="outline" size="sm">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  返回复习队列
                </Button>
              </Link>
              <Badge variant={displayMode === 'edit' ? 'secondary' : 'outline'}>
                {displayMode === 'edit' ? '内联编辑中' : '翻卡复习中'}
              </Badge>
              <Badge variant="secondary">{session.algorithm_used}</Badge>
              <Badge variant="outline">{formatReviewStage(session.review_type, session.review_number)}</Badge>
            </>
          }
        />
      ) : null}

      <div className="space-y-4">
        <MindMapReviewFlow
          title={title}
          palaceId={palace.id}
          sessionKind="review"
          revealMode={session.revealMode ?? 'standard'}
          checkpointNodeUids={session.checkpointNodeUids ?? []}
          displayMode={displayMode}
          modeSyncVersion={modeSyncVersion}
          viewMemoryScope={resolvedViewMemoryScope}
          persistKey={`review:${session.id}`}
          reviewEditorState={reviewEditorState}
          editEditorState={editEditorState}
          onModeToggle={handleModeToggle}
          onEditEditorStateChange={setEditEditorState}
          submitting={submitting}
          editSaving={editorSaving}
          editError={editorError}
          persistProgress
          initialSnapshot={initialSnapshot}
          focusNodeUids={palace.focus_node_uids ?? []}
          onFullscreenChange={setMindMapFullscreen}
          onSnapshotChange={async (snapshot) => {
            if (snapshot.completed) {
              await clearProgress(session.id)
              return
            }
            await saveProgress(session.id, {
              completed: snapshot.completed,
              reveal_map: snapshot.revealMap,
              red_node_ids: snapshot.redNodeIds,
            })
          }}
          onToggleFocusNode={async (nodeUid) => {
            await togglePalaceFocusNodeApi(
              palace.id,
              nodeUid,
              !(palace.focus_node_uids ?? []).includes(nodeUid),
            )
          }}
          onComplete={submitCompletion}
        />

        {!mindMapFullscreen ? renderAttachments(session) : null}
        {renderBelowFlow?.({ session, mindMapFullscreen })}
      </div>

      {session.stageLabels && session.reviewStages ? (
        <StageSelectDialog
          open={stageDialogOpen}
          stageLabels={session.stageLabels}
          stages={session.reviewStages}
          currentReviewNumber={session.review_number}
          durationSeconds={pendingPayload?.durationSeconds}
          onConfirm={handleStageConfirm}
          onCancel={handleStageCancel}
        />
      ) : null}
    </div>
  )
}
