import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import { LoadingState } from '@/shared/components/state-placeholders'
import { Button } from '@/shared/components/ui/button'
import { appConfirm } from '@/shared/components/ui/native-dialog'
import type { MindMapEditorState, ReviewStageSummary } from '@/shared/api/contracts'
import {
  MindMapReviewFlow,
  type CompleteFlowPayload,
  type MindMapReviewFlowProps,
  type ReviewFlowSnapshot,
} from '@/widgets/mindmap-review-flow'
import { StageSelectDialog } from '@/features/review/components/StageSelectDialog'
import { useReviewCompletionCoordinator } from '@/features/review/hooks/useReviewCompletionCoordinator'
import { consumePrefetchedStudySession, type StudyWarmupKind } from '@/shared/api/studySessionWarmup'

export type { CompleteFlowPayload } from '@/widgets/mindmap-review-flow'

export interface PracticeProgressSnapshot {
  completed: boolean
  reveal_map: ReviewFlowSnapshot['revealMap']
  red_node_ids: string[]
}

interface PracticeProgressResponse {
  progress: PracticeProgressSnapshot | null
}

interface PracticeCompletionResult {
  persistTimeRecord?: boolean
}

export interface PracticeStageTarget {
  id: number
  stage_labels?: string[]
  review_stages?: ReviewStageSummary[]
  review_stage_total?: number | null
  review_stage_completed?: number | null
  current_review_schedule_id?: number | null
}

interface PracticeRouteSession<TData> {
  data: TData
  title: string
  palaceId: number | null
  reviewEditorState: MindMapEditorState
  editEditorState?: MindMapEditorState | null
}

interface PreparedPracticeCompletion<TData> {
  session: PracticeRouteSession<TData>
  data: TData
  target: PracticeStageTarget
  mode: 'stage-backed' | 'plain-practice'
}

interface PracticeRouteConfig<TData, TSession> {
  prefetchKind: StudyWarmupKind
  loadingText: string
  notFoundText: string
  loadSession: (id: number) => Promise<TSession>
  loadProgress: (id: number) => Promise<PracticeProgressResponse>
  buildSession: (session: TSession) => PracticeRouteSession<TData>
  clearProgress: (data: TData) => Promise<unknown>
  saveProgress: (data: TData, snapshot: PracticeProgressSnapshot) => Promise<unknown>
  pageEyebrow: string
  backTo: string
  backLabel: string
  renderBadge: (data: TData, hasResumeProgress: boolean) => ReactNode
  getFlowKey: (data: TData, resetVersion: number) => string
  getPersistKey: (data: TData) => string
  getStageTarget: (data: TData) => PracticeStageTarget
  refreshStageTarget?: (data: TData) => Promise<PracticeRouteSession<TData>>
  completeWithoutStage: (
    data: TData,
    payload: CompleteFlowPayload,
    options: { mutationId: string },
  ) => Promise<PracticeCompletionResult | void>
  submitStage: (
    data: TData,
    payload: CompleteFlowPayload,
    targetReviewNumber: number,
    needsPractice: boolean,
    note: string,
    options: { mutationId: string },
  ) => Promise<PracticeCompletionResult | void>
  flowProps?: (data: TData) => Partial<MindMapReviewFlowProps>
  computeInitialSnapshot?: (
    session: PracticeRouteSession<TData>,
    initialSnapshot: ReviewFlowSnapshot | null,
  ) => ReviewFlowSnapshot | null
  renderAfterFlow?: (data: TData) => ReactNode
  resetFlowOnRestart?: boolean
}

function toInitialSnapshot(progress: PracticeProgressSnapshot | null): ReviewFlowSnapshot | null {
  if (!progress || progress.completed) return null
  return {
    revealMap: progress.reveal_map,
    redNodeIds: progress.red_node_ids,
    completed: progress.completed,
  }
}

function resolvePersistTimeRecord(result: PracticeCompletionResult | void) {
  return typeof result === 'object' && result !== null ? result.persistTimeRecord : undefined
}

function resolvePracticeCompletionMode(target: PracticeStageTarget): 'stage-backed' | 'plain-practice' {
  const labels = target.stage_labels ?? []
  const stages = target.review_stages ?? []
  const total = target.review_stage_total
  const completed = target.review_stage_completed
  const hasScheduleSignals =
    target.current_review_schedule_id != null ||
    labels.length > 0 ||
    stages.length > 0 ||
    (total ?? 0) > 0 ||
    (completed ?? 0) > 0

  if (!hasScheduleSignals) return 'plain-practice'

  if (
    !target.current_review_schedule_id ||
    !Number.isInteger(total) ||
    (total ?? 0) <= 0 ||
    !Number.isInteger(completed) ||
    (completed ?? -1) < 0 ||
    (completed ?? 0) >= (total ?? 0) ||
    labels.length !== total ||
    stages.length !== total ||
    stages.some((stage, index) => stage.review_number !== index || stage.label !== labels[index])
  ) {
    throw new Error('当前复习节点信息不完整或不一致，请返回书架刷新或重新加载结算信息。')
  }

  return 'stage-backed'
}

export function PracticeSessionRoute<TData, TSession>({
  config,
}: {
  config: PracticeRouteConfig<TData, TSession>
}) {
  const { id } = useParams()
  const routeId = id ? Number(id) : null
  const [session, setSession] = useState<PracticeRouteSession<TData> | null>(null)
  const [displayMode, setDisplayMode] = useState<'review' | 'edit'>('review')
  const [editEditorState, setEditEditorState] = useState<MindMapEditorState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [initialSnapshot, setInitialSnapshot] = useState<ReviewFlowSnapshot | null>(null)
  const [resetVersion, setResetVersion] = useState(0)
  const [hasResumeProgress, setHasResumeProgress] = useState(false)

  useEffect(() => {
    if (!routeId) return
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const { session: loadedSession, progress: progressResponse } =
          await consumePrefetchedStudySession(config.prefetchKind, routeId, () =>
            Promise.all([config.loadSession(routeId), config.loadProgress(routeId)]).then(
              ([nextSession, progress]) => ({ session: nextSession, progress }),
            ),
          )
        const nextSession = config.buildSession(loadedSession)
        setSession(nextSession)
        setEditEditorState(nextSession.editEditorState ?? null)
        const progress = progressResponse.progress
        setHasResumeProgress(Boolean(progress && !progress.completed))
        setInitialSnapshot(toInitialSnapshot(progress))
      } catch (err) {
        setError(err instanceof Error ? err.message : config.notFoundText)
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [config, routeId])

  const completion = useReviewCompletionCoordinator<
    PreparedPracticeCompletion<TData>,
    { targetReviewNumber: number; needsPractice: boolean; note: string },
    void
  >({
    prepare: async () => {
      if (!session) throw new Error('练习会话尚未加载完成。')
      let activeSession = session
      if (config.refreshStageTarget) {
        const refreshed = await config.refreshStageTarget(session.data)
        if (refreshed) {
          activeSession = refreshed
          setSession(refreshed)
          setEditEditorState(refreshed.editEditorState ?? null)
        }
      }
      const target = config.getStageTarget(activeSession.data)
      const mode = resolvePracticeCompletionMode(target)
      return { session: activeSession, data: activeSession.data, target, mode }
    },
    submit: async ({ target: prepared, input, payload, operationId }) => {
      const result = prepared.mode === 'stage-backed'
        ? await config.submitStage(
            prepared.data,
            payload,
            input.targetReviewNumber,
            input.needsPractice,
            input.note,
            { mutationId: operationId },
          )
        : await config.completeWithoutStage(prepared.data, payload, { mutationId: operationId })
      return { result: undefined, persistTimeRecord: resolvePersistTimeRecord(result) }
    },
    onCompleted: () => setHasResumeProgress(false),
  })

  const effectiveInitialSnapshot = useMemo(() => {
    if (!session) return initialSnapshot
    return config.computeInitialSnapshot?.(session, initialSnapshot) ?? initialSnapshot
  }, [config, initialSnapshot, session])

  if (!routeId || loading) {
    return <LoadingState text={config.loadingText} />
  }

  if (!session || error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-destructive">
        {error || config.notFoundText}
      </div>
    )
  }

  const data = session.data
  const stageTarget = config.getStageTarget(data)

  return (
    <div className="space-y-5">
      <PageIntro
        eyebrow={config.pageEyebrow}
        title={session.title}
        compact
        actions={
          <>
            <Link to={config.backTo}>
              <Button variant="outline" size="sm">
                <ArrowLeft className="mr-2 size-4" />
                {config.backLabel}
              </Button>
            </Link>
            {config.renderBadge(data, hasResumeProgress)}
          </>
        }
      />

      <MindMapReviewFlow
        key={config.getFlowKey(data, resetVersion)}
        title={session.title}
        palaceId={session.palaceId}
        sessionKind="practice"
        studySessionId={`practice:${session.palaceId}:${resetVersion}`}
        displayMode={displayMode}
        persistKey={config.getPersistKey(data)}
        reviewEditorState={session.reviewEditorState}
        editEditorState={editEditorState}
        onModeToggle={() => setDisplayMode((current) => (current === 'edit' ? 'review' : 'edit'))}
        onEditEditorStateChange={setEditEditorState}
        initialSnapshot={effectiveInitialSnapshot}
        persistProgress
        onSnapshotChange={async (snapshot) => {
          if (snapshot.completed) {
            setHasResumeProgress(false)
            await config.clearProgress(data)
            return
          }
          setHasResumeProgress(true)
          await config.saveProgress(data, {
            completed: snapshot.completed,
            reveal_map: snapshot.revealMap,
            red_node_ids: snapshot.redNodeIds,
          })
        }}
        onRestart={async () => {
          const confirmed = await appConfirm(
            '确定重新开始本次练习吗？此操作不可撤销，会清空当前练习进度并从头开始。',
            {
              title: '重新开始练习',
              confirmText: '重新开始',
              tone: 'danger',
            },
          )
          if (!confirmed) return false
          await config.clearProgress(data)
          setHasResumeProgress(false)
          setInitialSnapshot(null)
          if (config.resetFlowOnRestart) {
            setResetVersion((current) => current + 1)
          }
          return true
        }}
        submitting={completion.submitting}
        onComplete={completion.requestCompletion}
        {...config.flowProps?.(data)}
      />

      {config.renderAfterFlow?.(data)}


      <StageSelectDialog
        open={completion.open}
        stageLabels={completion.target?.target.stage_labels ?? []}
        stages={completion.target?.target.review_stages ?? []}
        currentReviewNumber={Math.max(
          0,
          completion.target?.target.review_stage_completed ?? stageTarget.review_stage_completed ?? 0,
        )}
        durationSeconds={completion.durationSeconds}
        submitting={completion.submitting}
        preparing={completion.preparing}
        preparationFailed={completion.preparationFailed}
        submissionFailed={completion.submissionFailed}
        requiresStages={
          completion.target?.mode === 'stage-backed' ||
          (completion.target == null && (
            stageTarget.current_review_schedule_id != null ||
            (stageTarget.review_stage_total ?? 0) > 0 ||
            (stageTarget.stage_labels?.length ?? 0) > 0 ||
            (stageTarget.review_stages?.length ?? 0) > 0
          ))
        }
        error={completion.error}
        onRetry={() => void completion.retryPreparation()}
        onRetrySubmission={() => void completion.retrySubmission()}
        onConfirm={(targetReviewNumber, needsPractice, note) => {
          void completion.confirmCompletion({ targetReviewNumber, needsPractice, note })
        }}
        onCancel={completion.cancelCompletion}
      />
    </div>
  )
}
