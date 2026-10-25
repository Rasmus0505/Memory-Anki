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
  type FreestyleFlipMode,
  type FreestyleRatingScope,
  type FreestyleUnitEncounterState,
  type ReviewUnitDto,
  type UnitRating,
  type UnitReviewSessionDto,
} from '@/modules/practice/public'
import {
  ratingPassed,
  type RatingSaveEvent,
  type RatingTarget,
} from '@/modules/practice/ui/freestyle/model/ratingSaveStore'
import { freestyleRatingSaves } from '@/modules/practice/ui/freestyle/model/ratingSaveRuntime'
import {
  useRatingSaveEntry,
  useRatingSaveEvents,
} from '@/modules/practice/ui/freestyle/hooks/useFreestyleRatingSaves'
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
  findSuccessorUnit,
  isPermanentUnitAbsence,
  isStaleUnitError,
} from '@/modules/practice/ui/freestyle/model/freestyleStaleRecovery'
import { freestyleUnitLoadFailureCopy } from '@/modules/practice/ui/freestyle/model/freestyleUnitLoadRecovery'
import { FreestyleRatingBar } from './FreestyleRatingBar'
import { FreestyleBedtimeRatingBar } from './FreestyleBedtimeRatingBar'
import { SUPERSEDED_RATING_COPY } from '@/modules/practice/ui/freestyle/model/freestyleRatingCopy'
import { useFreestyleCardFeedback } from './useFreestyleCardFeedback'
import { FreestyleUnitReviewFlipPanel } from './FreestyleUnitReviewFlipPanel'
import { FreestyleUnitReviewIdentityRow, FreestyleUnitReviewPlaceholder } from './FreestyleUnitReviewChrome'

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
  onStaleDrop,
  onRemoveFromQueue,
  onRemovePermanently,
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
  ratingScope: _ratingScope = 'unit',
  onRatingScopeChange: _onRatingScopeChange,
  palaceTarget: _palaceTarget = null,
  liveRevealMap = null,
  onLiveRevealMapChange,
  planVersion = 0,
  onOpenScopeQuiz,
  lastRating = null,
  onBedtimeRate,
}: {
  card: FreestyleReviewUnitCard
  active: boolean
  /** Adjacent to the viewport: may draw its read-only preview before activation. */
  nearViewport?: boolean
  readOnly: boolean
  roundId: string
  planVersion?: number
  onOpenScopeQuiz?: () => void
  encounter?: FreestyleUnitEncounterState
  /** This-round last rating, shown while the amend glance is still empty. */
  lastRating?: number | null
  retryAfterCards: number
  /** Why 「下一组」 is blocked, shown inline instead of a toast. */
  blockedHint?: string | null
  onEnsureEncounter: (
    cardId: string,
    unitRevision: number,
    allowRenew: boolean,
  ) => FreestyleUnitEncounterState
  onEncounterChange: (cardId: string, encounter: FreestyleUnitEncounterState) => void
  onStaleDrop: (cardId: string, options?: { force?: boolean }) => void
  /** Drop this card from the current round. Does not write a review rating. */
  onRemoveFromQueue?: (cardId: string) => void
  /** Stop scheduling this card's unit for good, and drop the card from this round. */
  onRemovePermanently?: (cardId: string, unitId: string) => void
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
  liveRevealMap?: Record<string, string> | null
  onLiveRevealMapChange?: (revealMap: Record<string, string>) => void
  /**
   * 睡前复习: record a plan-only grade for an already-rated card. Never opens a
   * Reviews encounter and never reschedules.
   */
  onBedtimeRate?: (cardId: string, rating: UnitRating) => Promise<unknown>
}) {
  const [session, setSession] = useState<UnitReviewSessionDto | null>(null)
  const [savedEditorState, setSavedEditorState] = useState<MindMapEditorState | null>(null)
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
  const [bedtimeBusy, setBedtimeBusy] = useState(false)
  const [bedtimeError, setBedtimeError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  /** Undo surfaces only right after a rate, then collapses to give the map the room. */
  const [undoVisible, setUndoVisible] = useState(false)
  const undoTimerRef = useRef<number | null>(null)
  const activeRef = useRef(active)
  const mountedRef = useRef(true)
  const urgentGlanceRef = useRef(false)
  // Saves live in the round-scoped rating outbox, not in this component: leaving
  // the card, the page or the module does not cancel them. A tapped grade lights
  // at once while its save is on the wire (quiet 保存中 hint); a failure shows
  // 未保存 with one-tap retry and is no longer lit.
  const ratingStore = freestyleRatingSaves()
  const saveEntry = useRatingSaveEntry(roundId, card.id)
  const [intentRating, setIntentRating] = useState<UnitRating | null>(null)
  const [glanceKick, setGlanceKick] = useState(0)
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
  planVersionRef.current = planVersion
  roundIdRef.current = roundId
  lastOperationIdRef.current = lastOperationId
  // A render can land before setSession flushes. Do not wipe the glance a
  // score still on the wire belongs to; leave-close needs it.
  if (session || !ratingStore.isBusy(roundId, card.id)) {
    sessionRef.current = session
    unitRef.current = session?.units.find((item) => item.id === card.unit_id) ?? null
  }
  const unit = unitRef.current
  const { breath, signalRating, clearBreath } = useFreestyleFlowFeedback()
  const rateBridgeRef = useRef({
    onEncounterChange,
    onStaleDrop,
    onSaveFailed,
    signalRating,
  })
  rateBridgeRef.current = {
    onEncounterChange,
    onStaleDrop,
    onSaveFailed,
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

  const closeCurrentEncounter = useCallback(function closeEncounter(): Promise<unknown> {
    // A rate or clear still references this encounter. Leave-close waits until
    // the outbox settles it, unless the learner came back to the card meanwhile.
    const ownerRoundId = roundIdRef.current
    const ownerCardId = cardRef.current.id
    const outbox = freestyleRatingSaves()
    if (outbox.isBusy(ownerRoundId, ownerCardId)) {
      // Do not hold the session lane while the save is on the wire.
      void outbox.whenIdle(ownerRoundId, ownerCardId).then(() => {
        if (activeRef.current && mountedRef.current) return
        void enqueueFreestyleSessionTask(closeEncounter)
      })
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

    // An acknowledgement that landed after this card unmounted never reached the
    // local session; the outbox still knows the glance is rated.
    const stored = outbox.getEntry(ownerRoundId, ownerCardId)
    const ratedInOutbox = stored?.ackedRating != null && stored.target?.encounterId === currentEncounter.id
    // Unrated leave must cancel the glance. Leaving the open encounter alive made
    // the later pass bill wall clock from first scroll-past (parallel palace rows).
    if (currentEncounter.selected_rating == null && !ratedInOutbox) {
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
    if (!active) return
    if (recapOnly) return
    // 睡前复习 cards are already rated today. They render from the read-only
    // preview and are scored through the plan-only endpoint; opening a Reviews
    // glance would create an encounter and invite a scheduling write.
    if (liveCard.bedtime) return
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
            // A score is still on the wire for this glance: keep it so leave-close
            // can lock it once the outbox settles.
            if (freestyleRatingSaves().isBusy(roundId, liveCard.id) && nextUnit?.encounter) {
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
          const sameUnit = value.units.find((item) => item.id === liveCard.unit_id)
          const nextUnit = sameUnit ?? findSuccessorUnit(value.units, liveCard.unit_id, liveCard.anchor_uid)
          const decision = decideLoadedUnitSession({
            cardUnitId: nextUnit ? nextUnit.id : liveCard.unit_id,
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
      if (glanceTimerRef.current != null) {
        window.clearTimeout(glanceTimerRef.current)
        glanceTimerRef.current = null
      }
      // A save still on the wire keeps going in the outbox; close waits for it.
      void enqueueFreestyleSessionTask(() => closeCurrentEncounterRef.current())
    }
  }, [])

  function rememberOperation(id: string | null) {
    lastOperationIdRef.current = id
    if (mountedRef.current) setLastOperationId(id)
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

  /**
   * Local view of an acknowledged rating. Round progress (completion, retry
   * insertion, the rail) is the page ledger's job and happens even when this
   * card is not mounted.
   */
  function adoptAcknowledgedRating(event: Extract<RatingSaveEvent, { type: 'acked' }>) {
    const { item, target, job } = event
    const currentSession = sessionRef.current
    const currentUnit = unitRef.current
    const currentEncounter = currentUnit?.encounter
    if (item && currentSession && currentUnit && currentEncounter && currentUnit.id === target.unitId) {
      const nextEncounter = adoptRatedEncounter(currentEncounter, item.encounter)
      const nextUnit: ReviewUnitDto = {
        ...currentUnit,
        ...item.unit,
        title: item.unit.title || currentUnit.title,
        session_status: item.session_status,
        final_rating: item.rating,
        encounter: nextEncounter,
      }
      const nextSessionId = item.study_session_id || target.sessionId || currentSession.id
      const nextSession = updateSessionUnit(
        currentSession.id === nextSessionId ? currentSession : { ...currentSession, id: nextSessionId },
        nextUnit,
      )
      sessionRef.current = nextSession
      unitRef.current = nextUnit
      setSession(nextSession)
    }
    // A superseded acknowledgement is only the saved baseline; the newer tap owns the bar.
    if (!event.current) return
    const rating = asUnitRating(item?.rating) ?? job.rating
    const passed = item?.passed ?? ratingPassed(rating)
    rememberOperation(item?.operation_id || job.operationId)
    setIntentRating(rating)
    setActionError(null)
    rateBridgeRef.current.signalRating(rating, passed)
    if (activeRef.current) revealUndo()
  }

  function adoptUndoneRating(event: Extract<RatingSaveEvent, { type: 'undone' }>) {
    const { result } = event
    const currentSession = sessionRef.current
    const currentUnit = unitRef.current
    if (currentSession && currentUnit) {
      const nextUnit: ReviewUnitDto = {
        ...currentUnit,
        ...result.unit,
        title: result.unit.title || currentUnit.title,
        session_status: result.session_status,
        final_rating: result.encounter.selected_rating,
        encounter: result.encounter,
      }
      const nextSession = updateSessionUnit(currentSession, nextUnit)
      sessionRef.current = nextSession
      unitRef.current = nextUnit
      setSession(nextSession)
    }
    cardFeedback.playUndo(event.undoneRating)
    const remaining = asUnitRating(result.encounter.selected_rating)
    setIntentRating(remaining)
    setActionError(null)
    rememberOperation(result.encounter.effective_operation_id)
    if (remaining == null) {
      if (undoTimerRef.current != null) {
        window.clearTimeout(undoTimerRef.current)
        undoTimerRef.current = null
      }
      setUndoVisible(false)
    }
  }

  useRatingSaveEvents((event) => {
    if (event.roundId !== roundIdRef.current || event.cardId !== cardRef.current.id) return
    if (event.type === 'acked') {
      adoptAcknowledgedRating(event)
    } else if (event.type === 'undone') {
      adoptUndoneRating(event)
    } else if (event.type === 'undoFailed') {
      setActionError(formatUnitDiagnostic({
        error: event.error,
        card: cardRef.current,
        roundId: roundIdRef.current,
        operationId: event.operationId,
        stage: '取消评分',
      }))
    } else if (event.type === 'failed' && event.current && event.failure === 'stale') {
      const diagnostic = formatUnitDiagnostic({
        error: event.error,
        card: cardRef.current,
        roundId: roundIdRef.current,
        operationId: event.job.operationId,
        stage: '评分后卡片已过期',
      })
      setActionError(`${diagnostic}\n已检测到内容版本变化，正在自动更新复习安排。`)
    }
  })

  /** The glance this tap names: the open live one, or the queue encounter the server opens inside the write. */
  function ratingTarget(): RatingTarget | null {
    const liveCard = cardRef.current
    const currentSession = sessionRef.current
    const currentUnit = currentSession?.units.find((item) => item.id === liveCard.unit_id) ?? unitRef.current
    const currentEncounter = currentUnit?.encounter ?? null
    if (currentSession && currentUnit && currentEncounter?.status === 'open') {
      return {
        encounterId: currentEncounter.id,
        unitId: currentUnit.id,
        sessionId: currentSession.id,
        unitRevision: currentUnit.revision,
      }
    }
    const unitId = liveCard.unit_id
    const identity = unitId ? ensureEncounterRef.current(liveCard.id, effectiveRevision, true) : null
    if (!unitId || !identity?.encounterId) return null
    // The map may still be loading. The server opens the glance for this
    // encounter inside the rating write, so the tap never waits on the load.
    requestGlanceNow()
    return {
      encounterId: identity.encounterId,
      unitId,
      sessionId: identity.sessionId ?? '',
      unitRevision: identity.unitRevision,
    }
  }

  function submitRating(rating: UnitRating) {
    const liveCard = cardRef.current
    const target = ratingTarget()
    if (!target) {
      setActionError(`评分前没有拿到这张卡的复习记录（单元：${liveCard.unit_id || '无'}，卡片：${liveCard.id}，回合：${roundIdRef.current || '无'}）`)
      return
    }
    setActionError(null)
    ratingStore.submit({
      roundId: roundIdRef.current,
      cardId: liveCard.id,
      occurrenceId: liveCard.occurrence_kind === 'retry' ? liveCard.id : '',
      rating,
      planVersion: planVersionRef.current,
      target,
    })
  }

  function rate(rating: UnitRating) {
    if (readOnly) {
      setActionError('历史记录为只读，不能评分。')
      return
    }
    if (unitRef.current?.encounter?.rating_editable === false) {
      setActionError(SUPERSEDED_RATING_COPY)
      return
    }
    if (!cardRef.current.unit_id) {
      setActionError('这张卡不能评分。')
      return
    }
    const entry = ratingStore.getEntry(roundIdRef.current, cardRef.current.id)
    const confirmed = intentRating ?? ratingOnThisAppearance(unitRef.current?.encounter ?? null)
    // Tapping the acknowledged grade again clears it. A 未保存 grade retries
    // instead, and a pending tap is never a "cancel" because it is not lit.
    if (
      entry?.status !== 'failed'
      && entry?.status !== 'saving'
      && confirmed === rating
    ) {
      undoRating({ clearAll: true })
      return
    }
    submitRating(rating)
  }

  function undoRating(options?: { clearAll?: boolean }) {
    if (readOnly) {
      setActionError('历史记录为只读，不能撤销评分。')
      return
    }
    if (unitRef.current?.encounter?.rating_editable === false) {
      setActionError(SUPERSEDED_RATING_COPY)
      return
    }
    const accepted = ratingStore.requestUndo({
      roundId: roundIdRef.current,
      cardId: cardRef.current.id,
      operationId: lastOperationIdRef.current ?? unitRef.current?.encounter?.effective_operation_id ?? null,
      clearAll: Boolean(options?.clearAll),
    })
    setActionError(accepted ? null : '暂无可撤销的评分。')
  }

  const handleBedtimeRate = useCallback(
    async (rating: UnitRating) => {
      if (!onBedtimeRate || bedtimeBusy) return
      setBedtimeError(null)
      setBedtimeBusy(true)
      try {
        await onBedtimeRate(cardRef.current.id, rating)
        signalRating(rating, true)
      } catch (error) {
        setBedtimeError(error instanceof Error ? error.message : '睡前复习评分没有保存')
      } finally {
        setBedtimeBusy(false)
      }
    },
    [bedtimeBusy, onBedtimeRate, signalRating],
  )

  const reviewReady = Boolean(editorState && session && unit && unit.encounter)
  const currentEncounter = unit?.encounter ?? null
  const appearanceRating = readOnly
    ? asUnitRating(currentEncounter?.selected_rating)
    : ratingOnThisAppearance(currentEncounter)
  const previousClosed = !readOnly
    && currentEncounter?.status === 'closed'
    && appearanceRating == null
    && asUnitRating(currentEncounter.selected_rating) != null
  // Light the tap at once: a grade on the wire is shown as chosen right away (local-first).
  // A failed save drops back to 未保存 and is no longer lit.
  const pendingRating = saveEntry?.status === 'saving' && saveEntry.pendingKind === 'rate' ? saveEntry.rating : null
  const selectedRating = pendingRating ?? intentRating ?? appearanceRating
  const pendingClear = saveEntry?.status === 'saving' && saveEntry.pendingKind === 'undo'
  const failedRating = saveEntry?.status === 'failed' ? saveEntry.rating : null
  const failedFailure = saveEntry?.status === 'failed' ? saveEntry.failure : null
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

  // The sheet reads toolbar → title → map. A live map owns the top edge, so the
  // title row is handed to the panel and drawn under the toolbar; the loading
  // placeholder has no toolbar, so it keeps the row at the top of the sheet.
  const identityRow = (
    <FreestyleUnitReviewIdentityRow
      titleText={titleText}
      phase={card.phase}
      flipTone={flipTone}
      flipLabel={flipLabel}
      flipTitle={flipTitle}
      showUndo={Boolean(undoVisible && lastOperationId && !locked)}
      undoDisabled={pendingClear}
      onUndo={() => undoRating()}
    />
  )

  return (
    <section ref={sectionRef} className="flex h-full min-h-0 flex-col" aria-label="永久标记复习单元">
      {/* One sheet. The map toolbar owns its top edge, the unit title row sits under
          the toolbar, and the rating dock floats over the bottom. A second paper
          sheet must not show under the map. */}
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
        {flipSource ? null : identityRow}
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
            active={active && (flipSource.live || Boolean(card.bedtime))}
            reviewOnly={Boolean(card.bedtime)}
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
            belowToolbarSlot={identityRow}
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

        {active && !inlineEditing && !recapOnly && card.bedtime ? (
          <FreestyleBedtimeRatingBar
            selectedRating={asUnitRating(lastRating)}
            busy={bedtimeBusy}
            error={bedtimeError}
            onRate={handleBedtimeRate}
            onDismissError={() => setBedtimeError(null)}
          />
        ) : active && !inlineEditing && !recapOnly && (flipSource || !loadError || canRateWithoutPlan) ? (
          <FreestyleRatingBar
            ratingEffects={currentEncounter?.rating_effects ?? []}
            selectedRating={selectedRating}
            pendingRating={pendingRating}
            pendingClear={pendingClear}
            failedRating={failedRating}
            failedFailure={failedFailure}
            recordedRating={recordedRating}
            retryAfterCards={retryAfterCards}
            busy={false}
            locked={locked}
            reviewReady={reviewReady}
            hasEncounter={Boolean(currentEncounter)}
            canRateWithoutPlan={canRateWithoutPlan}
            actionError={actionError}
            blockedHint={blockedHint}
            disabledReason={superseded ? SUPERSEDED_RATING_COPY : null}
            assistantCopy={loadError}
            shortcutsActive={active && !inlineEditing}
            onRate={rate}
            onRemoveFromQueue={
              readOnly || !onRemoveFromQueue
                ? undefined
                : () => {
                    cardFeedback.playRemove()
                    onRemoveFromQueue(card.id)
                  }
            }
            onRemovePermanently={
              readOnly || !onRemovePermanently
                ? undefined
                : () => {
                    cardFeedback.playRemove()
                    onRemovePermanently(card.id, card.unit_id)
                  }
            }
            onDismissError={() => setActionError(null)}
          />
        ) : null}
      </div>
    </section>
  )
}
