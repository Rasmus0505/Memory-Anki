import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import { LoadingState } from '@/shared/components/state-placeholders'
import { Button } from '@/shared/components/ui/button'
import type { MindMapEditorState, ReviewStageSummary } from '@/shared/api/contracts'
import {
  MindMapReviewFlow,
  type CompleteFlowPayload,
  type MindMapReviewFlowProps,
  type ReviewFlowSnapshot,
} from '@/features/review/components/MindMapReviewFlow'
import { StageSelectDialog } from '@/features/review/components/StageSelectDialog'
import { consumePrefetchedStudySession, type StudyWarmupKind } from '@/features/review/studyWarmup'

export type { CompleteFlowPayload } from '@/features/review/components/MindMapReviewFlow'

export interface PracticeProgressSnapshot {
  completed: boolean
  reveal_map: ReviewFlowSnapshot['revealMap']
  red_node_ids: string[]
}

interface PracticeProgressResponse {
  progress: PracticeProgressSnapshot | null
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
  completeWithoutStage: (data: TData, payload: CompleteFlowPayload) => Promise<void>
  submitStage: (
    data: TData,
    payload: CompleteFlowPayload,
    targetReviewNumber: number,
    needsPractice: boolean,
  ) => Promise<void>
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

function hasStageChoices(target: PracticeStageTarget) {
  return Boolean(target.stage_labels?.length && target.review_stages?.length)
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
  const [stageDialogOpen, setStageDialogOpen] = useState(false)
  const [pendingPayload, setPendingPayload] = useState<CompleteFlowPayload | null>(null)
  const [submitting, setSubmitting] = useState(false)

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
          await config.clearProgress(data)
          setHasResumeProgress(false)
          setInitialSnapshot(null)
          if (config.resetFlowOnRestart) {
            setResetVersion((current) => current + 1)
          }
        }}
        submitting={submitting}
        onComplete={async (payload) => {
          let activeSession = session
          let activeData = data
          let activeStageTarget = stageTarget
          if (!hasStageChoices(activeStageTarget) && (activeStageTarget.review_stage_total ?? 0) > 0) {
            const refreshed = await config.refreshStageTarget?.(activeData)
            if (refreshed) {
              activeSession = refreshed
              activeData = refreshed.data
              activeStageTarget = config.getStageTarget(activeData)
              setSession(activeSession)
              setEditEditorState(refreshed.editEditorState ?? editEditorState)
            }
          }
          if (hasStageChoices(activeStageTarget)) {
            setPendingPayload(payload)
            setStageDialogOpen(true)
            return
          }
          setSubmitting(true)
          try {
            await config.completeWithoutStage(activeData, payload)
            setHasResumeProgress(false)
          } finally {
            setSubmitting(false)
          }
        }}
        {...config.flowProps?.(data)}
      />

      {config.renderAfterFlow?.(data)}

      {hasStageChoices(stageTarget) && pendingPayload ? (
        <StageSelectDialog
          open={stageDialogOpen}
          stageLabels={stageTarget.stage_labels ?? []}
          stages={stageTarget.review_stages ?? []}
          currentReviewNumber={Math.max(0, (stageTarget.review_stage_completed ?? 0) - 1)}
          durationSeconds={pendingPayload.durationSeconds}
          onConfirm={async (targetReviewNumber, needsPractice) => {
            setStageDialogOpen(false)
            if (!pendingPayload) return
            setSubmitting(true)
            try {
              await config.submitStage(data, pendingPayload, targetReviewNumber, needsPractice)
              setHasResumeProgress(false)
            } finally {
              setSubmitting(false)
              setPendingPayload(null)
            }
          }}
          onCancel={() => {
            setStageDialogOpen(false)
            setPendingPayload(null)
          }}
        />
      ) : null}
    </div>
  )
}
