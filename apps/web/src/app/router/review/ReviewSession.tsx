import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, RotateCcw } from 'lucide-react'
import {
  closeUnitReviewEncounterApi,
  completeUnitReviewSessionApi,
  getUnitReviewSessionApi,
  openUnitReviewEncounterApi,
  rateReviewUnitApi,
  undoReviewUnitRatingApi,
  type ReviewUnitDto,
  type UnitRating,
  type UnitRatingEffectDto,
  type UnitReviewSessionDto,
} from '@/modules/practice/public'
import { FlipCardMindMapPanel } from '@/widgets/mindmap-review-flow'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { ErrorState, LoadingState } from '@/shared/components/state-placeholders'

const RATINGS: Array<{ value: UnitRating; label: string; tone: string }> = [
  { value: 1, label: '忘记', tone: 'border-destructive/40 text-destructive' },
  { value: 2, label: '困难', tone: 'border-warning/50 text-warning-foreground' },
  { value: 3, label: '记得', tone: 'border-primary/40 text-primary' },
  { value: 4, label: '轻松', tone: 'border-success/40 text-success' },
]

function operationId() {
  return crypto.randomUUID?.() ?? `unit-rating-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function retryLabel(count: number) {
  const normalized = Math.max(0, Math.min(3, Math.round(count)))
  return normalized === 0 ? '立即重练' : `${normalized}张后重练`
}

function effectLabel(effect: UnitRatingEffectDto, retryAfterCards: number) {
  if (!effect.passed) {
    const stage = effect.rating === 1
      ? `重置${effect.target_interval_days}天级`
      : effect.stage_action === 'lower'
        ? `降至${effect.target_interval_days}天级`
        : `保持${effect.target_interval_days}天级`
    return `${retryLabel(retryAfterCards)} · ${stage}`
  }
  const [, month, day] = effect.target_due_date.split('-').map(Number)
  const due = month && day ? `${month}月${day}日` : effect.target_due_date
  return `${effect.target_interval_days}天后复习 · ${due}`
}

export function buildUnitReviewEditorState(session: UnitReviewSessionDto): MindMapEditorState {
  return {
    editor_doc: session.palace?.editor_doc as MindMapEditorState['editor_doc'],
    editor_config: {},
    editor_local_config: {},
    lang: 'zh',
  }
}

export function buildNextUnitQueue(queue: string[], current: ReviewUnitDto): string[] {
  const remaining = queue.filter((id) => id !== current.id)
  if (current.session_status === 'retry') {
    remaining.splice(Math.min(3, remaining.length), 0, current.id)
  }
  return remaining
}

export default function ReviewSession() {
  const { id: sessionId = '' } = useParams()
  const navigate = useNavigate()
  const [session, setSession] = useState<UnitReviewSessionDto | null>(null)
  const [queue, setQueue] = useState<string[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [lastOperationId, setLastOperationId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const openingEncounterRef = useState(() => new Set<string>())[0]

  const reload = useCallback(async () => {
    const next = await getUnitReviewSessionApi(sessionId)
    setSession(next)
    setQueue((previous) => previous.length ? previous.filter((id) => next.units.some((unit) => unit.id === id)) : next.units.map((unit) => unit.id))
    setCurrentId((previous) => previous && next.units.some((unit) => unit.id === previous) ? previous : next.units[0]?.id ?? null)
    return next
  }, [sessionId])

  useEffect(() => {
    void reload().catch((reason) => setError(reason instanceof Error ? reason.message : '加载复习失败'))
  }, [reload])

  const current = useMemo(
    () => session?.units.find((unit) => unit.id === currentId) ?? null,
    [currentId, session],
  )
  const allUnitNodes = useMemo(() => new Set(session?.units.flatMap((unit) => unit.node_uids) ?? []), [session])
  const mutedNodeUids = useMemo(
    () => current ? [...allUnitNodes].filter((uid) => !current.node_uids.includes(uid)) : [],
    [allUnitNodes, current],
  )

  useEffect(() => {
    if (!session || !current || busy) return
    if (current.session_status === 'passed' && current.encounter?.status === 'closed') return
    if (current.encounter?.status === 'open') return
    const key = `${session.id}:${current.id}:${current.retry_count}`
    if (openingEncounterRef.has(key)) return
    openingEncounterRef.add(key)
    void openUnitReviewEncounterApi(
      session.id,
      current,
      `formal:${session.id}`,
      operationId(),
    ).then((next) => {
      setSession(next)
    }).catch((reason) => {
      setError(reason instanceof Error ? reason.message : '创建复习出现失败')
    }).finally(() => {
      openingEncounterRef.delete(key)
    })
  }, [busy, current, openingEncounterRef, session])

  async function rate(rating: UnitRating) {
    if (
      !current
      || !session
      || !current.encounter
      || current.encounter.status !== 'open'
      || current.encounter.selected_rating === rating
      || busy
    ) return
    setBusy(true)
    setError(null)
    const id = operationId()
    try {
      await rateReviewUnitApi(session.id, current, current.encounter.id, rating, id)
      setLastOperationId(id)
      await reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '评分失败')
    } finally {
      setBusy(false)
    }
  }

  async function undo() {
    if (!lastOperationId || busy) return
    setBusy(true)
    try {
      await undoReviewUnitRatingApi(lastOperationId)
      setLastOperationId(null)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  async function closeCurrent() {
    if (
      !current
      || !session
      || !current.encounter
      || current.encounter.status !== 'open'
      || current.encounter.selected_rating == null
    ) {
      return session
    }
    await closeUnitReviewEncounterApi(
      session.id,
      current.id,
      current.encounter.id,
      operationId(),
    )
    return reload()
  }

  async function nextUnit() {
    if (!current || !session) return
    setBusy(true)
    setError(null)
    try {
      const nextSession = await closeCurrent()
      const settled = nextSession?.units.find((unit) => unit.id === current.id) ?? current
      const remaining = buildNextUnitQueue(queue, settled)
      const nextId = remaining.find(
        (id) => nextSession?.units.find((unit) => unit.id === id)?.session_status !== 'passed',
      )
      setQueue(remaining)
      setCurrentId(nextId ?? remaining[0] ?? current.id)
      setLastOperationId(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '切换复习单元失败')
    } finally {
      setBusy(false)
    }
  }

  async function complete() {
    if (!session || busy) return
    setBusy(true)
    try {
      await closeCurrent()
      await completeUnitReviewSessionApi(session.id)
      navigate(`/review/completed/${session.id}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '结算失败')
    } finally {
      setBusy(false)
    }
  }

  if (error && !session) return <ErrorState title="复习加载失败" description={error} />
  if (!session || !current) return <LoadingState text="正在加载复习单元…" />
  const allPassed = session.units.every((unit) => unit.session_status === 'passed')
  const state = buildUnitReviewEditorState(session)
  const retryAfterCards = Math.min(3, Math.max(0, queue.length - 1))
  const selectedEffect = current.encounter?.rating_effects.find(
    (effect) => effect.rating === current.encounter?.selected_rating,
  )

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
        <div>
          <div className="text-xs text-muted-foreground">永久标记复习单元</div>
          <h1 className="font-semibold">{session.title} · {current.title || '剩余水流单元'}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{session.completed_unit_count}/{session.units.length} 已通过</Badge>
          <Badge variant={current.session_status === 'passed' ? 'default' : 'outline'}>
            {current.session_status === 'retry' ? '等待重练' : current.session_status === 'passed' ? '已通过' : '待评分'}
          </Badge>
        </div>
      </div>

      <FlipCardMindMapPanel
        fullscreen={fullscreen}
        onToggleFullscreen={(active) => setFullscreen(active ?? !fullscreen)}
        visibleEditorState={state}
        currentPalaceId={session.palace_id}
        activeUnitNodeUids={current.node_uids}
        mutedNodeUids={mutedNodeUids}
        onNodeClick={() => undefined}
        onNodeContextMenu={() => undefined}
        onNodeActive={() => undefined}
        preserveViewOnSync
        className="min-h-[60vh] flex-1"
      />

      <div className="sticky bottom-3 rounded-xl border bg-card/95 p-3 shadow-lg backdrop-blur">
        {error ? <div className="mb-2 text-sm text-destructive">{error}</div> : null}
        {selectedEffect ? (
          <div className="mb-3 rounded-lg border bg-muted/40 px-3 py-2 text-sm font-medium">
            已选{selectedEffect.label} · {effectLabel(selectedEffect, retryAfterCards)}
          </div>
        ) : null}
        <div className="grid grid-cols-4 gap-2">
          {RATINGS.map((item) => {
            const effect = current.encounter?.rating_effects.find(
              (candidate) => candidate.rating === item.value,
            )
            const selected = current.encounter?.selected_rating === item.value
            return (
              <Button
                key={item.value}
                variant="outline"
                className={`${item.tone} h-auto min-h-14 flex-col whitespace-normal py-2 ${selected ? 'ring-2 ring-primary/40' : ''}`}
                disabled={busy || current.encounter?.status !== 'open'}
                onClick={() => void rate(item.value)}
              >
                <span>{item.label}</span>
                <span className="text-[10px] font-normal opacity-70">
                  {effect ? effectLabel(effect, retryAfterCards) : '计划不可用'}
                </span>
              </Button>
            )
          })}
        </div>
        <div className="mt-3 flex justify-between gap-2">
          <Button variant="ghost" disabled={!lastOperationId || busy} onClick={() => void undo()}>
            <RotateCcw className="mr-2 size-4" />撤销评分
          </Button>
          {allPassed ? (
            <Button disabled={busy} onClick={() => void complete()}>查看结算</Button>
          ) : (
            <Button disabled={busy || current.encounter?.selected_rating == null} onClick={() => void nextUnit()}>
              手动进入下一单元<ArrowRight className="ml-2 size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
