import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LoaderCircle, RotateCcw } from 'lucide-react'
import {
  flipProgressLabel,
  flipProgressTitle,
  flipProgressTone,
  flipProgressToneClass,
  type FlipProgress,
} from '../model/flipProgressBadge'
import {
  cancelUnratedUnitReviewEncounterApi,
  closeUnitReviewEncounterApi,
  getUnitReviewSessionApi,
  rateReviewUnitApi,
  startFreestyleUnitReviewSessionApi,
  undoReviewUnitRatingApi,
  type FreestyleFlipMode,
  type FreestyleUnitEncounterState,
  type ReviewUnitDto,
  type UnitRating,
  type UnitRatingEffectDto,
  type UnitReviewSessionDto,
} from '@/modules/practice/public'
import type {
  FreestyleReviewUnitCard,
  MindMapEditorState,
} from '@/shared/api/contracts'
import { stripMindMapHtml } from '@/shared/lib/mindmapRichText'
import { coerceEditorDoc } from '@/shared/lib/mindmap-split-marks/splitMarks'
import { cn } from '@/shared/lib/utils'
import { useForegroundEncounterClock } from '@/modules/practice/ui/review/hooks/useForegroundEncounterClock'
import { FreestyleUnitReviewFlipPanel } from './FreestyleUnitReviewFlipPanel'

const inFlightSessionLoads = new Map<string, Promise<UnitReviewSessionDto>>()
const SESSION_LOAD_TIMEOUT_MS = 15_000
const ratings: Array<{
  value: UnitRating
  label: string
  className: string
  selectedClassName: string
}> = [
  {
    value: 1,
    label: '忘记',
    className: 'border-rose-400/30 bg-rose-400/10 text-rose-100 hover:bg-rose-400/18',
    selectedClassName: 'border-rose-300 bg-rose-400/25 ring-2 ring-rose-300/45',
  },
  {
    value: 2,
    label: '困难',
    className: 'border-amber-300/30 bg-amber-300/10 text-amber-50 hover:bg-amber-300/18',
    selectedClassName: 'border-amber-200 bg-amber-300/25 ring-2 ring-amber-200/45',
  },
  {
    value: 3,
    label: '记得',
    className: 'border-emerald-300/30 bg-emerald-300/10 text-emerald-50 hover:bg-emerald-300/18',
    selectedClassName: 'border-emerald-200 bg-emerald-300/25 ring-2 ring-emerald-200/45',
  },
  {
    value: 4,
    label: '轻松',
    className: 'border-sky-300/30 bg-sky-300/10 text-sky-50 hover:bg-sky-300/18',
    selectedClassName: 'border-sky-200 bg-sky-300/25 ring-2 ring-sky-200/45',
  },
]

function operationId() {
  return crypto.randomUUID?.() ?? `freestyle-unit-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function sessionCacheKey(cardId: string, encounter: FreestyleUnitEncounterState) {
  return `${cardId}:${encounter.encounterId}:${encounter.status}:${encounter.sessionId ?? ''}`
}

function loadSession(
  card: FreestyleReviewUnitCard,
  encounter: FreestyleUnitEncounterState,
  roundId: string,
) {
  const key = sessionCacheKey(card.id, encounter)
  const cached = inFlightSessionLoads.get(key)
  if (cached) return cached
  const promise = encounter.status === 'closed' && encounter.sessionId
    ? getUnitReviewSessionApi(encounter.sessionId)
    : startFreestyleUnitReviewSessionApi(
        { id: card.unit_id!, revision: card.unit_revision! },
        roundId,
        encounter.encounterId,
        ...(card.phase === 'fill' ? [{ allowNotDue: true }] : []),
      )
  inFlightSessionLoads.set(key, promise)
  const clear = () => {
    if (inFlightSessionLoads.get(key) === promise) inFlightSessionLoads.delete(key)
  }
  void promise.then(clear, clear)
  return promise
}

function loadSessionWithTimeout(
  card: FreestyleReviewUnitCard,
  encounter: FreestyleUnitEncounterState,
  roundId: string,
) {
  return new Promise<UnitReviewSessionDto>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      // Do not let a hung request poison retry with the same in-flight cache key.
      inFlightSessionLoads.delete(sessionCacheKey(card.id, encounter))
      reject(new Error('加载单元超时，请重试或重建队列。'))
    }, SESSION_LOAD_TIMEOUT_MS)
    void loadSession(card, encounter, roundId).then(
      (value) => {
        window.clearTimeout(timeout)
        resolve(value)
      },
      (error) => {
        window.clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

function buildEditorState(session: UnitReviewSessionDto): MindMapEditorState | null {
  // Session payloads may still ship editor_doc as a JSON string; permanent-mark
  // chip/toggle logic needs a real document object with `.root`.
  const editorDoc = coerceEditorDoc(
    session.palace?.editor_doc as Parameters<typeof coerceEditorDoc>[0],
  )
  if (!editorDoc) return null
  return {
    editor_doc: editorDoc as MindMapEditorState['editor_doc'],
    editor_config: {},
    editor_local_config: {},
    lang: 'zh',
  }
}

function matchesCardUnit(card: FreestyleReviewUnitCard, unit: ReviewUnitDto | undefined) {
  return Boolean(
    unit
    && unit.id === card.unit_id
    && card.unit_revision != null
    && unit.revision === card.unit_revision,
  )
}

function isStaleUnitError(error: unknown) {
  const requestError = error as { status?: number; message?: string }
  const message = String(requestError?.message || '').toLowerCase()
  return requestError?.status === 404
    || message.includes('review unit not found')
    || message.includes('review unit changed')
    || message.includes('rebuild the queue')
    || message.includes('not due')
    || message.includes('no review units available')
    || message.includes('encounter_id belongs to another review unit')
    || message.includes('active unit review session required')
}

function formatUnitDiagnostic(input: {
  error: unknown
  card: FreestyleReviewUnitCard
  roundId: string
  operationId?: string | null
  stage: string
}) {
  const value = input.error as {
    message?: string
    requestId?: string
    status?: number
    url?: string
  }
  const lines = [
    value?.message || String(input.error || '未知错误'),
    `页面：/freestyle · 宫殿：${input.card.palace_id} · 卡片：${input.card.id}`,
    `单元：${input.card.unit_id || '无'} · 回合：${input.roundId}`,
    `阶段：${input.stage} · 操作 ID：${input.operationId || '未生成'}`,
    value?.requestId ? `请求 ID：${value.requestId}` : null,
    value?.status != null ? `HTTP 状态：${value.status}` : null,
    value?.url ? `接口：${value.url}` : null,
  ].filter(Boolean)
  return lines.join('\n')
}

function localDateLabel(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return value
  return `${month}月${day}日`
}

export function retryPositionLabel(cardCount: number) {
  const count = Math.max(0, Math.min(3, Math.round(cardCount)))
  return count === 0 ? '立即重练' : `${count}张后重练`
}

export function ratingEffectLabel(effect: UnitRatingEffectDto, retryAfterCards: number) {
  if (effect.passed) {
    return `${effect.target_interval_days}天后复习 · ${localDateLabel(effect.target_due_date)}`
  }
  const targetStage = effect.target_interval_days === 0 ? '首学阶段' : `${effect.target_interval_days}天级`
  const stage = effect.rating === 1
    ? `重置到${targetStage}`
    : effect.stage_action === 'lower'
      ? `降至${targetStage}`
      : `保持${targetStage}`
  return `${retryPositionLabel(retryAfterCards)} · ${stage}`
}

function encounterState(
  sessionId: string,
  unitRevision: number,
  encounter: NonNullable<ReviewUnitDto['encounter']>,
): FreestyleUnitEncounterState {
  return {
    encounterId: encounter.id,
    roundId: encounter.round_id,
    unitRevision,
    status: encounter.status,
    sessionId,
    selectedRating: encounter.selected_rating,
    passed: encounter.passed,
    retryAfterCards: encounter.retry_after_cards,
  }
}

function updateSessionUnit(
  session: UnitReviewSessionDto,
  unit: ReviewUnitDto,
): UnitReviewSessionDto {
  const units = session.units.map((item) => item.id === unit.id ? unit : item)
  return {
    ...session,
    units,
    pending_unit_count: units.filter((item) => item.session_status !== 'passed').length,
    completed_unit_count: units.filter((item) => item.session_status === 'passed').length,
  }
}

export function FreestyleUnitReviewCardView({
  card,
  active,
  readOnly,
  roundId,
  encounter,
  retryAfterCards,
  onEnsureEncounter,
  onEncounterChange,
  onBranchComplete,
  onStaleDrop,
  onSaveFailed,
  onUnitsReconciled,
  fullscreen = false,
  onToggleFullscreen = () => undefined,
  freestyleFlipMode = 'free',
  onFreestyleFlipModeChange,
}: {
  card: FreestyleReviewUnitCard
  active: boolean
  readOnly: boolean
  roundId: string
  encounter?: FreestyleUnitEncounterState
  retryAfterCards: number
  onEnsureEncounter: (
    cardId: string,
    unitRevision: number,
    allowRenew: boolean,
  ) => FreestyleUnitEncounterState
  onEncounterChange: (cardId: string, encounter: FreestyleUnitEncounterState) => void
  onBranchComplete: (
    cardId: string,
    options?: { restudy?: boolean; cleared?: boolean; rating?: number; retryAfterCards?: number },
  ) => void
  onStaleDrop: (cardId: string) => void
  onSaveFailed: (message: string) => void
  /** Silent freestyle queue rebuild after mark/leave unit reconcile changes. */
  onUnitsReconciled?: () => void
  /** Fullscreen is owned by ImmersiveFreestylePage so rating/navigation stay visible. */
  fullscreen?: boolean
  onToggleFullscreen?: (active?: boolean) => void
  freestyleFlipMode?: FreestyleFlipMode
  onFreestyleFlipModeChange?: (value: FreestyleFlipMode) => void
}) {
  const [session, setSession] = useState<UnitReviewSessionDto | null>(null)
  const [savedEditorState, setSavedEditorState] = useState<MindMapEditorState | null>(null)
  const [busy, setBusy] = useState(false)
  const [lastOperationId, setLastOperationId] = useState<string | null>(null)
  const [inlineEditing, setInlineEditing] = useState(false)
  const [flipProgress, setFlipProgress] = useState<(FlipProgress & { key: string }) | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [staleRecovery, setStaleRecovery] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const activeRef = useRef(active)
  const busyRef = useRef(false)
  const sessionRef = useRef<UnitReviewSessionDto | null>(null)
  const unitRef = useRef<ReviewUnitDto | null>(null)
  const closeRequestRef = useRef<{ encounterId: string; promise: Promise<unknown> } | null>(null)
  const closeOperationRef = useRef<{ encounterId: string; operationId: string } | null>(null)
  // Track which card identity already opened a live session so encounter updates
  // (pending→open, rating amend) do not re-enter start and race an in-flight rate.
  const openedForKeyRef = useRef<string | null>(null)
  const loadOperationRef = useRef<string | null>(null)

  activeRef.current = active
  busyRef.current = busy
  sessionRef.current = session
  const unit = session?.units.find((item) => item.id === card.unit_id) ?? null
  unitRef.current = unit
  const { getEffectiveSeconds: getEncounterSeconds, clear: clearEncounterClock } =
    useForegroundEncounterClock({
      encounterId: unit?.encounter?.id ?? null,
      active,
      open: unit?.encounter?.status === 'open',
    })
  const editorState = useMemo(() => session ? buildEditorState(session) : null, [session])
  // Keyed so a new card/encounter hides the chip until FlipPanel reports (no parent reset race).
  const flipProgressKey = `${card.id}:${unit?.encounter?.id ?? 'none'}`
  const activeFlipProgress =
    flipProgress && flipProgress.key === flipProgressKey ? flipProgress : null
  const cardUnitKey =
    card.unit_id && card.unit_revision != null
      ? `${card.id}:${card.unit_id}:${card.unit_revision}:${roundId}`
      : null
  // A freshly mounted unit card must not inherit a previous card's saved-doc override.
  useEffect(() => {
    setSavedEditorState(null)
    setStaleRecovery(false)
  }, [cardUnitKey])

  const retryLoad = useCallback(() => {
    openedForKeyRef.current = null
    loadOperationRef.current = null
    setSession(null)
    setLoadError(null)
    setStaleRecovery(false)
    setActionError(null)
    setLoadAttempt((value) => value + 1)
  }, [])

  const handleRevealProgressChange = useCallback((progress: FlipProgress) => {
    setFlipProgress((current) => (
      current
      && current.key === flipProgressKey
      && current.revealed === progress.revealed
      && current.total === progress.total
        ? current
        : { key: flipProgressKey, ...progress }
    ))
  }, [flipProgressKey])

  const closeCurrentEncounter = useCallback(() => {
    // Rating in flight owns the encounter; finish first, then leave-close.
    if (busyRef.current) {
      return Promise.resolve(null)
    }
    const currentSession = sessionRef.current
    const currentUnit = unitRef.current
    const currentEncounter = currentUnit?.encounter
    if (
      !currentSession
      || !currentUnit
      || !currentEncounter
      || currentEncounter.status !== 'open'
    ) {
      return Promise.resolve(null)
    }
    if (closeRequestRef.current?.encounterId === currentEncounter.id) {
      return closeRequestRef.current.promise
    }

    // Unrated leave must cancel the glance. Leaving the open encounter alive made
    // the later pass bill wall clock from first scroll-past (parallel palace rows).
    if (currentEncounter.selected_rating == null) {
      const promise = cancelUnratedUnitReviewEncounterApi(
        currentSession.id,
        currentUnit.id,
        currentEncounter.id,
      ).then((result) => {
        clearEncounterClock()
        sessionRef.current = null
        unitRef.current = null
        setSession(null)
        setLastOperationId(null)
        openedForKeyRef.current = null
        onEncounterChange(card.id, {
          encounterId: currentEncounter.id,
          unitRevision: currentUnit.revision,
          status: 'closed',
          sessionId: result.abandoned ? null : currentSession.id,
          selectedRating: null,
          passed: null,
          retryAfterCards: 0,
        })
        return result
      }).catch(() => {
        // Best-effort: next freestyle start also releases competing unrated sessions.
        return null
      }).finally(() => {
        if (closeRequestRef.current?.encounterId === currentEncounter.id) {
          closeRequestRef.current = null
        }
      })
      closeRequestRef.current = { encounterId: currentEncounter.id, promise }
      return promise
    }

    const closeOperation = closeOperationRef.current?.encounterId === currentEncounter.id
      ? closeOperationRef.current.operationId
      : operationId()
    closeOperationRef.current = { encounterId: currentEncounter.id, operationId: closeOperation }
    const promise = closeUnitReviewEncounterApi(
      currentSession.id,
      currentUnit.id,
      currentEncounter.id,
      closeOperation,
      getEncounterSeconds(),
      currentEncounter.round_id,
    ).then((result) => {
      clearEncounterClock()
      const nextUnit = { ...currentUnit, encounter: result.encounter }
      const nextSession = {
        ...updateSessionUnit(currentSession, nextUnit),
        status: result.session_status,
      }
      sessionRef.current = nextSession
      unitRef.current = nextUnit
      setSession(nextSession)
      onEncounterChange(
        card.id,
        encounterState(currentSession.id, currentUnit.revision, result.encounter),
      )
      return result
    }).catch((error) => {
      onSaveFailed(error instanceof Error ? error.message : '锁定评分失败')
      return null
    }).finally(() => {
      if (closeRequestRef.current?.encounterId === currentEncounter.id) {
        closeRequestRef.current = null
      }
    })
    closeRequestRef.current = { encounterId: currentEncounter.id, promise }
    return promise
  }, [card.id, clearEncounterClock, getEncounterSeconds, onEncounterChange, onSaveFailed])

  const closeCurrentEncounterRef = useRef(closeCurrentEncounter)
  closeCurrentEncounterRef.current = closeCurrentEncounter

  useEffect(() => {
    if (!active) return
    if (!card.unit_id || card.unit_revision == null || !cardUnitKey) {
      onStaleDrop(card.id)
      return
    }
    const identity = onEnsureEncounter(card.id, card.unit_revision, !readOnly)
    if (readOnly && identity.status !== 'closed') return
    const liveEncounter = unitRef.current?.encounter
    // Same live glance already loaded: skip. Do NOT key off parent `encounter` updates
    // (pending→open / rating amend) or start races cancel/rate mid-score.
    // Restudy renew (new pending id after a closed fail) must still reload.
    const sameOpenGlance = Boolean(
      openedForKeyRef.current === cardUnitKey
      && sessionRef.current
      && liveEncounter
      && liveEncounter.status === 'open'
      && (
        liveEncounter.id === identity.encounterId
        || identity.status === 'open'
      ),
    )
    const sameClosedView = Boolean(
      openedForKeyRef.current === cardUnitKey
      && sessionRef.current
      && liveEncounter
      && identity.status === 'closed'
      && liveEncounter.id === identity.encounterId,
    )
    if (sameOpenGlance || sameClosedView) {
      return
    }
    const requestIdentity = `${cardUnitKey}:${identity.encounterId}:${loadAttempt}:${operationId()}`
    loadOperationRef.current = requestIdentity
    let mounted = true
    setLoadError(null)
    setActionError(null)
    void loadSessionWithTimeout(card, identity, roundId).then((value) => {
      if (!mounted || loadOperationRef.current !== requestIdentity) return
      const nextUnit = value.units.find((item) => item.id === card.unit_id)
      if (!matchesCardUnit(card, nextUnit) || !nextUnit?.encounter) {
        onStaleDrop(card.id)
        return
      }
      if (identity.status !== 'closed' && nextUnit.encounter.status !== 'open') {
        onStaleDrop(card.id)
        return
      }
      openedForKeyRef.current = cardUnitKey
      setSession(value)
      setLoadError(null)
      setStaleRecovery(false)
      setLastOperationId(nextUnit.encounter.effective_operation_id)
      onEncounterChange(
        card.id,
        encounterState(value.id, nextUnit.revision, nextUnit.encounter),
      )
    }).catch((error) => {
      if (!mounted || loadOperationRef.current !== requestIdentity) return
      if (isStaleUnitError(error)) {
        setStaleRecovery(true)
        onStaleDrop(card.id)
        return
      }
      const rawMessage = error instanceof Error ? error.message : '创建单元复习失败'
      const message = formatUnitDiagnostic({
        error,
        card,
        roundId,
        operationId: requestIdentity,
        stage: '加载复习会话',
      })
      setLoadError(message)
      setActionError(message)
      onSaveFailed(rawMessage)
    })
    return () => {
      mounted = false
    }
  }, [
    active,
    card,
    cardUnitKey,
    // Only the stable identity fields — not selectedRating/passed — so a mid-score
    // parent patch cannot re-enter start/cancel.
    encounter?.encounterId,
    encounter?.status,
    onEncounterChange,
    onEnsureEncounter,
    onSaveFailed,
    onStaleDrop,
    readOnly,
    roundId,
    loadAttempt,
  ])

  const wasActiveRef = useRef(false)
  useEffect(() => {
    if (active) {
      wasActiveRef.current = true
      return
    }
    if (!wasActiveRef.current) return
    wasActiveRef.current = false
    void closeCurrentEncounter()
  }, [active, closeCurrentEncounter])

  useEffect(() => {
    return () => {
      void closeCurrentEncounterRef.current()
    }
  }, [])

  async function rate(rating: UnitRating) {
    const currentEncounter = unit?.encounter
    const blockedReason = !session || !unit || !currentEncounter
      ? '评分按钮暂不可用：复习会话仍在加载。'
      : busy
        ? '评分正在提交，请稍候。'
        : readOnly
          ? '历史记录为只读，不能评分。'
          : currentEncounter.status !== 'open'
            ? '本次复习会话已关闭，请重建队列后重试。'
            : currentEncounter.selected_rating === rating
              ? '这张卡已经选择了相同评分。'
              : null
    if (blockedReason) {
      setActionError(blockedReason)
      return
    }
    setActionError(null)
    setBusy(true)
    busyRef.current = true
    const id = operationId()
    try {
      const result = await rateReviewUnitApi(
        session.id,
        unit,
        currentEncounter.id,
        rating,
        id,
        currentEncounter.round_id,
      )
      const nextUnit: ReviewUnitDto = {
        ...unit,
        ...result.unit,
        title: result.unit.title || unit.title,
        session_status: result.session_status,
        final_rating: result.rating,
        encounter: result.encounter,
      }
      const nextSession = updateSessionUnit(session, nextUnit)
      sessionRef.current = nextSession
      unitRef.current = nextUnit
      setSession(nextSession)
      setLastOperationId(result.operation_id)
      onEncounterChange(
        card.id,
        encounterState(session.id, nextUnit.revision, result.encounter),
      )
      onBranchComplete(card.id, {
        restudy: !result.passed,
      })
    } catch (error) {
      if (isStaleUnitError(error)) {
        const diagnostic = formatUnitDiagnostic({ error, card, roundId, operationId: id, stage: '评分后卡片已过期' })
        setActionError(`${diagnostic}\n已检测到内容版本变化，正在自动更新复习安排。`)
        onSaveFailed(diagnostic)
        onStaleDrop(card.id)
      } else {
        const diagnostic = formatUnitDiagnostic({ error, card, roundId, operationId: id, stage: '提交评分' })
        setActionError(diagnostic)
        onSaveFailed(diagnostic)
      }
    } finally {
      busyRef.current = false
      setBusy(false)
      // Close only after the rate finishes so cancel/close cannot delete the
      // encounter the POST still references.
      if (!activeRef.current) void closeCurrentEncounter()
    }
  }

  async function undo() {
    if (!lastOperationId || !session || !unit || readOnly || busy) {
      setActionError(readOnly ? '历史记录为只读，不能撤销评分。' : busy ? '操作正在提交，请稍候。' : '暂无可撤销的评分。')
      return
    }
    setBusy(true)
    try {
      const result = await undoReviewUnitRatingApi(lastOperationId, roundId)
      const nextUnit: ReviewUnitDto = {
        ...unit,
        ...result.unit,
        title: result.unit.title || unit.title,
        session_status: result.session_status,
        final_rating: result.encounter.selected_rating,
        encounter: result.encounter,
      }
      const nextSession = updateSessionUnit(session, nextUnit)
      sessionRef.current = nextSession
      unitRef.current = nextUnit
      setSession(nextSession)
      setLastOperationId(result.encounter.effective_operation_id)
      onEncounterChange(
        card.id,
        encounterState(session.id, nextUnit.revision, result.encounter),
      )
      if (result.encounter.selected_rating == null) {
        onBranchComplete(card.id, { cleared: true })
      } else {
        onBranchComplete(card.id, { restudy: !result.encounter.passed })
      }
    } catch (error) {
      const diagnostic = formatUnitDiagnostic({ error, card, roundId, operationId: lastOperationId, stage: '撤销评分' })
      setActionError(diagnostic)
      onSaveFailed(diagnostic)
    } finally {
      setBusy(false)
    }
  }

  const reviewReady = Boolean(editorState && session && unit && unit.encounter)
  const currentEncounter = unit?.encounter ?? null
  const selectedRating = currentEncounter?.selected_rating ?? null
  const selectedEffect = currentEncounter?.rating_effects.find(
    (effect) => effect.rating === selectedRating,
  )
  const locked = readOnly || !reviewReady || currentEncounter?.status === 'closed'
  const titleText = stripMindMapHtml(
    unit?.title || card.palace_title || `宫殿 ${card.palace_id}`,
  )
  const flipTone = activeFlipProgress
    ? flipProgressTone(activeFlipProgress.revealed, activeFlipProgress.total)
    : null
  const flipLabel = activeFlipProgress
    ? flipProgressLabel(activeFlipProgress.revealed, activeFlipProgress.total)
    : null
  const flipTitle = activeFlipProgress
    ? flipProgressTitle(activeFlipProgress.revealed, activeFlipProgress.total)
    : null

  return (
    <section className="flex h-full min-h-0 flex-col gap-1.5 sm:gap-3" aria-label="永久标记复习单元">
      <header className="flex min-w-0 shrink-0 items-center gap-2 px-1">
        <span
          className="size-2 shrink-0 rounded-full bg-amber-300 shadow-[0_0_0_3px_rgba(252,211,77,0.18)]"
          title="永久标记"
          aria-label="永久标记"
        />
        <h1 className="min-w-0 truncate text-sm font-semibold text-zinc-100 sm:text-base">
          {titleText}
        </h1>
        {flipTone && flipLabel && flipTitle ? (
          <span
            role="status"
            aria-label={flipTitle}
            title={flipTitle}
            data-testid="flip-progress-badge"
            data-tone={flipTone}
            className={cn(
              'inline-flex h-6 shrink-0 items-center rounded-full border px-2 font-mono text-[11px] font-semibold tabular-nums tracking-tight sm:h-7 sm:px-2.5 sm:text-xs',
              flipProgressToneClass(flipTone),
            )}
          >
            {flipLabel}
          </span>
        ) : null}
        <div className="min-w-0 flex-1" />
        {lastOperationId && !locked ? (
          <button
            type="button"
            disabled={busy}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
            onClick={() => void undo()}
          >
            <RotateCcw className="size-3.5" />
            撤销
          </button>
        ) : null}
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-[1.4rem] border border-white/10 bg-white shadow-[0_18px_50px_rgba(0,0,0,0.28)] sm:rounded-3xl">
        {editorState && session && unit && unit.encounter ? (
          <FreestyleUnitReviewFlipPanel
            key={`${card.id}:${unit.encounter.id}`}
            card={card}
            session={session}
            unit={unit}
            editorState={savedEditorState ?? editorState}
            active={active}
            fullscreen={fullscreen}
            onToggleFullscreen={onToggleFullscreen}
            freestyleFlipMode={freestyleFlipMode}
            onFreestyleFlipModeChange={onFreestyleFlipModeChange}
            onEditingChange={setInlineEditing}
            onSaveFailed={onSaveFailed}
            onEditorStateSaved={setSavedEditorState}
            onUnitsReconciled={onUnitsReconciled}
            onRevealProgressChange={handleRevealProgressChange}
          />
        ) : (
          <div className={cn(
            'flex h-full items-center justify-center px-5 text-center text-sm',
            loadError
              ? 'bg-rose-950/20 text-rose-100'
              : staleRecovery
                ? 'bg-amber-200/[0.04] text-amber-100'
                : 'bg-white/[0.03] text-zinc-400',
          )}>
            {loadError ? (
              <div className="flex flex-col items-center gap-3">
                <p>单元加载失败：{loadError}</p>
                <div className="flex flex-wrap justify-center gap-2">
                  <button type="button" className="rounded-xl border border-rose-200/40 px-3 py-2" onClick={retryLoad}>
                    重试加载
                  </button>
                  <button type="button" className="rounded-xl border border-rose-200/40 px-3 py-2" onClick={() => onStaleDrop(card.id)}>
                    重建队列
                  </button>
                </div>
              </div>
            ) : staleRecovery ? (
              <span className="inline-flex items-center"><LoaderCircle className="mr-2 size-4 animate-spin" />正在更新复习安排...</span>
            ) : (
              <span className="inline-flex items-center">{active ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}{active ? '正在加载单元...' : '等待进入当前单元'}</span>
            )}
          </div>
        )}

        {active && !inlineEditing ? (
          <footer
            data-testid="freestyle-rating-bar"
            className={cn(
              // Phone: float over map bottom so the map keeps full height.
              // Desktop: still overlay but roomier hit targets.
              'pointer-events-none absolute inset-x-0 bottom-0 z-10 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] sm:p-2.5 sm:pb-2.5',
            )}
          >
            <div className="pointer-events-auto rounded-[1.2rem] border border-white/12 bg-zinc-950/88 p-1.5 shadow-[0_12px_36px_rgba(0,0,0,0.42)] backdrop-blur-md sm:rounded-2xl sm:p-2">
              {/* After rate, one status line shows the real schedule; buttons stay label-only. */}
              {actionError ? (
                <div className="mb-1.5 whitespace-pre-wrap rounded-lg border border-rose-300/25 bg-rose-400/10 px-2.5 py-1.5 text-[11px] text-rose-100" role="alert">
                  <div>{actionError}</div>
                  <button
                    type="button"
                    className="mt-1 underline underline-offset-2"
                    onClick={() => void navigator.clipboard?.writeText(actionError)}
                  >
                    复制诊断
                  </button>
                </div>
              ) : null}
              {selectedEffect ? (
                <div className="mb-1.5 truncate rounded-lg bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-zinc-100 sm:text-xs">
                  已选{selectedEffect.label} · {ratingEffectLabel(selectedEffect, retryAfterCards)}
                  {locked ? <span className="ml-2 text-zinc-500">已锁定</span> : null}
                </div>
              ) : null}
              <div className="grid grid-cols-4 gap-1 sm:gap-1.5">
                {ratings.map((item) => {
                  const effect = currentEncounter?.rating_effects.find(
                    (value) => value.rating === item.value,
                  )
                  const hint = effect
                    ? ratingEffectLabel(effect, retryAfterCards)
                    : reviewReady ? '计划不可用' : '加载中'
                  const selected = selectedRating === item.value
                  return (
                    <button
                      data-testid={`freestyle-rating-button-${item.value}`}
                      key={item.value}
                      type="button"
                      disabled={busy || locked || selected || !currentEncounter}
                      aria-pressed={selected}
                      aria-label={`${item.label}：${hint}`}
                      title={actionError || hint}
                      className={cn(
                        'flex min-h-11 items-center justify-center rounded-xl border px-1 py-1.5 text-center transition-colors active:scale-[0.98] disabled:pointer-events-none disabled:opacity-55 sm:min-h-12 sm:rounded-2xl sm:px-2',
                        item.className,
                        selected && item.selectedClassName,
                      )}
                      onClick={() => void rate(item.value)}
                    >
                      <span className="text-xs font-semibold sm:text-sm">{item.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </footer>
        ) : null}
      </div>
    </section>
  )
}
