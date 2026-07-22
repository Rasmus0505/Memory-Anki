import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import { LoadingState } from '@/shared/components/state-placeholders'
import { appConfirm } from '@/shared/components/ui/native-dialog'
import type { MindMapEditorState } from '@/shared/api/contracts'
import {
  MindMapReviewFlow,
  type CompleteFlowPayload,
  type MindMapReviewFlowProps,
  type ReviewFlowSnapshot,
} from '@/widgets/mindmap-review-flow'
import { PracticeCompletionDialog } from '@/modules/practice/public'
import { useReviewCompletionCoordinator } from '@/modules/practice/public'
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
  renderBadge: (data: TData, hasResumeProgress: boolean) => ReactNode
  getFlowKey: (data: TData, resetVersion: number) => string
  getPersistKey: (data: TData) => string
  completePractice?: (
    data: TData,
    payload: CompleteFlowPayload,
    note: string,
    options: { mutationId: string },
  ) => Promise<PracticeCompletionResult | void>
  getStageTarget?: (data: TData) => PracticeStageTarget
  refreshStageTarget?: (data: TData) => Promise<PracticeRouteSession<TData>>
  completeWithoutStage?: (data: TData, payload: CompleteFlowPayload, options: { mutationId: string }) => Promise<PracticeCompletionResult | void>
  submitStage?: (data: TData, payload: CompleteFlowPayload, targetReviewNumber: number, needsPractice: boolean, note: string, options: { mutationId: string }) => Promise<PracticeCompletionResult | void>
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
    PracticeRouteSession<TData>,
    { note: string },
    void
  >({
    prepare: async () => {
      if (!session) throw new Error('练习会话尚未加载完成。')
      return session
    },
    submit: async ({ target, input, payload, operationId }) => {
      const result = config.completePractice
        ? await config.completePractice(target.data, payload, input.note, { mutationId: operationId })
        : await config.completeWithoutStage?.(target.data, payload, { mutationId: operationId })
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

  return (
    <div className="space-y-5">
      <PageIntro
        eyebrow={config.pageEyebrow}
        title={session.title}
        compact
        actions={config.renderBadge(data, hasResumeProgress)}
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


      <PracticeCompletionDialog
        open={completion.open}
        durationSeconds={completion.durationSeconds}
        submitting={completion.submitting}
        error={completion.error}
        onRetry={() => void completion.retrySubmission()}
        onConfirm={(note) => { void completion.confirmCompletion({ note }) }}
        onCancel={completion.cancelCompletion}
      />
    </div>
  )
}
