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
import { rateUnratedReviewSessionNodesApi } from '@/features/review/api'
import type {
  MindMapEditorState,
  MindMapRecallRating,
  ReviewCompletionSummary,
  ReviewMemorySummary,
  ReviewPalaceSummary,
  ReviewSessionSubmitResponse,
} from '@/shared/api/contracts'
import { toast } from '@/shared/feedback/toast'
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
import { FsrsCompletionDialog } from '@/features/review/components/FsrsCompletionDialog'
import { useReviewCompletionCoordinator } from '@/features/review/hooks/useReviewCompletionCoordinator'
import {
  consumePrefetchedStudySession,
  type StudyWarmupKind,
} from '@/shared/api/studySessionWarmup'
import type { RevealFlowMode } from '@/entities/review/model/review-flow-tree'
import { ReviewSessionSkeleton } from '@/features/review/ReviewSessionSkeleton'
import { ErrorState } from '@/shared/components/state-placeholders'

type ReviewDisplayMode = 'review' | 'edit'

export interface ReviewSessionContainerSession {
  id: string | number
  palace_id: number | null
  algorithm_used: string
  review_type: string
  review_number: number
  palace: ReviewPalaceSummary | null
  frozen_due_node_uids?: string[]
  due_node_count?: number
  memory_summary?: ReviewMemorySummary
  review_entry_mode?: 'none' | 'node' | 'palace' | null
  review_entry_label?: string | null
  primary_branch_uid?: string | null
  primary_branch_title?: string | null
  revealMode?: RevealFlowMode
  checkpointNodeUids?: string[]
  editor_doc?: Record<string, unknown> | string | null
}

interface ReviewSessionContainerProps {
  eyebrow: string | ((session: ReviewSessionContainerSession) => string)
  buildTitle: (session: ReviewSessionContainerSession) => string
  buildReviewEditorState: (session: ReviewSessionContainerSession) => MindMapEditorState
  /** Optional full-tree rating source for subtree cascade (defaults to flip-card editor state). */
  buildRatingTreeEditorState?: (session: ReviewSessionContainerSession) => MindMapEditorState
  loadSession: (sessionId: string | number) => Promise<ReviewSessionContainerSession>
  loadProgress: (sessionId: string | number) => Promise<{ progress: { reveal_map: Record<string, 'hidden' | 'placeholder' | 'revealed'>; red_node_ids: string[]; completed: boolean } | null }>
  saveProgress: (sessionId: string | number, data: { reveal_map: Record<string, 'hidden' | 'placeholder' | 'revealed'>; red_node_ids: string[]; completed: boolean }) => Promise<unknown>
  loadCompletionSummary: (sessionId: string | number) => Promise<{ item: ReviewCompletionSummary }>
  submitSession: (sessionId: string | number, data: { chapter_id?: number; duration_seconds?: number; completion_mode?: 'manual_complete' | 'auto_complete'; revealed_remaining?: boolean; red_marked_count?: number; note?: string }, options?: { mutationId?: string }) => Promise<ReviewSessionSubmitResponse>
  onSubmitted?: (result: ReviewSessionSubmitResponse) => void
  backHref: (chapterId: number | null) => string
  warmupKind?: StudyWarmupKind
  refreshReviewStateOnExitEdit?: boolean
  renderBelowFlow?: (args: { session: ReviewSessionContainerSession; mindMapFullscreen: boolean }) => React.ReactNode
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


export function normalizeReviewSessionContainerSession(
  session: ReviewSessionContainerSession,
): ReviewSessionContainerSession {
  return session
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
  buildRatingTreeEditorState,
  loadSession,
  loadProgress,
  saveProgress,
  loadCompletionSummary,
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
  const [mindMapFullscreen, setMindMapFullscreen] = useState(false)
  const [displayMode, setDisplayMode] = useState<ReviewDisplayMode>('review')
  const [modeSyncVersion, setModeSyncVersion] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [bulkRating, setBulkRating] = useState(false)
  const modeTransitioningRef = useRef(false)
  const editorReloadRef = useRef<() => Promise<void>>(async () => {})
  const activePalaceId = session?.palace_id ?? null

  const fetchAuthoritativeSession = useCallback(async (sessionId: string | number) => (
    normalizeReviewSessionContainerSession(await loadSession(sessionId))
  ), [loadSession])

  const reloadSession = useCallback(async (sessionId: string | number) => {
    const nextSession = await fetchAuthoritativeSession(sessionId)
    setSession(nextSession)
    setReviewEditorState(buildReviewEditorState(nextSession))
    return nextSession
  }, [buildReviewEditorState, fetchAuthoritativeSession])

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

  const completion = useReviewCompletionCoordinator<
    { session: ReviewSessionContainerSession; summary: ReviewCompletionSummary },
    { note: string },
    ReviewSessionSubmitResponse
  >({
    prepare: async () => {
      if (!id) throw new Error('复习会话编号无效，请返回复习队列后重试。')
      const latestSession = await fetchAuthoritativeSession(id)
      const summary = await loadCompletionSummary(latestSession.id)
      return { session: latestSession, summary: summary.item }
    },
    submit: async ({ target, input, payload, operationId }) => {
      await flushSave()
      const result = await submitSession(target.session.id, {
        chapter_id: chapterId ?? undefined,
        duration_seconds: payload.durationSeconds,
        completion_mode: payload.completionMode,
        revealed_remaining: payload.revealedRemaining,
        red_marked_count: payload.redNodeIds.length,
        ...(input.note ? { note: input.note } : {}),
      }, { mutationId: operationId })
      return { result, persistTimeRecord: false }
    },
    onCompleted: onSubmitted,
  })
  useEffect(() => {
    if (!id) return
    let active = true
    const sessionId = id
    const load = async () => {
      setLoadError(null)
      const inflightKey = `${typeof eyebrow === 'function' ? 'review-session' : eyebrow}:${sessionId}`
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
      const pending = warmupKind && typeof sessionId === 'number'
        ? consumePrefetchedStudySession(warmupKind, sessionId, loadSessionAndProgress)
        : loadSessionAndProgress()
      const { session: prefetchedSession, progress: progressResponse } = await pending
      if (!active) return
      const nextSession = normalizeReviewSessionContainerSession(prefetchedSession)
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
    const sessionId = id
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

  const handleBulkRateUnrated = useCallback(
    async (rating: MindMapRecallRating) => {
      const target = completion.target
      if (!target || bulkRating) return
      const studySessionId = target.session.id
      if (studySessionId == null || studySessionId === '') return

      // Server recomputes the still-unrated set; never re-rate already scored nodes.
      if ((target.summary.unrated_due_node_count ?? 0) <= 0) {
        toast.info('本轮没有未评分节点')
        return
      }

      setBulkRating(true)
      try {
        const operationId =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `bulk-rate-unrated-${Date.now()}-${Math.random().toString(36).slice(2)}`
        const response = await rateUnratedReviewSessionNodesApi(studySessionId, {
          rating,
          operation_id: operationId,
        })
        const affected = response.item.affected_node_count
        const label =
          rating === 1 ? '忘记' : rating === 2 ? '困难' : rating === 3 ? '记得' : '轻松'
        if (affected <= 0) {
          toast.info('本轮没有未评分节点')
        } else {
          toast.success(`已将 ${affected} 个未评分节点记为「${label}」`)
        }
        await completion.retryPreparation()
      } catch (error) {
        toast.error(error instanceof Error && error.message ? error.message : '一键评分失败')
      } finally {
        setBulkRating(false)
      }
    },
    [bulkRating, completion],
  )


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
  const resolvedEyebrow = typeof eyebrow === 'function' ? eyebrow(session) : eyebrow
  // One scope across review/edit so the previous center card can re-anchor after mode switches.
  const resolvedViewMemoryScope = `review-session:${session.id}`
  const frozenDueNodeUids = session.frozen_due_node_uids ?? []

  return (
    <div className="space-y-5">
      {!mindMapFullscreen ? (
        <PageIntro
          eyebrow={resolvedEyebrow}
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
              <Badge variant="secondary">FSRS</Badge>
              {session.review_entry_mode === 'node' && session.primary_branch_title ? (
                <Badge variant="outline">分支 · {session.primary_branch_title}</Badge>
              ) : null}
              <Badge variant="outline">本次 {session.due_node_count ?? frozenDueNodeUids.length} 个到期节点</Badge>
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
          reviewScopeNodeUids={frozenDueNodeUids}
          displayMode={displayMode}
          modeSyncVersion={modeSyncVersion}
          viewMemoryScope={resolvedViewMemoryScope}
          persistKey={`review:${session.id}`}
          reviewEditorState={reviewEditorState}
          editEditorState={resolvedEditEditorState}
          ratingTreeEditorState={
            buildRatingTreeEditorState ? buildRatingTreeEditorState(session) : null
          }
          onModeToggle={handleModeToggle}
          onEditEditorStateChange={setEditEditorState}
          submitting={completion.submitting}
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
          onComplete={completion.requestCompletion}
        />

        {!mindMapFullscreen ? renderAttachments(session) : null}
        {renderBelowFlow?.({ session, mindMapFullscreen })}
      </div>

      <FsrsCompletionDialog
        open={completion.open}
        summary={completion.target?.summary ?? null}
        durationSeconds={completion.durationSeconds}
        submitting={completion.submitting}
        preparing={completion.preparing}
        submissionFailed={completion.submissionFailed}
        bulkRating={bulkRating}
        error={completion.error}
        onRetry={() => void completion.retryPreparation()}
        onRetrySubmission={() => void completion.retrySubmission()}
        onBulkRateUnrated={
          (completion.target?.summary.unrated_due_node_count ?? 0) > 0
            ? (rating) => {
                void handleBulkRateUnrated(rating)
              }
            : undefined
        }
        onConfirm={() => { void completion.confirmCompletion({ note: '' }) }}
        onCancel={completion.cancelCompletion}
      />
    </div>
  )
}
