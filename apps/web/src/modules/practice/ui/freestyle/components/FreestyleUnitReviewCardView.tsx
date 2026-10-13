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
  ratingOnThisAppearance,
  formatUnitDiagnostic,
  loadSessionWithTimeout,
  operationId,
  UNDO_VISIBLE_MS,
  updateSessionUnit,
} from '@/modules/practice/ui/freestyle/model/freestyleUnitReviewSession'
import {
  rememberUnitPreview,
  useSharedPalacePreview,
  useUnitPreview,
} from '@/modules/practice/ui/freestyle/model/freestyleUnitPreviewCache'
import {
  enqueueFreestyleSessionTask,
  FREESTYLE_SESSION_OPEN_DELAY_MS,
} from '@/modules/practice/ui/freestyle/model/freestyleSessionLane'
import { cn } from '@/shared/lib/utils'
import { useFreestyleFlowFeedback } from '@/modules/practice/ui/freestyle/hooks/useFreestyleFlowFeedback'
import { FLOW_BREATH_CLASS } from '@/modules/practice/ui/freestyle/model/freestyleFlowFeedback'
import {
  decideLoadedUnitSession,
  isPermanentUnitAbsence,
  isStaleUnitError,
} from '@/modules/practice/ui/freestyle/model/freestyleStaleRecovery'
import { freestyleUnitLoadFailureCopy } from '@/modules/practice/ui/freestyle/model/freestyleUnitLoadRecovery'
import { FreestyleRatingBar } from './FreestyleRatingBar'
import { useFreestyleCardFeedback } from './useFreestyleCardFeedback'
import { FreestyleUnitReviewFlipPanel } from './FreestyleUnitReviewFlipPanel'
import { FreestyleUnitReviewIdentityRow, FreestyleUnitReviewPlaceholder } from './FreestyleUnitReviewChrome'
import { recordSessionRecorderUiAction } from '@/shared/debug/session-recorder'

export {
  ratingEffectLabel,
  retryPositionLabel,
} from '@/modules/practice/ui/freestyle/model/ratingEffectLabels'


export const RATING_SAVE_FAILED_COPY = '这一次没有保存成功'

async function abandonUnshownSession(value: UnitReviewSessionDto, unitId: string | null | undefined) {
  const encounter = value.units.find((item) => item.id === unitId)?.encounter
  if (!encounter || encounter.status !== 'open' || encounter.selected_rating != null) return
  try {
    await cancelUnratedUnitReviewEncounterApi(value.id, unitId ?? '', encounter.id)
  } catch {
    // The next card's start also releases a competing unrated glance.
  }
}

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
  requestedRating = null,
  onRequestedRatingHandled,
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
  /** Sheet asked this active card to rate once its encounter is open. */
  requestedRating?: UnitRating | null
  onRequestedRatingHandled?: () => void
  retryAfterCards: number
  /** Why 「下一组」 is blocked, shown inline instead of a toast. */
  blockedHint?: string | null
  /**
   * Fired only after the latest rating is acknowledged by the server. Immediate
   * button selection is local intent, never completion or permission to advance.
   * A failed post retains that unsaved intent without reloading the card.
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
  onStaleDrop: (cardId: string, options?: { force?: boolean }) => void
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
  const saveFailedRef = useRef(false)
  const commitHoldRef = useRef(0)
  const commitIdleRef = useRef(true)
  const commitChainRef = useRef<Promise<void>>(Promise.resolve())
  const urgentGlanceRef = useRef(false)
  // A tap is queued and saved in the background. It is never lit as chosen: the
  // grade shows as selected only once the server confirms it (intentRating is
  // set from confirmed results). Until then the bar shows a quiet 保存中 hint.
  const [intentRating, setIntentRating] = useState<UnitRating | null>(null)
  const [ratingSave, setRatingSave] = useState<{ rating: UnitRating; status: 'saving' | 'failed' } | null>(null)
  const showSavingRating = ratingSave?.status === 'saving' ? ratingSave.rating : null
  const [glanceKick, setGlanceKick] = useState(0)
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
  const lastLoadErrorRef = useRef<unknown>(null)
  const loadGenerationRef = useRef(0)
  const loadAttemptRef = useRef(0)
  const pendingGlanceRef = useRef<string | null>(null)
  const glanceTimerRef = useRef<number | null>(null)
  const encounterRef = useRef(encounter)
  const ensureEncounterRef = useRef(onEnsureEncounter)
  const revisionAdoptedRef = useRef(onRevisionAdopted)
  ensureEncounterRef.current = onEnsureEncounter
  revisionAdoptedRef.current = onRevisionAdopted
  const cardRef = useRef(card)
  cardRef.current = card

  activeRef.current = active
  loadAttemptRef.current = loadAttempt
  encounterRef.current = encounter
  busyRef.current = busy
  planVersionRef.current = planVersion
  roundIdRef.current = roundId
  lastOperationIdRef.current = lastOperationId
  // A render can land before setSession flushes. Do not wipe the glance the
  // in-flight score just adopted, or the post reads an empty unit and fails.
  if (session || commitHoldRef.current === 0) {
    sessionRef.current = session
    unitRef.current = session?.units.find((item) => item.id === card.unit_id) ?? null
  }
  const unit = unitRef.current
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
  const editorState = useMemo(() => session ? buildEditorState(session) : null, [session])
  // Keyed so a new card/encounter hides the chip until FlipPanel reports (no parent reset race).
  const flipProgressKey = `${card.id}:${unit?.encounter?.id ?? 'none'}`
  const activeFlipProgress =
    flipProgress && flipProgress.key === flipProgressKey ? flipProgress : null
  const sectionRef = useRef<HTMLElement | null>(null)
  const cardFeedback = useFreestyleCardFeedback({
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
  const exactPreview = useUnitPreview(active || nearViewport ? card.unit_id : null, effectiveRevision)
  const sharedPreview = useSharedPalacePreview(
    exactPreview || !(active || nearViewport) ? null : card,
  )
  const preview = exactPreview ?? sharedPreview
  const previewUnit = preview?.units.find((item) => item.id === card.unit_id) ?? null
  const previewEditorState = useMemo(() => (preview ? buildEditorState(preview) : null), [preview])
  const flipSource = editorState && session && unit && unit.encounter
    ? { live: true, session, unit, editorState: savedEditorState ?? editorState }
    : !recapOnly && !staleRecovery && preview && previewUnit && previewEditorState
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
    setIntentRating(null)
    setRatingSave(null)
    optimisticRatingRef.current = null
    saveFailedRef.current = false
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
    if (isPermanentUnitAbsence(lastLoadErrorRef.current)) {
      onStaleDrop(cardRef.current.id, { force: true })
      return
    }
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
  }, [onStaleDrop])

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
    if (busyRef.current || rateHoldRef.current > 0 || commitHoldRef.current > 0) {
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
      currentEncounter.round_id,
    ).then((result) => {
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
  }, [card.id, onEncounterChange, onSaveFailed])

  const closeCurrentEncounterRef = useRef(closeCurrentEncounter)
  closeCurrentEncounterRef.current = closeCurrentEncounter

  useEffect(() => {
    const liveCard = cardRef.current
    if (!active && commitHoldRef.current === 0) return
    if (recapOnly) return
    if (!liveCard.unit_id || effectiveRevision == null || !cardUnitKey) {
      rateBridgeRef.current.onStaleDrop(liveCard.id)
      return
    }
    // Skip checks use the encounter already on the card. Creating one persists
    // queue state, so a card that is only flashed must not do it yet.
    const identity = encounter ?? null
    if (readOnly && identity?.status !== 'closed') return
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
        liveEncounter.id === identity?.encounterId
        || identity?.status === 'open'
      ),
    )
    const sameClosedView = Boolean(
      openedForKeyRef.current === cardUnitKey
      && sessionRef.current
      && liveEncounter
      && identity?.status === 'closed'
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
      && identity?.status !== 'pending'
    )
    const glanceToken = `${cardUnitKey}:${identity?.encounterId ?? ''}:${loadAttempt}`
    if (sameOpenGlance || sameClosedView || sameRatedOpenGlance) {
      if (pendingGlanceRef.current === glanceToken) pendingGlanceRef.current = null
      return
    }
    // Parent echo of the encounter we just opened must not start a second POST.
    if (pendingGlanceRef.current === glanceToken) return
    pendingGlanceRef.current = glanceToken
    const requestIdentity = `${glanceToken}:${operationId()}`
    const generation = ++loadGenerationRef.current
    loadOperationRef.current = requestIdentity
    const sessionCard =
      effectiveRevision !== liveCard.unit_revision
        ? { ...liveCard, unit_revision: effectiveRevision }
        : liveCard
    // A flashed card, a fast flip, or a progress-rail flyby must not open a glance.
    // Scoring does not wait on this delay: a tap opens the glance immediately.
    const urgent = urgentGlanceRef.current
    urgentGlanceRef.current = false
    const delay = loadAttempt > 0 || urgent ? 0 : FREESTYLE_SESSION_OPEN_DELAY_MS
    if (glanceTimerRef.current != null) window.clearTimeout(glanceTimerRef.current)
    const timer = window.setTimeout(() => {
      if (glanceTimerRef.current === timer) glanceTimerRef.current = null
      void enqueueFreestyleSessionTask(async () => {
        if (loadGenerationRef.current !== generation || !activeRef.current) return
        const liveIdentity = ensureEncounterRef.current(liveCard.id, effectiveRevision, !readOnly)
        if (readOnly && liveIdentity.status !== 'closed') return
        setLoadError(null)
        setActionError(null)
        try {
          const value = await loadSessionWithTimeout(sessionCard, liveIdentity, roundId)
          const left = loadGenerationRef.current !== generation || !activeRef.current || !mountedRef.current
          if (left) {
            const nextUnit = value.units.find((item) => item.id === liveCard.unit_id)
            if (commitHoldRef.current > 0 && nextUnit?.encounter) {
              sessionRef.current = value
              unitRef.current = nextUnit
              if (mountedRef.current && activeRef.current) setSession(value)
              return
            }
            if (!activeRef.current || !mountedRef.current) {
              await abandonUnshownSession(value, liveCard.unit_id)
            }
            return
          }
          const nextUnit = value.units.find((item) => item.id === liveCard.unit_id)
          const decision = decideLoadedUnitSession({
            cardUnitId: liveCard.unit_id,
            cardRevision: effectiveRevision,
            unit: nextUnit,
            identityStatus: liveIdentity.status,
          })
          if (decision.action === 'drop' || !nextUnit?.encounter) {
            rateBridgeRef.current.onStaleDrop(liveCard.id)
            return
          }
          if (liveCard.unit_id) rememberUnitPreview(liveCard.unit_id, nextUnit.revision, value)
          if (decision.action === 'adopt') {
            setAdoptedRevision(nextUnit.revision)
            if (liveCard.unit_id) revisionAdoptedRef.current?.(liveCard.id, liveCard.unit_id, nextUnit.revision)
          }
          openedForKeyRef.current = `${liveCard.id}:${liveCard.unit_id}:${nextUnit.revision}:${roundId}`
          lastLoadErrorRef.current = null
          setSession(value)
          setLoadError(null)
          setStaleRecovery(false)
          setLastOperationId(nextUnit.encounter.effective_operation_id)
          rateBridgeRef.current.onEncounterChange(
            liveCard.id,
            encounterState(value.id, nextUnit.revision, nextUnit.encounter),
          )
        } catch (error) {
          if (loadGenerationRef.current !== generation || !activeRef.current || !mountedRef.current) return
          lastLoadErrorRef.current = error
          if (isPermanentUnitAbsence(error)) {
            setStaleRecovery(true)
            rateBridgeRef.current.onStaleDrop(liveCard.id, { force: true })
            return
          }
          if (isStaleUnitError(error)) {
            setStaleRecovery(true)
            rateBridgeRef.current.onStaleDrop(liveCard.id)
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
          if (pendingGlanceRef.current === glanceToken) pendingGlanceRef.current = null
          setLoadError(message)
          setLoadErrorTitle(copy.title)
          setLoadErrorHint(copy.hint)
          setActionError(null)
        }
      })
    }, delay)
    glanceTimerRef.current = timer
    return () => {
      // Unmount cleanup runs after the mountedRef effect, which is declared
      // later. A leaked timer would POST into the next card.
      if (commitHoldRef.current > 0) return
      if (!mountedRef.current) {
        window.clearTimeout(timer)
        if (glanceTimerRef.current === timer) glanceTimerRef.current = null
        if (pendingGlanceRef.current === glanceToken) pendingGlanceRef.current = null
        if (loadGenerationRef.current === generation) loadGenerationRef.current += 1
        return
      }
      const sameGlance = activeRef.current
        && cardRef.current.id === liveCard.id
        && loadAttemptRef.current === loadAttempt
        && (encounterRef.current?.encounterId ?? '') === (identity?.encounterId ?? '')
      if (sameGlance && pendingGlanceRef.current === glanceToken) return
      window.clearTimeout(timer)
      if (pendingGlanceRef.current === glanceToken) pendingGlanceRef.current = null
      if (loadGenerationRef.current === generation) loadGenerationRef.current += 1
    }
    // Identity fields only. The full encounter/card object is intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    recapOnly,
    readOnly,
    roundId,
    loadAttempt,
    glanceKick,
  ])

  const wasActiveRef = useRef(false)
  useEffect(() => {
    if (active) {
      wasActiveRef.current = true
      return
    }
    if (!wasActiveRef.current) return
    wasActiveRef.current = false
    void enqueueFreestyleSessionTask(() => closeCurrentEncounterRef.current())
  }, [active])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (commitHoldRef.current > 0) return
      if (glanceTimerRef.current != null) {
        window.clearTimeout(glanceTimerRef.current)
        glanceTimerRef.current = null
      }
      mailboxRef.current = { ...emptyMailbox(), latest: mailboxRef.current.latest + 1 }
      void enqueueFreestyleSessionTask(() => closeCurrentEncounterRef.current())
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
      void enqueueFreestyleSessionTask(() => closeCurrentEncounterRef.current())
    }
  }

  function paintCleared() {
    optimisticRatingRef.current = null
    saveFailedRef.current = false
    if (mountedRef.current) {
      setIntentRating(null)
      setRatingSave(null)
    }
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
    const cardId = cardRef.current.id
    if (!baseline) {
      optimisticRatingRef.current = null
      if (mountedRef.current) {
        setIntentRating(null)
        setRatingSave(null)
      }
      rateBridgeRef.current.onBranchComplete(cardId, { cleared: true })
      return
    }
    const nextUnit = baseline.units.find((item) => item.id === cardRef.current.unit_id) ?? null
    sessionRef.current = baseline
    unitRef.current = nextUnit
    if (mountedRef.current) setSession(baseline)
    const previous = asUnitRating(nextUnit?.encounter?.selected_rating)
    optimisticRatingRef.current = previous
    if (mountedRef.current) {
      setIntentRating(previous)
      setRatingSave(null)
    }
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
    if (!currentUnit && !roundIdRef.current) return null
    const payload = {
      operation_id: ticket.operationId,
      expected_version: planVersionRef.current,
      intent_sequence: ticket.intentSequence ?? ticket.generation,
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
    const newerIntent = optimisticRatingRef.current != null
      && optimisticRatingRef.current !== ticket.rating
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
    // A newer tap can still be waiting in the serialized commit chain rather
    // than the mailbox. Keep this acknowledgement, but never overwrite that tap
    // or emit its advance callback before the newer request is saved.
    if (newerIntent) return
    const settledRating = asUnitRating(nextEncounter.selected_rating)
    optimisticRatingRef.current = settledRating
    saveFailedRef.current = false
    if (mountedRef.current) {
      setIntentRating(settledRating)
      setRatingSave(null)
    }
    rateBridgeRef.current.signalRating(unitResult.rating, unitResult.passed)
    if (mountedRef.current) revealUndo()
    rateBridgeRef.current.onRatingSettled?.(ticket.cardId, unitResult.passed, unitResult.rating, {
      occurrenceId: ticket.occurrenceId || ticket.cardId,
      encounterId: ticket.encounterId,
      planVersion: nextPlanVersion,
    })
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
      if (posted?.unitResult && !current) {
        const confirmed = confirmedSession(posted.unitResult, ticket)
        const confirmedUnit = confirmed?.units.find((item) => item.id === ticket.unitId)
        if (confirmed && confirmedUnit?.encounter) {
          // Preserve every acknowledgement as the saved baseline while a newer
          // selection remains local intent. Its eventual failure must not erase
          // the earlier successful save or turn it into the unsaved newer grade.
          sessionRef.current = confirmed
          unitRef.current = confirmedUnit
          if (mountedRef.current) setSession(confirmed)
          rememberOperation(posted.unitResult.operation_id)
          rateBridgeRef.current.onEncounterChange(
            ticket.cardId,
            encounterState(confirmed.id, confirmedUnit.revision, confirmedUnit.encounter),
          )
          rateBridgeRef.current.onBranchComplete(ticket.cardId, {
            restudy: !posted.unitResult.passed,
            rating: posted.unitResult.rating,
            retryAfterCards: posted.unitResult.retry_after_cards,
          })
          if (follow.send) baselinesRef.current.set(follow.send.generation, confirmed)
        }
      }
      if (follow.send && posted?.unitResult) {
        const revision = posted.unitResult.unit?.revision
        if (typeof revision === 'number') follow.send.unitRevision = revision
      }
      if (!posted?.unitResult) {
        if (current) markSaveFailed('评分没有保存：没有拿到后台的评分结果（页面没有这张卡的单元或回合，或后台把这次评分当作重复请求忽略了）', ticket.generation)
      } else if (current) {
        saveFailedRef.current = false
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
      if (current && !follow.undo) markSaveFailed(diagnostic, ticket.generation)
      baselinesRef.current.delete(ticket.generation)
      if (follow.send) await dispatchRating(follow.send)
    } finally {
      releaseEncounter()
    }
  }

  function markSaveFailed(detail: string | undefined, generation: number) {
    if (detail) recordSessionRecorderUiAction('error', '评分没有保存', detail)
    // An unsaved grade must not stay lit, nor keep the progress bar lit.
    rollbackRating(generation)
    saveFailedRef.current = false
    if (mountedRef.current) setActionError(RATING_SAVE_FAILED_COPY)
    rateBridgeRef.current.onSaveFailed(RATING_SAVE_FAILED_COPY)
  }

  function requestGlanceNow() {
    urgentGlanceRef.current = true
    if (glanceTimerRef.current != null) {
      window.clearTimeout(glanceTimerRef.current)
      glanceTimerRef.current = null
    }
    pendingGlanceRef.current = null
    setGlanceKick((value) => value + 1)
  }

  function paintLocalIntent(rating: UnitRating) {
    optimisticRatingRef.current = rating
    saveFailedRef.current = false
    if (mountedRef.current) {
      setRatingSave({ rating, status: 'saving' })
      setActionError(null)
    }
    // A tap is local intent, not a recorded practice result. Only the successful
    // response can update round counts, retry planning, palace completion, or
    // play the success feedback (see settleRating).
  }

  async function ensureAndDispatch(rating: UnitRating) {
    if (optimisticRatingRef.current !== rating) return
    const currentSession = sessionRef.current
    const currentUnit = currentSession?.units.find((item) => item.id === cardRef.current.unit_id) ?? unitRef.current
    const currentEncounter = currentUnit?.encounter ?? null
    let target: { encounterId: string; unitId: string; sessionId: string; unitRevision: number }
    if (currentSession && currentUnit && currentEncounter?.status === 'open') {
      target = {
        encounterId: currentEncounter.id,
        unitId: currentUnit.id,
        sessionId: currentSession.id,
        unitRevision: currentUnit.revision,
      }
    } else {
      // The map may still be loading. The server opens the glance for this
      // encounter inside the rating write, so the tap never waits on the load.
      const unitId = cardRef.current.unit_id
      const identity = unitId
        ? ensureEncounterRef.current(cardRef.current.id, effectiveRevision, true)
        : null
      if (!unitId || !identity?.encounterId) {
        markSaveFailed(`评分前没有拿到这张卡的复习记录（单元：${unitId || '无'}，卡片：${cardRef.current.id}，回合：${roundIdRef.current || '无'}）`, mailboxRef.current.latest + 1)
        return
      }
      requestGlanceNow()
      target = {
        encounterId: identity.encounterId,
        unitId,
        sessionId: identity.sessionId ?? '',
        unitRevision: identity.unitRevision,
      }
    }
    const generation = mailboxRef.current.latest + 1
    const inflightGeneration = mailboxRef.current.inflight?.generation
    const baseline = (inflightGeneration != null
      ? baselinesRef.current.get(inflightGeneration)
      : null) ?? currentSession
    if (baseline) baselinesRef.current.set(generation, baseline)
    const decision = acceptRating(mailboxRef.current, {
      rating,
      operationId: operationId(),
      intentSequence: generation,
      cardId: cardRef.current.id,
      occurrenceId: cardRef.current.occurrence_kind === 'retry' ? cardRef.current.id : '',
      ...target,
    })
    mailboxRef.current = decision.box
    if (decision.sendNow) await dispatchRating(decision.ticket)
  }

  function enqueueCommit(rating: UnitRating) {
    holdEncounter()
    commitHoldRef.current += 1
    const job = async () => {
      try {
        await ensureAndDispatch(rating)
      } finally {
        commitHoldRef.current = Math.max(0, commitHoldRef.current - 1)
        releaseEncounter()
      }
    }
    // An already-open glance must post in this turn. Chaining on a resolved
    // promise would defer the write until a microtask, after the tap returns.
    if (commitIdleRef.current) {
      commitIdleRef.current = false
      const run = job()
      commitChainRef.current = run.then(() => {
        commitIdleRef.current = true
      }, () => {
        commitIdleRef.current = true
      })
      return
    }
    const run = commitChainRef.current.then(job, job)
    commitChainRef.current = run.then(() => undefined, () => undefined)
  }

  async function rate(rating: UnitRating) {
    if (readOnly) {
      setActionError('历史记录为只读，不能评分。')
      return
    }
    const currentEncounter = unitRef.current?.encounter ?? null
    if (currentEncounter?.rating_editable === false) return
    const liveSelected = optimisticRatingRef.current ?? ratingOnThisAppearance(currentEncounter)
    if (liveSelected === rating && !saveFailedRef.current) {
      // The tap is not lit while it saves, so a repeat tap is not a "cancel".
      if (mailboxRef.current.inflight) return
      await undoRating({ clearAll: true })
      return
    }
    const recorded = asUnitRating(lastRating) ?? asUnitRating(encounterRef.current?.selectedRating)
    if (
      !saveFailedRef.current
      && optimisticRatingRef.current == null
      && ratingOnThisAppearance(currentEncounter) == null
      && recorded === rating
    ) {
      return
    }
    if (!cardRef.current.unit_id) {
      setActionError('这张卡不能评分。')
      return
    }
    paintLocalIntent(rating)
    enqueueCommit(rating)
  }

  const rateFromSheetRef = useRef(rate)
  rateFromSheetRef.current = rate
  const handledSheetRating = useRef('')
  useEffect(() => {
    if (!active || requestedRating == null) return
    const key = `${card.id}:${requestedRating}`
    if (handledSheetRating.current === key) return
    handledSheetRating.current = key
    onRequestedRatingHandled?.()
    void rateFromSheetRef.current(requestedRating)
  }, [active, card.id, onRequestedRatingHandled, requestedRating])

  async function undoRating(options?: { clearAll?: boolean }) {
    if (readOnly) {
      setActionError('历史记录为只读，不能撤销评分。')
      return
    }
    if (unitRef.current?.encounter?.rating_editable === false) return
    // The grade is still on the wire. Drop it locally now; the reply undoes
    // itself once the server returns an operation id.
    if (mailboxRef.current.inflight) {
      mailboxRef.current = requestUndo(mailboxRef.current)
      paintCleared()
      return
    }
    if (optimisticRatingRef.current != null && !lastOperationIdRef.current && !unitRef.current?.encounter?.effective_operation_id) {
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
      cardFeedback.playUndo(undoneRating as UnitRating | null)
      sessionRef.current = workingSession
      unitRef.current = workingUnit
      const undoneSelection = asUnitRating(lastResult.encounter.selected_rating)
      optimisticRatingRef.current = undoneSelection
      saveFailedRef.current = false
      if (mountedRef.current) {
        setIntentRating(undoneSelection)
        setRatingSave(null)
        setSession(workingSession)
      }
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
        void enqueueFreestyleSessionTask(() => closeCurrentEncounterRef.current())
      }
    }
  }

  const reviewReady = Boolean(editorState && session && unit && unit.encounter)
  const currentEncounter = unit?.encounter ?? null
  const appearanceRating = readOnly
    ? asUnitRating(currentEncounter?.selected_rating)
    : ratingOnThisAppearance(currentEncounter)
  const previousClosed = !readOnly
    && currentEncounter?.status === 'closed'
    && appearanceRating == null
    && asUnitRating(currentEncounter.selected_rating) != null
  // A failed save must not keep the tapped grade lit as chosen.
  const selectedRating = ratingSave?.status === 'failed' ? appearanceRating : intentRating ?? appearanceRating
  const recordedRating = appearanceRating != null || previousClosed
    ? null
    : asUnitRating(lastRating) ?? (encounter?.status === 'closed' ? null : asUnitRating(encounter?.selectedRating))
  const superseded = currentEncounter?.rating_editable === false
  const canRateWithoutPlan = !readOnly && !superseded && !recapOnly && Boolean(card.unit_id)
  const locked = readOnly || superseded
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

  const unitTypeHue = card.is_new === true ? 'var(--color-memory-new)' : 'var(--color-memory-medium)'
  const unitScored = encounter?.selectedRating != null

  return (
    <section ref={sectionRef} className="flex h-full min-h-0 flex-col" aria-label="永久标记复习单元">
      {/* One canvas. Title and rating float; a second paper sheet must not show under the map. */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.4rem] border border-stage-line-strong bg-[var(--memory-anki-mindmap-canvas)] shadow-[inset_0_1px_0_color-mix(in_srgb,white_90%,transparent),0_24px_60px_-18px_color-mix(in_srgb,black_65%,transparent)] sm:rounded-3xl">
        {/* Type channel: blue for a first study, amber for a review. Completion is opacity: rated = solid, not rated = faint. */}
        <span
          aria-hidden
          data-testid="freestyle-unit-type-strip"
          data-unit-type={card.is_new === true ? 'new' : 'review'}
          data-unit-done={unitScored ? 'true' : 'false'}
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-1"
          style={{ backgroundColor: unitTypeHue, opacity: unitScored ? 1 : 0.35 }}
        />
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
            className="fs-unit-arrive flex min-h-0 flex-1 flex-col"
          >
          <FreestyleUnitReviewFlipPanel
            key={`${card.id}:${flipIdentity.generation}`}
            card={card}
            session={flipSource.session}
            unit={flipSource.unit}
            editorState={flipSource.editorState}
            active={active && flipSource.live}
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
            roundId={flipSource.live ? roundId : null}
            syncedRevealMap={flipSource.live ? liveRevealMap : null}
            onRevealMapChange={flipSource.live ? onLiveRevealMapChange : undefined}
            // 做题 is the round overlay, not this card's glance. A preview map is
            // already on screen while the score session is still opening; hiding
            // the button until that write finishes is what made 做题 look gone.
            onOpenScopeQuiz={active ? onOpenScopeQuiz : undefined}
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
            onRebuildRound={() => {
              setLoadErrorTitle('正在整理这一轮')
              setLoadErrorHint('整理好就换到下一张能学的。')
              if (isPermanentUnitAbsence(lastLoadErrorRef.current)) {
                onStaleDrop(card.id, { force: true })
              }
              onRebuildRound?.()
            }}
            onRecapOnly={() => {
              setRecapOnly(true)
              setLoadError(null)
              setActionError(null)
            }}
          />
        )}

        {active && !flipSource && onOpenScopeQuiz ? (
          <div className="flex justify-end px-3 pt-2">
            <button
              type="button"
              data-testid="freestyle-quiz-while-opening"
              className="ma-pressable rounded-full border border-stage-line bg-stage-overlay px-3 py-1 text-xs font-medium text-stage-ink"
              onClick={onOpenScopeQuiz}
            >
              做题
            </button>
          </div>
        ) : null}

        {active && !inlineEditing && !recapOnly && (flipSource || !loadError || canRateWithoutPlan) ? (
          <FreestyleRatingBar
            ratingEffects={currentEncounter?.rating_effects ?? []}
            selectedRating={selectedRating}
            pendingRating={showSavingRating}
            failedRating={ratingSave?.status === 'failed' ? ratingSave.rating : null}
            recordedRating={recordedRating}
            retryAfterCards={retryAfterCards}
            busy={busy}
            locked={locked}
            reviewReady={reviewReady}
            hasEncounter={Boolean(currentEncounter)}
            canRateWithoutPlan={canRateWithoutPlan}
            actionError={actionError}
            blockedHint={blockedHint}
            disabledReason={superseded ? '已有后续练习，这次评分仅供回看；请到最近一次练习修改。' : null}
            assistantCopy={loadError}
            shortcutsActive={active && !inlineEditing}
            onRate={(rating) => void rate(rating)}
            onRemoveFromQueue={
              readOnly || !onRemoveFromQueue
                ? undefined
                : () => {
                    cardFeedback.playRemove()
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
