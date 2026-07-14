import { ArrowLeft, FileText } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { readMindMapEditorState } from '@/entities/mindmap-document'
import {
  buildAttachmentUrl,
  getPalaceEditorApi,
  savePalaceEditorApi,
  savePalaceEditorWithOptionsApi,
} from '@/entities/palace/api'
import type {
  MindMapEditorState,
  ReviewPalaceSummary,
  ReviewSessionSubmitResponse,
} from '@/shared/api/contracts'
import { useMindMapDocumentSession } from '@/shared/hooks/useMindMapDocumentSession'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { appConfirm } from '@/shared/components/ui/native-dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import {
  MindMapReviewFlow,
  type ReviewFlowSnapshot,
} from './MindMapReviewFlow'
import { StageSelectDialog } from '@/features/review/components/StageSelectDialog'
import {
  consumePrefetchedStudySession,
  type StudyWarmupKind,
} from '@/shared/api/studySessionWarmup'
import type { RevealFlowMode } from '@/entities/review/model/review-flow-tree'
import { ReviewSessionSkeleton } from '@/features/review/ReviewSessionSkeleton'
import { ErrorState } from '@/shared/components/state-placeholders'
import type { CompleteFlowPayload } from '@/features/review/model/mind-map-review-flow'

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
      note?: string
    },
    options?: { mutationId?: string },
  ) => Promise<ReviewSessionSubmitResponse>
  onSubmitted?: (result: ReviewSessionSubmitResponse) => void
  backHref: (chapterId: number | null) => string
  warmupKind?: StudyWarmupKind
  refreshReviewStateOnExitEdit?: boolean
  renderBelowFlow?: (args: {
    session: ReviewSessionContainerSession
    mindMapFullscreen: boolean
  }) => React.ReactNode
}

const inflightReviewSessionLoads = new Map<
  string,
  Promise<{
    session: ReviewSessionContainerSession
    progress: {
      progress: {
        reveal_map: Record<string, 'hidden' | 'placeholder' | 'revealed'>
        red_node_ids: string[]
        completed: boolean
      } | null
    }
  }>
>()

function createCompletionOperationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `review-complete-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
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
            className="block rounded-lg border border-border/70 bg-background/70 px-3 py-3 transition-colors hover:text-foreground"
          >
            <span className="inline-flex items-center gap-2">
              <FileText className="size-4" />
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
  submitSession,
  onSubmitted,
  backHref,
  warmupKind,
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
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [stageDialogOpen, setStageDialogOpen] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [pendingPayload, setPendingPayload] = useState<(CompleteFlowPayload & {
    operationId: string
  }) | null>(null)
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
    isSaving: editorSaving,
    error: editorError,
    reload: reloadEditor,
    flushSave,
  } = useMindMapDocumentSession({
    entityId: activePalaceId,
    adapter: {
      load: getPalaceEditorApi,
      save: savePalaceEditorApi,
      selectMeta: (response) => response.palace as ReviewPalaceSummary,
      selectEditorState: readMindMapEditorState,
    },
    onSaveError: async (nextError, pendingState) => {
      if (!activePalaceId || !nextError.message.includes('危险结构变更')) return false
      const confirmed = await appConfirm(
        '这次保存会让宫殿知识点数量骤减。只有在你确实要大幅删除宫殿结构时才继续。确定继续保存吗？',
        { title: '确认危险保存', tone: 'danger' },
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
      setLoadError(null)
      const inflightKey = `${eyebrow}:${sessionId}`
      const loadSessionAndProgress = () => {
        let pending = inflightReviewSessionLoads.get(inflightKey)
        if (!pending) {
          pending = Promise.all([loadSession(sessionId), loadProgress(sessionId)])
            .then(([nextSession, progressResponse]) => ({
              session: nextSession,
              progress: progressResponse,
            }))
            .finally(() => {
              if (inflightReviewSessionLoads.get(inflightKey) === pending) {
                inflightReviewSessionLoads.delete(inflightKey)
              }
            })
          inflightReviewSessionLoads.set(inflightKey, pending)
        }
        return pending
      }
      const pending = warmupKind
        ? consumePrefetchedStudySession(warmupKind, sessionId, loadSessionAndProgress)
        : loadSessionAndProgress()
      const { session: nextSession, progress: progressResponse } = await pending
      if (!active) return
      setSession(nextSession)
      setReviewEditorState(buildReviewEditorState(nextSession))
      setInitialSnapshot(toSnapshot(progressResponse.progress))
      setDisplayMode('review')
      setModeSyncVersion(0)
    }
    void load().catch((error) => {
      if (!active) return
      setLoadError(error instanceof Error ? error.message : '加载复习会话失败。')
    })
    return () => {
      active = false
    }
  }, [buildReviewEditorState, eyebrow, id, loadAttempt, loadProgress, loadSession, warmupKind])

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
  }, [displayMode, flushSave, id, reloadSession])

  const submitCompletion = useCallback(async (payload: CompleteFlowPayload) => {
    if (!session) {
      payload.cancel()
      return
    }
    setSubmitError(null)
    setPendingPayload({ ...payload, operationId: createCompletionOperationId() })
    setStageDialogOpen(true)
  }, [session])

  const handleStageConfirm = useCallback(async (targetReviewNumber: number, needsPractice: boolean, note: string) => {
    if (!session || !pendingPayload || submitting) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      await flushSave()
      const result = await submitSession(session.id, {
        chapter_id: chapterId ?? undefined,
        duration_seconds: pendingPayload.durationSeconds,
        completion_mode: pendingPayload.completionMode,
        revealed_remaining: pendingPayload.revealedRemaining,
        red_marked_count: pendingPayload.redNodeIds.length,
        target_review_number: targetReviewNumber,
        needs_practice: needsPractice,
        ...(note ? { note } : {}),
      }, { mutationId: pendingPayload.operationId })
      await pendingPayload.finalize()
      setStageDialogOpen(false)
      setPendingPayload(null)
      onSubmitted?.(result)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '复习完成提交失败，请重试。')
    } finally {
      setSubmitting(false)
    }
  }, [chapterId, flushSave, onSubmitted, pendingPayload, session, submitSession, submitting])

  const handleStageCancel = useCallback(() => {
    pendingPayload?.cancel()
    setStageDialogOpen(false)
    setSubmitError(null)
    setPendingPayload(null)
  }, [pendingPayload])

  const palace = session?.palace ?? editorPalace ?? null
  const displayLoadError = displayMode === 'edit' && !editEditorState ? editorError : null
  const waitingForEditorState =
    displayMode === 'edit' &&
    activePalaceId != null &&
    !editEditorState &&
    !displayLoadError

  if (loadError) {
    return (
      <ErrorState
        title="复习会话加载失败"
        description={loadError}
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => setLoadAttempt((value) => value + 1)}>
            重新加载
          </Button>
        }
      />
    )
  }

  if (!session || !reviewEditorState || waitingForEditorState) {
    return <ReviewSessionSkeleton />
  }

  const resolvedEditEditorState = editEditorState ?? reviewEditorState

  if (!palace || !resolvedEditEditorState || displayLoadError) {
    return (
      <ErrorState
        title="复习内容不可用"
        description={displayLoadError || '未找到可复习的宫殿。'}
        action={
          displayLoadError ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void reloadEditor()}>
              重新加载
            </Button>
          ) : null
        }
      />
    )
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
                  <ArrowLeft className="mr-2 size-4" />
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
          studySessionId={String(session.id)}
          revealMode={session.revealMode ?? 'standard'}
          checkpointNodeUids={session.checkpointNodeUids ?? []}
          displayMode={displayMode}
          modeSyncVersion={modeSyncVersion}
          viewMemoryScope={resolvedViewMemoryScope}
          persistKey={`review:${session.id}`}
          reviewEditorState={reviewEditorState}
          editEditorState={resolvedEditEditorState}
          onModeToggle={handleModeToggle}
          onEditEditorStateChange={setEditEditorState}
          submitting={submitting}
          editSaving={editorSaving}
          editError={editorError}
          persistProgress
          initialSnapshot={initialSnapshot}
          onFullscreenChange={setMindMapFullscreen}
          onSnapshotChange={async (snapshot) => {
            if (snapshot.completed) return
            await saveProgress(session.id, {
              completed: snapshot.completed,
              reveal_map: snapshot.revealMap,
              red_node_ids: snapshot.redNodeIds,
            })
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
          submitting={submitting}
          error={submitError}
          onConfirm={handleStageConfirm}
          onCancel={handleStageCancel}
        />
      ) : null}
    </div>
  )
}
