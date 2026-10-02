import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  flipProgressLabel,
  flipProgressTitle,
  flipProgressTone,
  type FlipProgress,
} from '../model/flipProgressBadge'
import {
  cancelUnratedUnitReviewEncounterApi,
  closeUnitReviewEncounterApi,
  rateReviewUnitApi,
  undoReviewUnitRatingApi,
  type FreestyleFlipMode,
  type FreestyleRatingScope,
  type FreestyleUnitEncounterState,
  type ReviewUnitDto,
  type UnitRating,
  type UnitReviewSessionDto,
} from '@/modules/practice/public'
import { rateFreestyleRoundUnitApi } from '@/modules/practice/ui/freestyle/api'
import {
  acceptRating,
  emptyMailbox,
  isCurrentIntent,
  noteInflightDone,
  ratingPassed,
  requestUndo,
  type RateMailbox,
  type RateTicket,
} from '@/modules/practice/ui/freestyle/model/ratingOutbox'
import type { PalaceRatingTarget } from '@/modules/practice/ui/freestyle/model/freestylePalaceRating'
import type {
  FreestyleReviewUnitCard,
  MindMapEditorState,
} from '@/shared/api/contracts'
import { stripMindMapHtml } from '@/shared/lib/mindmapRichText'
import {
  adoptRatedEncounter,
  asUnitRating,
  buildEditorState,
  encounterState,
  formatUnitDiagnostic,
  loadSessionWithTimeout,
  operationId,
  UNDO_VISIBLE_MS,
  updateSessionUnit,
} from '@/modules/practice/ui/freestyle/model/freestyleUnitReviewSession'
import { useUnitPreview } from '@/modules/practice/ui/freestyle/model/freestyleUnitPreviewCache'
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
import { useFreestyleCardParticles } from './useFreestyleCardParticles'
import { FreestyleUnitReviewFlipPanel } from './FreestyleUnitReviewFlipPanel'
import { FreestyleUnitReviewIdentityRow, FreestyleUnitReviewPlaceholder } from './FreestyleUnitReviewChrome'

export {
  ratingEffectLabel,
  retryPositionLabel,
} from '@/modules/practice/ui/freestyle/model/ratingEffectLabels'


export function FreestyleUnitReviewCardView({
  card,
  active,
  nearViewport = false,
  readOnly,
  roundId,
  encounter,
  retryAfterCards,
  onEnsureEncounter,
  onEncounterChange,
  onBranchComplete,
  onStaleDrop,
  onRemoveFromQueue,
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
  /** Adjacent to the viewport: may draw its read-only preview before activation. */
  nearViewport?: boolean
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
   * Fired when the learner rates, before the server answers, so the channel and
   * the next card do not wait on the network. A failed post rolls the card back.
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
  /** Drop this card from the current round. Does not write a review rating. */
  onRemoveFromQueue?: (cardId: string) => void
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
  const mountedRef = useRef(true)
  const rateHoldRef = useRef(0)
  const mailboxRef = useRef<RateMailbox>(emptyMailbox())
  const optimisticRatingRef = useRef<UnitRating | null>(null)
  const baselinesRef = useRef(new Map<number, UnitReviewSessionDto>())
  const lastOperationIdRef = useRef<string | null>(null)
  const planVersionRef = useRef(planVersion)
  const roundIdRef = useRef(roundId)
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
  planVersionRef.current = planVersion
  roundIdRef.current = roundId
  lastOperationIdRef.current = lastOperationId
  sessionRef.current = session
  const unit = session?.units.find((item) => item.id === card.unit_id) ?? null
  unitRef.current = unit
  const { breath, signalRating, clearBreath } = useFreestyleFlowFeedback()
  const rateBridgeRef = useRef({
    onEncounterChange,
    onBranchComplete,
    onRatingSettled,
    onRoundSync,
    onStaleDrop,
    onSaveFailed,
    onBatchCardsSettled,
    signalRating,
  })
  rateBridgeRef.current = {
    onEncounterChange,
    onBranchComplete,
    onRatingSettled,
    onRoundSync,
    onStaleDrop,
    onSaveFailed,
    onBatchCardsSettled,
    signalRating,
  }
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
  const sectionRef = useRef<HTMLElement | null>(null)
  const cardParticles = useFreestyleCardParticles({
    sectionRef,
    active,
    progressKey: flipProgressKey,
    revealed: activeFlipProgress?.revealed ?? null,
    total: activeFlipProgress?.total ?? null,
  })
  const effectiveRevision = adoptedRevision ?? card.unit_revision
  const cardUnitKey =
    card.unit_id && effectiveRevision != null
      ? `${card.id}:${card.unit_id}:${effectiveRevision}:${roundId}`
      : null
  // Read-only preview: the real map is drawn while the card slides in; the encounter
  // still opens only on activation. Limited to the active card and its neighbours.
  const preview = useUnitPreview(active || nearViewport ? card.unit_id : null, effectiveRevision)
  const previewUnit = preview?.units.find((item) => item.id === card.unit_id) ?? null
  const previewEditorState = useMemo(() => (preview ? buildEditorState(preview) : null), [preview])
  const flipSource = editorState && session && unit && unit.encounter
    ? { live: true, session, unit, editorState: savedEditorState ?? editorState }
    : !recapOnly && !loadError && !staleRecovery && preview && previewUnit && previewEditorState
      ? { live: false, session: preview, unit: previewUnit, editorState: previewEditorState }
      : null
  // One FlipPanel across preview → live; only a genuine encounter renewal (restudy after
  // a fail) remounts it, so the landed card never blanks while its session arrives.
  const liveEncounterId = flipSource?.live ? flipSource.unit.encounter?.id ?? null : null
  const [flipIdentity, setFlipIdentity] = useState<{ encounterId: string | null; generation: number }>({
    encounterId: null,
    generation: 0,
  })
  if (liveEncounterId && liveEncounterId !== flipIdentity.encounterId) {
    setFlipIdentity({
      encounterId: liveEncounterId,
      generation: flipIdentity.encounterId ? flipIdentity.generation + 1 : flipIdentity.generation,
    })
  }
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
    // A rate POST still references this encounter. Leave-close waits until it settles.
    if (busyRef.current || rateHoldRef.current > 0) {
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
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      mailboxRef.current = { ...emptyMailbox(), latest: mailboxRef.current.latest + 1 }
      void closeCurrentEncounterRef.current()
    }
  }, [])

  function rememberOperation(id: string | null) {
    lastOperationIdRef.current = id
    if (mountedRef.current) setLastOperationId(id)
  }

  function holdEncounter() {
    rateHoldRef.current += 1
  }

  function releaseEncounter() {
    rateHoldRef.current = Math.max(0, rateHoldRef.current - 1)
    if (rateHoldRef.current === 0 && !busyRef.current && !activeRef.current) {
      void closeCurrentEncounter()
    }
  }

  function paintOptimistic(rating: UnitRating, encounterId: string) {
    const currentSession = sessionRef.current
    const currentUnit = unitRef.current
    const currentEncounter = currentUnit?.encounter
    if (!currentSession || !currentUnit || !currentEncounter) return
    const effect = currentEncounter.rating_effects.find((item) => item.rating === rating)
    const passed = ratingPassed(rating)
    const gap = effect?.retry_after_cards ?? (passed ? 0 : retryAfterCards)
    const nextEncounter = {
      ...currentEncounter,
      selected_rating: rating,
      passed,
      retry_after_cards: gap,
    }
    const nextUnit: ReviewUnitDto = { ...currentUnit, final_rating: rating, encounter: nextEncounter }
    const nextSession = updateSessionUnit(currentSession, nextUnit)
    optimisticRatingRef.current = rating
    sessionRef.current = nextSession
    unitRef.current = nextUnit
    if (mountedRef.current) setSession(nextSession)
    const bridge = rateBridgeRef.current
    const cardId = cardRef.current.id
    bridge.onEncounterChange(cardId, encounterState(currentSession.id, nextUnit.revision, nextEncounter))
    bridge.onBranchComplete(cardId, { restudy: !passed, rating, retryAfterCards: gap })
    bridge.onRatingSettled?.(cardId, passed, rating, {
      occurrenceId: cardRef.current.occurrence_kind === 'retry' ? cardId : cardId,
      encounterId,
      planVersion: planVersionRef.current,
    })
    bridge.signalRating(rating, passed)
  }

  function paintCleared() {
    optimisticRatingRef.current = null
    const currentSession = sessionRef.current
    const currentUnit = unitRef.current
    const currentEncounter = currentUnit?.encounter
    const cardId = cardRef.current.id
    if (currentSession && currentUnit && currentEncounter) {
      const nextEncounter = {
        ...currentEncounter,
        selected_rating: null,
        passed: null,
        retry_after_cards: 0,
        effective_operation_id: null,
      }
      const nextUnit: ReviewUnitDto = { ...currentUnit, final_rating: null, encounter: nextEncounter }
      const nextSession = updateSessionUnit(currentSession, nextUnit)
      sessionRef.current = nextSession
      unitRef.current = nextUnit
      if (mountedRef.current) setSession(nextSession)
      rateBridgeRef.current.onEncounterChange(
        cardId,
        encounterState(currentSession.id, nextUnit.revision, nextEncounter),
      )
    }
    rateBridgeRef.current.onBranchComplete(cardId, { cleared: true })
    if (mountedRef.current) setUndoVisible(false)
  }

  function rollbackRating(generation: number) {
    const baseline = baselinesRef.current.get(generation)
    optimisticRatingRef.current = null
    const cardId = cardRef.current.id
    if (!baseline) {
      rateBridgeRef.current.onBranchComplete(cardId, { cleared: true })
      return
    }
    const nextUnit = baseline.units.find((item) => item.id === cardRef.current.unit_id) ?? null
    sessionRef.current = baseline
    unitRef.current = nextUnit
    if (mountedRef.current) setSession(baseline)
    const previous = asUnitRating(nextUnit?.encounter?.selected_rating)
    if (nextUnit?.encounter) {
      rateBridgeRef.current.onEncounterChange(
        cardId,
        encounterState(baseline.id, nextUnit.revision, nextUnit.encounter),
      )
    }
    if (previous == null) {
      rateBridgeRef.current.onBranchComplete(cardId, { cleared: true })
    } else {
      rateBridgeRef.current.onBranchComplete(cardId, {
        restudy: !ratingPassed(previous),
        rating: previous,
        retryAfterCards: nextUnit?.encounter?.retry_after_cards ?? 0,
      })
    }
  }

  async function postRating(ticket: RateTicket) {
    const currentUnit = unitRef.current
    if (!currentUnit) return null
    const payload = {
      operation_id: ticket.operationId,
      expected_version: planVersionRef.current,
      card_id: ticket.cardId,
      occurrence_id: ticket.occurrenceId,
      encounter_id: ticket.encounterId,
      rating: ticket.rating,
      study_session_id: ticket.sessionId,
      unit_id: ticket.unitId,
      unit_revision: ticket.unitRevision,
    }
    let unitResult: Awaited<ReturnType<typeof rateReviewUnitApi>> | null
    let nextPlanVersion = planVersionRef.current
    if (roundIdRef.current) {
      const response = await rateFreestyleRoundUnitApi(roundIdRef.current, payload)
      rateBridgeRef.current.onRoundSync?.(response.round)
      nextPlanVersion = Number(response.round?.plan_version ?? response.round?.version ?? nextPlanVersion)
      planVersionRef.current = nextPlanVersion
      unitResult = response.item as Awaited<ReturnType<typeof rateReviewUnitApi>>
      if (!unitResult && isCurrentIntent(mailboxRef.current, ticket.generation)) {
        const retryResponse = await rateFreestyleRoundUnitApi(roundIdRef.current, {
          ...payload,
          operation_id: operationId(),
          expected_version: nextPlanVersion,
        })
        rateBridgeRef.current.onRoundSync?.(retryResponse.round)
        nextPlanVersion = Number(retryResponse.round?.plan_version ?? retryResponse.round?.version ?? nextPlanVersion)
        planVersionRef.current = nextPlanVersion
        unitResult = retryResponse.item as Awaited<ReturnType<typeof rateReviewUnitApi>>
      }
    } else {
      unitResult = await rateReviewUnitApi(
        ticket.sessionId,
        currentUnit,
        ticket.encounterId,
        ticket.rating,
        ticket.operationId,
        currentUnit.encounter?.round_id,
      )
    }
    return { unitResult, nextPlanVersion }
  }

  function settleRating(
    unitResult: Awaited<ReturnType<typeof rateReviewUnitApi>>,
    ticket: RateTicket,
    nextPlanVersion: number,
  ) {
    const currentSession = sessionRef.current
    const currentUnit = unitRef.current
    const currentEncounter = currentUnit?.encounter
    if (!currentSession || !currentUnit || !currentEncounter) return
    if (String(unitResult.unit?.id || '') !== ticket.unitId) {
      if (mountedRef.current) setActionError('评分身份不匹配，未应用到这张卡。')
      rollbackRating(ticket.generation)
      return
    }
    const nextEncounter = adoptRatedEncounter(currentEncounter, unitResult.encounter)
    const nextUnit: ReviewUnitDto = {
      ...currentUnit,
      ...unitResult.unit,
      title: unitResult.unit.title || currentUnit.title,
      session_status: unitResult.session_status,
      final_rating: unitResult.rating,
      encounter: nextEncounter,
    }
    const nextSessionId = unitResult.study_session_id || ticket.sessionId
    const nextSession = updateSessionUnit(
      currentSession.id === nextSessionId ? currentSession : { ...currentSession, id: nextSessionId },
      nextUnit,
    )
    optimisticRatingRef.current = asUnitRating(nextEncounter.selected_rating)
    sessionRef.current = nextSession
    unitRef.current = nextUnit
    if (mountedRef.current) setSession(nextSession)
    rememberOperation(unitResult.operation_id)
    rateBridgeRef.current.onEncounterChange(
      ticket.cardId,
      encounterState(nextSessionId, nextUnit.revision, nextEncounter),
    )
    if (
      currentEncounter.passed !== unitResult.passed
      || currentEncounter.retry_after_cards !== unitResult.retry_after_cards
      || currentEncounter.selected_rating !== unitResult.rating
    ) {
      rateBridgeRef.current.onBranchComplete(ticket.cardId, {
        restudy: !unitResult.passed,
        rating: unitResult.rating,
        retryAfterCards: unitResult.retry_after_cards,
      })
    }
    if (mountedRef.current) revealUndo()
    if (unitResult.rating !== ticket.rating || unitResult.passed !== ratingPassed(ticket.rating)) {
      rateBridgeRef.current.onRatingSettled?.(ticket.cardId, unitResult.passed, unitResult.rating, {
        occurrenceId: ticket.occurrenceId || ticket.cardId,
        encounterId: ticket.encounterId,
        planVersion: nextPlanVersion,
      })
    }
  }

  function confirmedSession(
    unitResult: Awaited<ReturnType<typeof rateReviewUnitApi>>,
    ticket: RateTicket,
  ): UnitReviewSessionDto | null {
    const base = baselinesRef.current.get(ticket.generation) ?? sessionRef.current
    const baseUnit = base?.units.find((item) => item.id === ticket.unitId) ?? null
    const baseEncounter = baseUnit?.encounter
    if (!base || !baseUnit || !baseEncounter) return null
    if (String(unitResult.unit?.id || '') !== ticket.unitId) return null
    const nextEncounter = adoptRatedEncounter(baseEncounter, unitResult.encounter)
    const nextUnit: ReviewUnitDto = {
      ...baseUnit,
      ...unitResult.unit,
      title: unitResult.unit.title || baseUnit.title,
      session_status: unitResult.session_status,
      final_rating: unitResult.rating,
      encounter: nextEncounter,
    }
    const nextSessionId = unitResult.study_session_id || ticket.sessionId
    return updateSessionUnit(
      base.id === nextSessionId ? base : { ...base, id: nextSessionId },
      nextUnit,
    )
  }

  async function dispatchRating(ticket: RateTicket) {
    holdEncounter()
    try {
      const posted = await postRating(ticket)
      const current = isCurrentIntent(mailboxRef.current, ticket.generation)
      const follow = noteInflightDone(mailboxRef.current, ticket.generation)
      mailboxRef.current = follow.box
      if (follow.undo) {
        baselinesRef.current.delete(ticket.generation)
        if (posted?.unitResult?.operation_id) {
          rememberOperation(posted.unitResult.operation_id)
          await undoRating({ clearAll: true })
        }
        return
      }
      if (follow.send && posted?.unitResult) {
        const confirmed = confirmedSession(posted.unitResult, ticket)
        if (confirmed) baselinesRef.current.set(follow.send.generation, confirmed)
        const revision = posted.unitResult.unit?.revision
        if (typeof revision === 'number') follow.send.unitRevision = revision
      }
      if (!posted?.unitResult) {
        if (current) {
          rollbackRating(ticket.generation)
          if (mountedRef.current) setActionError('评分没有记下，请重试。')
        }
      } else if (current) {
        settleRating(posted.unitResult, ticket, posted.nextPlanVersion)
      }
      baselinesRef.current.delete(ticket.generation)
      if (follow.send) await dispatchRating(follow.send)
    } catch (error) {
      const current = isCurrentIntent(mailboxRef.current, ticket.generation)
      const follow = noteInflightDone(mailboxRef.current, ticket.generation)
      mailboxRef.current = isStaleUnitError(error) ? emptyMailbox() : follow.box
      const diagnostic = formatUnitDiagnostic({
        error,
        card: cardRef.current,
        roundId: roundIdRef.current,
        operationId: ticket.operationId,
        stage: isStaleUnitError(error) ? '评分后卡片已过期' : '提交评分',
      })
      if (isStaleUnitError(error)) {
        baselinesRef.current.delete(ticket.generation)
        optimisticRatingRef.current = null
        if (mountedRef.current) {
          setActionError(`${diagnostic}\n已检测到内容版本变化，正在自动更新复习安排。`)
        }
        rateBridgeRef.current.onSaveFailed(diagnostic)
        rateBridgeRef.current.onStaleDrop(ticket.cardId)
        return
      }
      if (current && !follow.undo) {
        rollbackRating(ticket.generation)
        if (mountedRef.current) setActionError(diagnostic)
        rateBridgeRef.current.onSaveFailed(diagnostic)
      }
      baselinesRef.current.delete(ticket.generation)
      if (follow.send) await dispatchRating(follow.send)
    } finally {
      releaseEncounter()
    }
  }

  async function rate(rating: UnitRating) {
    const currentEncounter = unit?.encounter
    const liveSelected = optimisticRatingRef.current ?? currentEncounter?.selected_rating
    if (liveSelected === rating) {
      await undoRating({ clearAll: true })
      return
    }
    const recorded = asUnitRating(lastRating) ?? asUnitRating(encounter?.selectedRating)
    if (optimisticRatingRef.current == null && currentEncounter?.selected_rating == null && recorded === rating) {
      return
    }
    const blockedReason = !session || !unit || !currentEncounter
      ? '评分按钮暂不可用：复习会话仍在加载。'
      : busy
        ? '操作正在提交，请稍候。'
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
    const generation = mailboxRef.current.latest + 1
    // A grade queued behind one already on the wire rolls back to the last
    // confirmed session, not to the optimistic paint of that in-flight grade.
    const inflightGeneration = mailboxRef.current.inflight?.generation
    const baseline = (inflightGeneration != null
      ? baselinesRef.current.get(inflightGeneration)
      : null) ?? sessionRef.current
    if (baseline) baselinesRef.current.set(generation, baseline)
    const decision = acceptRating(mailboxRef.current, {
      rating,
      operationId: operationId(),
      cardId: card.id,
      occurrenceId: card.occurrence_kind === 'retry' ? card.id : '',
      encounterId: currentEncounter.id,
      unitId: unit.id,
      sessionId: session.id,
      unitRevision: unit.revision,
    })
    mailboxRef.current = decision.box
    paintOptimistic(rating, currentEncounter.id)
    if (decision.sendNow) void dispatchRating(decision.ticket)
  }

  async function undoRating(options?: { clearAll?: boolean }) {
    if (readOnly) {
      setActionError('历史记录为只读，不能撤销评分。')
      return
    }
    // The grade is still on the wire. Drop it locally now; the reply undoes
    // itself once the server returns an operation id.
    if (mailboxRef.current.inflight) {
      mailboxRef.current = requestUndo(mailboxRef.current)
      paintCleared()
      return
    }
    const currentSession = sessionRef.current ?? session
    const currentUnit = unitRef.current ?? unit
    const knownOperationId = lastOperationIdRef.current ?? currentUnit?.encounter?.effective_operation_id
    if (!knownOperationId || !currentSession || !currentUnit || busyRef.current) {
      setActionError(busyRef.current ? '操作正在提交，请稍候。' : '暂无可撤销的评分。')
      return
    }
    setActionError(null)
    setBusy(true)
    busyRef.current = true
    const undoneRating = currentUnit.encounter?.selected_rating ?? null
    try {
      let workingSession = currentSession
      let workingUnit = currentUnit
      let workingOperationId: string | null = knownOperationId
      let lastResult: Awaited<ReturnType<typeof undoReviewUnitRatingApi>> | null = null
      const seen = new Set<string>()
      while (workingOperationId && !seen.has(workingOperationId)) {
        seen.add(workingOperationId)
        const result = await undoReviewUnitRatingApi(workingOperationId, roundIdRef.current)
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
      cardParticles.playUndo(undoneRating as UnitRating | null)
      sessionRef.current = workingSession
      unitRef.current = workingUnit
      optimisticRatingRef.current = asUnitRating(lastResult.encounter.selected_rating)
      if (mountedRef.current) setSession(workingSession)
      rememberOperation(lastResult.encounter.effective_operation_id)
      const cardId = cardRef.current.id
      rateBridgeRef.current.onEncounterChange(
        cardId,
        encounterState(workingSession.id, workingUnit.revision, lastResult.encounter),
      )
      const settledIds = lastSettledCardIdsRef.current.length ? lastSettledCardIdsRef.current : [cardId]
      if (lastResult.encounter.selected_rating == null) {
        if (undoTimerRef.current != null) {
          window.clearTimeout(undoTimerRef.current)
          undoTimerRef.current = null
        }
        if (mountedRef.current) setUndoVisible(false)
        lastSettledCardIdsRef.current = []
        if (rateBridgeRef.current.onBatchCardsSettled && settledIds.length > 1) {
          rateBridgeRef.current.onBatchCardsSettled(settledIds.map((settledId) => ({ cardId: settledId, cleared: true })))
        } else {
          rateBridgeRef.current.onBranchComplete(cardId, { cleared: true })
        }
      } else {
        rateBridgeRef.current.onBranchComplete(cardId, {
          restudy: !lastResult.encounter.passed,
          rating: lastResult.encounter.selected_rating ?? undefined,
          retryAfterCards: lastResult.encounter.retry_after_cards,
        })
      }
    } catch (error) {
      const diagnostic = formatUnitDiagnostic({
        error,
        card: cardRef.current,
        roundId: roundIdRef.current,
        operationId: knownOperationId,
        stage: options?.clearAll ? '取消评分' : '撤销评分',
      })
      if (mountedRef.current) setActionError(diagnostic)
      rateBridgeRef.current.onSaveFailed(diagnostic)
    } finally {
      busyRef.current = false
      if (mountedRef.current) setBusy(false)
      if (rateHoldRef.current === 0 && !activeRef.current) {
        void closeCurrentEncounter()
      }
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
    <section ref={sectionRef} className="flex h-full min-h-0 flex-col" aria-label="永久标记复习单元">
      {/* Warm paper: same canvas as PWA review; dark stage chrome stays on the shell. */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.4rem] border border-stage-line-strong bg-paper shadow-[inset_0_1px_0_hsl(43_100%_100%/0.9),0_24px_60px_-18px_rgb(0_0_0/0.65)] sm:rounded-3xl">
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
        <FreestyleUnitReviewIdentityRow
          titleText={titleText}
          phase={card.phase}
          flipTone={flipTone}
          flipLabel={flipLabel}
          flipTitle={flipTitle}
          showUndo={Boolean(undoVisible && lastOperationId && !locked)}
          undoDisabled={busy}
          onUndo={() => void undoRating()}
        />
        {flipSource ? (
          <div
            data-testid="freestyle-unit-review-map-shell"
            data-preview={flipSource.live ? undefined : 'true'}
            className={cn(
              'fs-unit-arrive flex min-h-0 flex-1 flex-col',
              !inlineEditing && 'pb-[6.75rem] sm:pb-[7.25rem]',
            )}
          >
          <FreestyleUnitReviewFlipPanel
            key={`${card.id}:${flipIdentity.generation}`}
            card={card}
            session={flipSource.session}
            unit={flipSource.unit}
            editorState={flipSource.editorState}
            active={active && flipSource.live}
            paintStage={active || nearViewport}
            fullscreen={fullscreen}
            onToggleFullscreen={onToggleFullscreen}
            freestyleFlipMode={freestyleFlipMode}
            onFreestyleFlipModeChange={flipSource.live ? onFreestyleFlipModeChange : undefined}
            autoAdvance={autoAdvance}
            onAutoAdvanceChange={flipSource.live ? onAutoAdvanceChange : undefined}
            preferredZoom={preferredZoom}
            onUserZoomChange={flipSource.live ? onUserZoomChange : undefined}
            // A preview must never report editing/reveal/save state: it would clobber the
            // active card's inline edit and push a fake reveal map to live sync.
            onEditingChange={flipSource.live
              ? (editing) => {
                  setInlineEditing(editing)
                  onEditingChange?.(editing)
                }
              : undefined}
            onSaveFailed={flipSource.live ? onSaveFailed : undefined}
            onEditorStateSaved={flipSource.live ? setSavedEditorState : undefined}
            onUnitsReconciled={flipSource.live ? onUnitsReconciled : undefined}
            onRevealProgressChange={flipSource.live ? handleRevealProgressChange : undefined}
            syncedRevealMap={flipSource.live ? liveRevealMap : null}
            onRevealMapChange={flipSource.live ? onLiveRevealMapChange : undefined}
            onOpenScopeQuiz={flipSource.live ? onOpenScopeQuiz : undefined}
          />
          </div>
        ) : (
          <FreestyleUnitReviewPlaceholder
            card={card}
            recapOnly={recapOnly}
            loadError={loadError}
            loadErrorTitle={loadErrorTitle}
            loadErrorHint={loadErrorHint}
            staleRecovery={staleRecovery}
            onRetry={retryLoad}
            onSkip={() => onStaleDrop(card.id)}
            onRebuildRound={onRebuildRound}
            onRecapOnly={() => {
              setRecapOnly(true)
              setLoadError(null)
              setActionError(null)
            }}
          />
        )}

        {active && !inlineEditing && !loadError && !recapOnly ? (
          <FreestyleRatingBar
            ratingEffects={currentEncounter?.rating_effects ?? []}
            selectedRating={selectedRating}
            recordedRating={recordedRating}
            retryAfterCards={retryAfterCards}
            busy={busy}
            locked={locked}
            reviewReady={reviewReady}
            hasEncounter={Boolean(currentEncounter)}
            actionError={actionError}
            blockedHint={blockedHint}
            shortcutsActive={active && !inlineEditing}
            onRate={(rating) => void rate(rating)}
            onRemoveFromQueue={
              readOnly || !onRemoveFromQueue
                ? undefined
                : () => {
                    cardParticles.playRemove()
                    onRemoveFromQueue(card.id)
                  }
            }
            onDismissError={() => setActionError(null)}
          />
        ) : null}
      </div>
    </section>
  )
}
