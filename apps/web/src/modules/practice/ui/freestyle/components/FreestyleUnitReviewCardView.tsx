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
  type FreestyleRatingScope,
  type FreestyleUnitEncounterState,
  type ReviewUnitDto,
  type UnitRating,
  type UnitReviewSessionDto,
} from '@/modules/practice/public'
import { rateFreestyleRoundUnitApi } from '@/modules/practice/ui/freestyle/api'
import type { PalaceRatingTarget } from '@/modules/practice/ui/freestyle/model/freestylePalaceRating'
import type {
  FreestyleReviewUnitCard,
  MindMapEditorState,
} from '@/shared/api/contracts'
import { stripMindMapHtml } from '@/shared/lib/mindmapRichText'
import { coerceEditorDoc } from '@/shared/lib/mindmap-split-marks/splitMarks'
import { cn } from '@/shared/lib/utils'
import { useForegroundEncounterClock } from '@/modules/practice/ui/review/hooks/useForegroundEncounterClock'
import { useFreestyleFlowFeedback } from '@/modules/practice/ui/freestyle/hooks/useFreestyleFlowFeedback'
import { FLOW_BREATH_CLASS } from '@/modules/practice/ui/freestyle/model/freestyleFlowFeedback'
import {
  decideLoadedUnitSession,
  isStaleUnitError,
} from '@/modules/practice/ui/freestyle/model/freestyleStaleRecovery'
import { freestyleUnitLoadFailureCopy } from '@/modules/practice/ui/freestyle/model/freestyleUnitLoadRecovery'
import { FreestyleRatingBar } from './FreestyleRatingBar'
import { FreestyleUnitReviewFlipPanel } from './FreestyleUnitReviewFlipPanel'

const inFlightSessionLoads = new Map<string, Promise<UnitReviewSessionDto>>()
const SESSION_LOAD_TIMEOUT_MS = 30_000
/** Undo stays reachable just after a rate, then collapses so the map keeps the room. */
const UNDO_VISIBLE_MS = 5_000

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
        ...(
          card.phase === 'fill'
          || encounter.selectedRating != null
          || encounter.passed === true
            ? [{ allowNotDue: true }]
            : []
        ),
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

export {
  ratingEffectLabel,
  retryPositionLabel,
} from '@/modules/practice/ui/freestyle/model/ratingEffectLabels'

function asUnitRating(value: unknown): UnitRating | null {
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : null
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
    effectiveSeconds: encounter.effective_seconds ?? null,
  }
}

function adoptRatedEncounter(
  live: NonNullable<ReviewUnitDto['encounter']>,
  rated: NonNullable<ReviewUnitDto['encounter']>,
): NonNullable<ReviewUnitDto['encounter']> {
  if (rated.id === live.id) return rated
  if (live.status !== 'open') return rated
  // A retry glance must keep its own encounter. Reusing the source glance's
  // payload remounts the map at the root and looks like the view snapped back.
  return {
    ...rated,
    id: live.id,
    status: 'open',
    round_id: live.round_id,
    sequence: live.sequence,
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
  onRebuildRound,
  onRevisionAdopted,
  onSaveFailed,
  onUnitsReconciled,
  onEditingChange,
  fullscreen = false,
  onToggleFullscreen = () => undefined,
  freestyleFlipMode = 'free',
  onFreestyleFlipModeChange,
  autoAdvance = false,
  onAutoAdvanceChange,
  preferredZoom,
  onUserZoomChange,
  blockedHint = null,
  onRatingSettled,
  ratingScope: _ratingScope = 'unit',
  onRatingScopeChange: _onRatingScopeChange,
  palaceTarget: _palaceTarget = null,
  onBatchCardsSettled,
  liveRevealMap = null,
  onLiveRevealMapChange,
  planVersion = 0,
  onRoundSync,
  onOpenScopeQuiz,
  lastRating = null,
}: {
  card: FreestyleReviewUnitCard
  active: boolean
  readOnly: boolean
  roundId: string
  planVersion?: number
  onRoundSync?: (round: { plan_version?: number; version?: number; conflict?: boolean } | null | undefined) => void
  onOpenScopeQuiz?: () => void
  encounter?: FreestyleUnitEncounterState
  /** This-round last rating, shown while the amend glance is still empty. */
  lastRating?: number | null
  retryAfterCards: number
  /** Why 「下一组」 is blocked, shown inline instead of a toast. */
  blockedHint?: string | null
  /**
   * Fired after a successful rate so the page can auto-advance when enabled, and so
   * the challenge–skill channel can read what the learner actually reported.
   */
  onRatingSettled?: (
    cardId: string,
    passed: boolean,
    rating: UnitRating,
    meta?: {
      occurrenceId?: string
      encounterId?: string
      planVersion?: number
    },
  ) => void
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
  /** Rebuild this round's queue without treating the card as stale. */
  onRebuildRound?: () => void
  onRevisionAdopted?: (cardId: string, unitId: string, revision: number) => void
  onSaveFailed: (message: string) => void
  /** Silent freestyle queue rebuild after mark/leave unit reconcile changes. */
  onUnitsReconciled?: () => void
  onEditingChange?: (editing: boolean) => void
  /** Fullscreen is owned by ImmersiveFreestylePage so rating/navigation stay visible. */
  fullscreen?: boolean
  onToggleFullscreen?: (active?: boolean) => void
  freestyleFlipMode?: FreestyleFlipMode
  onFreestyleFlipModeChange?: (value: FreestyleFlipMode) => void
  autoAdvance?: boolean
  onAutoAdvanceChange?: (value: boolean) => void
  /** Shared manual zoom across all currently mounted freestyle maps. */
  preferredZoom?: number
  onUserZoomChange?: (zoom: number) => void
  ratingScope?: FreestyleRatingScope
  onRatingScopeChange?: (scope: FreestyleRatingScope) => void
  palaceTarget?: PalaceRatingTarget | null
  onBatchCardsSettled?: (
    entries: Array<{ cardId: string; restudy?: boolean; cleared?: boolean; rating?: number; retryAfterCards?: number }>,
  ) => void
  liveRevealMap?: Record<string, string> | null
  onLiveRevealMapChange?: (revealMap: Record<string, string>) => void
}) {
  const [session, setSession] = useState<UnitReviewSessionDto | null>(null)
  const [savedEditorState, setSavedEditorState] = useState<MindMapEditorState | null>(null)
  const [busy, setBusy] = useState(false)
  /** Which rating is in flight — the bar shows it as chosen before the POST returns. */
  const [pendingRating, setPendingRating] = useState<UnitRating | null>(null)
  const [lastOperationId, setLastOperationId] = useState<string | null>(null)
  const [inlineEditing, setInlineEditing] = useState(false)
  const [flipProgress, setFlipProgress] = useState<(FlipProgress & { key: string }) | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadErrorTitle, setLoadErrorTitle] = useState<string | null>(null)
  const [loadErrorHint, setLoadErrorHint] = useState<string | null>(null)
  const [recapOnly, setRecapOnly] = useState(false)
  const [staleRecovery, setStaleRecovery] = useState(false)
  /** Live Reviews revision when the queue card was built against an older freeze. */
  const [adoptedRevision, setAdoptedRevision] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  /** Undo surfaces only right after a rate, then collapses to give the map the room. */
  const [undoVisible, setUndoVisible] = useState(false)
  const undoTimerRef = useRef<number | null>(null)
  const lastSettledCardIdsRef = useRef<string[]>([])
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
  const cardRef = useRef(card)
  cardRef.current = card

  activeRef.current = active
  busyRef.current = busy
  sessionRef.current = session
  const unit = session?.units.find((item) => item.id === card.unit_id) ?? null
  unitRef.current = unit
  const { breath, signalRating, clearBreath } = useFreestyleFlowFeedback()
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
  const effectiveRevision = adoptedRevision ?? card.unit_revision
  const cardUnitKey =
    card.unit_id && effectiveRevision != null
      ? `${card.id}:${card.unit_id}:${effectiveRevision}:${roundId}`
      : null
  // A freshly mounted unit card must not inherit a previous card's saved-doc override.
  useEffect(() => {
    setSavedEditorState(null)
    setStaleRecovery(false)
    setAdoptedRevision(null)
    setRecapOnly(false)
    setLoadErrorTitle(null)
    setLoadErrorHint(null)
  }, [card.id, roundId])

  const revealUndo = useCallback(() => {
    if (undoTimerRef.current != null) window.clearTimeout(undoTimerRef.current)
    setUndoVisible(true)
    undoTimerRef.current = window.setTimeout(() => {
      undoTimerRef.current = null
      setUndoVisible(false)
    }, UNDO_VISIBLE_MS)
  }, [])

  useEffect(() => {
    return () => {
      if (undoTimerRef.current != null) window.clearTimeout(undoTimerRef.current)
    }
  }, [])

  // Leaving the card ends the undo window; the next card must not inherit it.
  useEffect(() => {
    if (active) return
    if (undoTimerRef.current != null) {
      window.clearTimeout(undoTimerRef.current)
      undoTimerRef.current = null
    }
    setUndoVisible(false)
    // Same for the breath: a confirmation belongs to the card that earned it.
    clearBreath()
  }, [active, clearBreath])

  const retryLoad = useCallback(() => {
    openedForKeyRef.current = null
    loadOperationRef.current = null
    setSession(null)
    setLoadError(null)
    setLoadErrorTitle(null)
    setLoadErrorHint(null)
    setRecapOnly(false)
    setStaleRecovery(false)
    setAdoptedRevision(null)
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
    const liveCard = cardRef.current
    if (!active) return
    if (recapOnly) return
    if (!liveCard.unit_id || effectiveRevision == null || !cardUnitKey) {
      onStaleDrop(liveCard.id)
      return
    }
    const identity = onEnsureEncounter(liveCard.id, effectiveRevision, !readOnly)
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
    // Just-rated open glance: a parent encounter flap (source after_state, silent
    // rebuild) must not remount the map at the root. A pending restudy renew still reloads.
    const sameRatedOpenGlance = Boolean(
      openedForKeyRef.current === cardUnitKey
      && sessionRef.current
      && liveEncounter
      && liveEncounter.status === 'open'
      && liveEncounter.selected_rating != null
      && identity.status !== 'pending'
    )
    if (sameOpenGlance || sameClosedView || sameRatedOpenGlance) {
      return
    }
    const requestIdentity = `${cardUnitKey}:${identity.encounterId}:${loadAttempt}:${operationId()}`
    loadOperationRef.current = requestIdentity
    let mounted = true
    setLoadError(null)
    setActionError(null)
    const sessionCard =
      effectiveRevision !== liveCard.unit_revision
        ? { ...liveCard, unit_revision: effectiveRevision }
        : liveCard
    void loadSessionWithTimeout(sessionCard, identity, roundId).then((value) => {
      if (!mounted || loadOperationRef.current !== requestIdentity) return
      const nextUnit = value.units.find((item) => item.id === liveCard.unit_id)
      const decision = decideLoadedUnitSession({
        cardUnitId: liveCard.unit_id,
        cardRevision: effectiveRevision,
        unit: nextUnit,
        identityStatus: identity.status,
      })
      if (decision.action === 'drop' || !nextUnit?.encounter) {
        onStaleDrop(liveCard.id)
        return
      }
      if (decision.action === 'adopt') {
        setAdoptedRevision(nextUnit.revision)
        if (liveCard.unit_id) onRevisionAdopted?.(liveCard.id, liveCard.unit_id, nextUnit.revision)
      }
      openedForKeyRef.current = `${liveCard.id}:${liveCard.unit_id}:${nextUnit.revision}:${roundId}`
      setSession(value)
      setLoadError(null)
      setStaleRecovery(false)
      setLastOperationId(nextUnit.encounter.effective_operation_id)
      onEncounterChange(
        liveCard.id,
        encounterState(value.id, nextUnit.revision, nextUnit.encounter),
      )
    }).catch((error) => {
      if (!mounted || loadOperationRef.current !== requestIdentity) return
      if (isStaleUnitError(error)) {
        setStaleRecovery(true)
        onStaleDrop(liveCard.id)
        return
      }
      const copy = freestyleUnitLoadFailureCopy(error)
      const message = formatUnitDiagnostic({
        error,
        card: liveCard,
        roundId,
        operationId: requestIdentity,
        stage: '加载复习会话',
      })
      setLoadError(message)
      setLoadErrorTitle(copy.title)
      setLoadErrorHint(copy.hint)
      setActionError(null)
    })
    return () => {
      mounted = false
    }
  }, [
    active,
    // Identity only. A silent rebuild replaces the card object; using it here
    // remounted the glance, reset the map to the root, and dropped the rating.
    card.id,
    card.unit_id,
    card.unit_revision,
    card.phase,
    cardUnitKey,
    effectiveRevision,
    // Only the stable identity fields — not selectedRating/passed — so a mid-score
    // parent patch cannot re-enter start/cancel.
    encounter?.encounterId,
    encounter?.status,
    onEncounterChange,
    onEnsureEncounter,
    onStaleDrop,
    recapOnly,
    onRevisionAdopted,
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
    const liveSelected = currentEncounter?.selected_rating
    if (liveSelected === rating) {
      await undoRating({ clearAll: true })
      return
    }
    const recorded = asUnitRating(lastRating) ?? asUnitRating(encounter?.selectedRating)
    if (liveSelected == null && recorded === rating) {
      return
    }
    const blockedReason = !session || !unit || !currentEncounter
      ? '评分按钮暂不可用：复习会话仍在加载。'
      : busy
        ? '评分正在提交，请稍候。'
        : readOnly
          ? '历史记录为只读，不能评分。'
          : currentEncounter.status !== 'open'
            ? (
              encounter?.status === 'pending'
                ? '评分按钮暂不可用：复习会话仍在加载。'
                : '本次复习会话已关闭，请重建队列后重试。'
            )
            : null
    if (blockedReason) {
      setActionError(blockedReason)
      return
    }
    setActionError(null)
    setBusy(true)
    setPendingRating(rating)
    busyRef.current = true
    const id = operationId()
    const requestIdentity = {
      cardId: card.id,
      occurrenceId: card.occurrence_kind === 'retry' ? card.id : '',
      encounterId: currentEncounter.id,
      unitId: unit.id,
    }
    const ratePayload = {
      operation_id: id,
      expected_version: planVersion,
      card_id: requestIdentity.cardId,
      occurrence_id: requestIdentity.occurrenceId,
      encounter_id: requestIdentity.encounterId,
      rating,
      study_session_id: session.id,
      unit_id: requestIdentity.unitId,
      unit_revision: unit.revision,
    }
    try {
      let unitResult: Awaited<ReturnType<typeof rateReviewUnitApi>> | null = null
      let nextPlanVersion = planVersion
      if (roundId) {
        const response = await rateFreestyleRoundUnitApi(roundId, ratePayload)
        onRoundSync?.(response.round)
        nextPlanVersion = Number(response.round?.plan_version ?? response.round?.version ?? planVersion)
        unitResult = response.item as Awaited<ReturnType<typeof rateReviewUnitApi>>
      } else {
        unitResult = await rateReviewUnitApi(
          session.id,
          unit,
          currentEncounter.id,
          rating,
          id,
          currentEncounter.round_id,
        )
      }
      if (!unitResult && roundId) {
        const shownRating = encounter?.selectedRating ?? currentEncounter.selected_rating
        if (shownRating !== rating) {
          const retryId = operationId()
          const retryResponse = await rateFreestyleRoundUnitApi(roundId, {
            ...ratePayload,
            operation_id: retryId,
            expected_version: nextPlanVersion,
            rating,
          })
          onRoundSync?.(retryResponse.round)
          nextPlanVersion = Number(retryResponse.round?.plan_version ?? retryResponse.round?.version ?? nextPlanVersion)
          unitResult = retryResponse.item as Awaited<ReturnType<typeof rateReviewUnitApi>>
        }
      }
      if (!unitResult) {
        setActionError('评分没有记下，请重试。')
        return
      }
      if (String(unitResult.unit?.id || '') !== requestIdentity.unitId) {
        setActionError('评分身份不匹配，未应用到这张卡。')
        return
      }
      const nextEncounter = adoptRatedEncounter(currentEncounter, unitResult.encounter)
      const nextUnit: ReviewUnitDto = {
        ...unit,
        ...unitResult.unit,
        title: unitResult.unit.title || unit.title,
        session_status: unitResult.session_status,
        final_rating: unitResult.rating,
        encounter: nextEncounter,
      }
      const nextSessionId = unitResult.study_session_id || session.id
      const nextSession = updateSessionUnit(
        session.id === nextSessionId ? session : { ...session, id: nextSessionId },
        nextUnit,
      )
      sessionRef.current = nextSession
      unitRef.current = nextUnit
      setSession(nextSession)
      setLastOperationId(unitResult.operation_id)
      onEncounterChange(
        requestIdentity.cardId,
        encounterState(nextSessionId, nextUnit.revision, nextEncounter),
      )
      lastSettledCardIdsRef.current = [requestIdentity.cardId]
      onBranchComplete(requestIdentity.cardId, {
        restudy: !unitResult.passed,
        rating: unitResult.rating,
        retryAfterCards: unitResult.retry_after_cards,
      })
      revealUndo()
      /**
       * The rate had no confirmation of its own: the bar went quiet and the card
       * stayed put. This answers it in the periphery — a tone plus one breath at the
       * card's own edge.
       *
       * Deliberately not `dispatchGlobalFeedback('save_success')`: that draws its
       * burst at screen center (GlobalFeedbackProvider's default point), which is
       * where the learner is reading, and it is gated only by the global sound /
       * animation switches — so it would still sound under the 专注 preset, whose
       * whole point is that learning sounds are off. signalRating respects the
       * review scene and the learning-sounds channel.
       */
      signalRating(rating, unitResult.passed)
      onRatingSettled?.(requestIdentity.cardId, unitResult.passed, rating, {
        occurrenceId: requestIdentity.occurrenceId || requestIdentity.cardId,
        encounterId: requestIdentity.encounterId,
        planVersion: nextPlanVersion,
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
      setPendingRating(null)
      // Close only after the rate finishes so cancel/close cannot delete the
      // encounter the POST still references.
      if (!activeRef.current) void closeCurrentEncounter()
    }
  }

  async function undoRating(options?: { clearAll?: boolean }) {
    const currentSession = session
    const currentUnit = unit
    const operationId = lastOperationId ?? currentUnit?.encounter?.effective_operation_id
    if (!operationId || !currentSession || !currentUnit || readOnly || busy) {
      setActionError(readOnly ? '历史记录为只读，不能撤销评分。' : busy ? '操作正在提交，请稍候。' : '暂无可撤销的评分。')
      return
    }
    setActionError(null)
    setBusy(true)
    busyRef.current = true
    try {
      let workingSession = currentSession
      let workingUnit = currentUnit
      let workingOperationId: string | null = operationId
      let lastResult: Awaited<ReturnType<typeof undoReviewUnitRatingApi>> | null = null
      const seen = new Set<string>()
      while (workingOperationId && !seen.has(workingOperationId)) {
        seen.add(workingOperationId)
        const result = await undoReviewUnitRatingApi(workingOperationId, roundId)
        lastResult = result
        workingUnit = {
          ...workingUnit,
          ...result.unit,
          title: result.unit.title || workingUnit.title,
          session_status: result.session_status,
          final_rating: result.encounter.selected_rating,
          encounter: result.encounter,
        }
        workingSession = updateSessionUnit(workingSession, workingUnit)
        workingOperationId = result.encounter.effective_operation_id
        if (!options?.clearAll || result.encounter.selected_rating == null) break
      }
      if (!lastResult) return
      sessionRef.current = workingSession
      unitRef.current = workingUnit
      setSession(workingSession)
      setLastOperationId(lastResult.encounter.effective_operation_id)
      onEncounterChange(
        card.id,
        encounterState(workingSession.id, workingUnit.revision, lastResult.encounter),
      )
      const settledIds = lastSettledCardIdsRef.current.length ? lastSettledCardIdsRef.current : [card.id]
      if (lastResult.encounter.selected_rating == null) {
        if (undoTimerRef.current != null) {
          window.clearTimeout(undoTimerRef.current)
          undoTimerRef.current = null
        }
        setUndoVisible(false)
        lastSettledCardIdsRef.current = []
        if (onBatchCardsSettled && settledIds.length > 1) {
          onBatchCardsSettled(settledIds.map((cardId) => ({ cardId, cleared: true })))
        } else {
          onBranchComplete(card.id, { cleared: true })
        }
      } else {
        onBranchComplete(card.id, {
          restudy: !lastResult.encounter.passed,
          rating: lastResult.encounter.selected_rating ?? undefined,
          retryAfterCards: lastResult.encounter.retry_after_cards,
        })
      }
    } catch (error) {
      const diagnostic = formatUnitDiagnostic({
        error,
        card,
        roundId,
        operationId,
        stage: options?.clearAll ? '取消评分' : '撤销评分',
      })
      setActionError(diagnostic)
      onSaveFailed(diagnostic)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const reviewReady = Boolean(editorState && session && unit && unit.encounter)
  const currentEncounter = unit?.encounter ?? null
  const liveRating = currentEncounter?.selected_rating ?? null
  const selectedRating = asUnitRating(liveRating)
  const recordedRating = asUnitRating(lastRating) ?? asUnitRating(encounter?.selectedRating)
  const locked = readOnly || !reviewReady || (
    currentEncounter?.status === 'closed' && encounter?.status !== 'pending' && encounter?.status !== 'open'
  )
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
    <section className="flex h-full min-h-0 flex-col" aria-label="永久标记复习单元">
      {/* Paper white: same canvas as PWA review; dark chrome stays on the shell. */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.4rem] border border-white/10 bg-[#fafafa] shadow-[0_18px_50px_rgba(0,0,0,0.28)] sm:rounded-3xl">
        {/* Rate confirmation, at the edge of the card being read rather than at screen
            center. Keyed by nonce so two rates inside one breath window restart it. */}
        {breath ? (
          <span
            key={breath.nonce}
            data-testid="freestyle-flow-breath"
            data-breath={breath.kind}
            aria-hidden
            className={cn(
              'memory-anki-freestyle-breath',
              FLOW_BREATH_CLASS[breath.kind],
            )}
          />
        ) : null}
        {/* Identity row sits in flow above the map chrome. It used to be absolutely
            positioned over the canvas toolbar, which on phone hid 英语/文字模式 entirely.
            Right padding reserves the page-level HUD pill's band (timer + plan + ⋯). */}
        <div className="relative z-10 flex min-w-0 shrink-0 items-center gap-1.5 p-2 pr-[7rem] sm:p-2.5 sm:pr-2.5">
          <div className="flex min-w-0 items-center gap-1.5 rounded-full border border-black/8 bg-white/88 px-2.5 py-1 shadow-sm backdrop-blur-sm">
            <span
              className="size-2 shrink-0 rounded-full bg-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.2)]"
              title="永久标记"
              aria-label="永久标记"
            />
            <h1 className="min-w-0 truncate text-[13px] font-semibold leading-tight tracking-tight text-zinc-800 sm:text-sm">
              {titleText}
            </h1>
            {card.phase === 'fill' ? (
              <span
                data-testid="freestyle-fill-badge"
                title="补充练习：记得/轻松只记下，不改下次到期日"
                className="inline-flex h-5 shrink-0 items-center rounded-full border border-sky-500/30 bg-sky-500/10 px-1.5 text-[10px] font-semibold text-sky-800 sm:h-6 sm:px-2 sm:text-[11px]"
              >
                补充
              </span>
            ) : null}
            {flipTone && flipLabel && flipTitle ? (
              <span
                role="status"
                aria-label={flipTitle}
                title={flipTitle}
                data-testid="flip-progress-badge"
                data-tone={flipTone}
                className={cn(
                  'inline-flex h-5 shrink-0 items-center rounded-full border px-1.5 font-mono text-[10px] font-semibold tabular-nums tracking-tight sm:h-6 sm:px-2 sm:text-[11px]',
                  flipProgressToneClass(flipTone),
                )}
              >
                {flipLabel}
              </span>
            ) : null}
          </div>
          {undoVisible && lastOperationId && !locked ? (
            <button
              type="button"
              disabled={busy}
              data-testid="freestyle-transient-undo"
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-black/8 bg-white/92 px-2.5 text-xs font-medium text-zinc-700 shadow-sm backdrop-blur-sm transition-colors hover:bg-white disabled:opacity-40"
              onClick={() => void undoRating()}
            >
              <RotateCcw className="size-3.5" />
              撤销
            </button>
          ) : null}
        </div>
        {editorState && session && unit && unit.encounter ? (
          <div
            data-testid="freestyle-unit-review-map-shell"
            className={cn(
              'flex min-h-0 flex-1 flex-col',
              !inlineEditing && 'pb-[6.75rem] sm:pb-[7.25rem]',
            )}
          >
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
            autoAdvance={autoAdvance}
            onAutoAdvanceChange={onAutoAdvanceChange}
            preferredZoom={preferredZoom}
            onUserZoomChange={onUserZoomChange}
            onEditingChange={(editing) => {
              setInlineEditing(editing)
              onEditingChange?.(editing)
            }}
            onSaveFailed={onSaveFailed}
            onEditorStateSaved={setSavedEditorState}
            onUnitsReconciled={onUnitsReconciled}
            onRevealProgressChange={handleRevealProgressChange}
            syncedRevealMap={liveRevealMap}
            onRevealMapChange={onLiveRevealMapChange}
            onOpenScopeQuiz={onOpenScopeQuiz}
          />
          </div>
        ) : (
          <div className={cn(
            'flex h-full items-center justify-center px-5 text-center text-sm',
            recapOnly
              ? 'bg-white/[0.03] text-zinc-200'
              : loadError
              ? 'bg-rose-950/20 text-rose-100'
              : staleRecovery
                ? 'bg-amber-200/[0.04] text-amber-100'
                : 'bg-white/[0.03] text-zinc-400',
          )}>
            {recapOnly ? (
              <div className="flex max-w-[min(22rem,100%)] flex-col items-center gap-3 text-zinc-100">
                <p>这张已经评过，当前只看不评</p>
                <p className="text-xs text-zinc-400">
                  {card.palace_title || '记忆宫殿'}
                  {card.context_path?.length
                    ? ` · ${card.context_path.map((item) => item.text).filter(Boolean).join(' / ')}`
                    : ''}
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  <button type="button" className="rounded-xl border border-white/25 px-3 py-2" onClick={retryLoad}>
                    改评分
                  </button>
                  <button type="button" className="rounded-xl border border-white/25 px-3 py-2" onClick={() => onStaleDrop(card.id)}>
                    跳过这张
                  </button>
                </div>
              </div>
            ) : loadError ? (
              <div className="flex max-w-[min(22rem,100%)] flex-col items-center gap-3">
                <p>{loadErrorTitle || '这张卡暂时打不开'}</p>
                <p className="text-xs text-rose-100/80">{loadErrorHint || '可以重试、跳过、重建本轮，或只看不评。'}</p>
                <div className="flex flex-wrap justify-center gap-2">
                  <button type="button" className="rounded-xl border border-rose-200/40 px-3 py-2" onClick={retryLoad}>
                    重试
                  </button>
                  <button type="button" className="rounded-xl border border-rose-200/40 px-3 py-2" onClick={() => onStaleDrop(card.id)}>
                    跳过这张
                  </button>
                  <button
                    type="button"
                    className="rounded-xl border border-rose-200/40 px-3 py-2"
                    onClick={() => onRebuildRound?.()}
                  >
                    重建本轮
                  </button>
                  <button
                    type="button"
                    className="rounded-xl border border-rose-200/40 px-3 py-2"
                    onClick={() => {
                      setRecapOnly(true)
                      setLoadError(null)
                      setActionError(null)
                    }}
                  >
                    只看不评
                  </button>
                </div>
                <button
                  type="button"
                  className="text-xs underline underline-offset-2 text-rose-100/70"
                  onClick={() => void navigator.clipboard?.writeText(loadError)}
                >
                  复制诊断
                </button>
              </div>
            ) : staleRecovery ? (
              <span className="inline-flex items-center"><LoaderCircle className="mr-2 size-4 animate-spin" />正在更新复习安排...</span>
            ) : (
              <span className="inline-flex items-center">{active ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}{active ? '正在加载单元...' : '等待进入当前单元'}</span>
            )}
          </div>
        )}

        {active && !inlineEditing && !loadError && !recapOnly ? (
          <FreestyleRatingBar
            ratingEffects={currentEncounter?.rating_effects ?? []}
            selectedRating={selectedRating}
            recordedRating={recordedRating}
            pendingRating={pendingRating}
            retryAfterCards={retryAfterCards}
            busy={busy}
            locked={locked}
            reviewReady={reviewReady}
            hasEncounter={Boolean(currentEncounter)}
            actionError={actionError}
            blockedHint={blockedHint}
            shortcutsActive={active && !inlineEditing}
            onRate={(rating) => void rate(rating)}
            onDismissError={() => setActionError(null)}
          />
        ) : null}
      </div>
    </section>
  )
}
