import { useEffect, useRef } from 'react'
import {
  isPassiveLiveStudyFollower,
  isPendingLiveStudyApply,
  isWeakerRevealMap,
  resolveFreestyleLiveFollowAction,
  shouldApplyLiveStudyView,
  shouldPublishLiveStudyView,
  useLiveStudyPresence,
} from '@/modules/session/public'
import type { QuizRuntimeState } from '@/modules/quiz/public'
import {
  decodeFreestyleLiveView,
  isApplicableLiveRating,
  isWeakerLiveRating,
  serializeFreestyleLiveView,
  type FreestyleLiveRating,
  type FreestyleLiveView,
  type FreestyleLiveViewport,
} from '@/modules/practice/ui/freestyle/model/freestyleLiveView'

export function useFreestyleLiveMirror({
  route,
  palaceId,
  currentCardId,
  currentIndex,
  visualIndex,
  viewingCompleteSlot,
  roundId,
  planVersion,
  queueCardIds,
  roundComplete,
  questionId,
  questionState,
  revealMap,
  rating,
  applyViewport,
  requestRoundSync,
  applyQuestionState,
  applyRevealMap,
  applyRating,
  isActive = true,
}: {
  route: string
  palaceId: number | null
  currentCardId: string | null
  currentIndex: number
  visualIndex: number
  viewingCompleteSlot: boolean
  roundId: string
  planVersion: number
  queueCardIds: string[]
  roundComplete: boolean
  questionId: number | null
  questionState: QuizRuntimeState | undefined
  revealMap: Record<string, string> | null
  rating: FreestyleLiveRating | null
  applyViewport: (viewport: FreestyleLiveViewport) => boolean
  requestRoundSync?: (view: FreestyleLiveView) => void
  applyQuestionState: (questionId: number, state: QuizRuntimeState) => void
  applyRevealMap: (revealMap: Record<string, string> | null) => void
  applyRating: (rating: FreestyleLiveRating) => void
  isActive?: boolean
}) {
  const presence = useLiveStudyPresence()
  const skipUntilCardIdRef = useRef<string | null>(null)
  const lastSentRef = useRef('')
  const lastAppliedRevisionRef = useRef(-1)
  const pendingApplyRef = useRef(false)
  const pendingRemoteRevisionRef = useRef<number | null>(null)
  const appliedRemoteRatingRevisionRef = useRef<number | null>(null)
  const appliedRemoteDetailsRevisionRef = useRef<number | null>(null)
  const syncRequestedRevisionRef = useRef<number | null>(null)
  useEffect(() => {
    if (!presence || !isActive) return
    if (presence.projection.surface !== 'freestyle') return
    if (presence.projection.route !== route) return
    const decoded = decodeFreestyleLiveView(presence.projection.view)
    if (!decoded) return
    const viewJson = serializeFreestyleLiveView(decoded)
    const applyDecision = shouldApplyLiveStudyView({
      revision: presence.projection.revision,
      lastAppliedRevision: lastAppliedRevisionRef.current,
      viewJson,
      lastAppliedViewJson: lastSentRef.current,
    })
    const remoteRevision = presence.projection.revision
    const applyRemoteRating = () => {
      if (appliedRemoteRatingRevisionRef.current === remoteRevision) return
      if (!decoded.rating || !isWeakerLiveRating(rating, decoded.rating)) {
        appliedRemoteRatingRevisionRef.current = remoteRevision
        return
      }
      if (!isApplicableLiveRating(decoded.rating, queueCardIds)) return
      applyRating(decoded.rating)
      appliedRemoteRatingRevisionRef.current = remoteRevision
    }
    const applyRemoteDetails = () => {
      if (appliedRemoteDetailsRevisionRef.current === remoteRevision) return
      if (decoded.questionState) {
        applyQuestionState(decoded.questionState.questionId, decoded.questionState.state)
      }
      if (decoded.revealMap && !isWeakerRevealMap(decoded.revealMap, revealMap)) {
        applyRevealMap(decoded.revealMap)
      }
      applyRemoteRating()
      appliedRemoteDetailsRevisionRef.current = remoteRevision
    }
    const followAction = resolveFreestyleLiveFollowAction({
      applyDecision,
      remoteCardId: decoded.currentCardId,
      localCardId: currentCardId,
      queueCardIds,
    })
    if (followAction === 'skip') return
    if (followAction === 'wait-queue') {
      if (!decoded.roundId || decoded.roundId === roundId) applyRemoteRating()
      pendingRemoteRevisionRef.current = presence.projection.revision
      skipUntilCardIdRef.current = decoded.currentCardId
      if (requestRoundSync && syncRequestedRevisionRef.current !== presence.projection.revision) {
        syncRequestedRevisionRef.current = presence.projection.revision
        requestRoundSync(decoded)
      }
      return
    }
    if (followAction === 'abandon') {
      if (decoded.roundId && decoded.roundId !== roundId) {
        pendingRemoteRevisionRef.current = presence.projection.revision
        skipUntilCardIdRef.current = decoded.currentCardId
        if (requestRoundSync && syncRequestedRevisionRef.current !== presence.projection.revision) {
          syncRequestedRevisionRef.current = presence.projection.revision
          requestRoundSync(decoded)
        }
        return
      }
      pendingRemoteRevisionRef.current = null
      lastAppliedRevisionRef.current = presence.projection.revision
      skipUntilCardIdRef.current = null
      return
    }
    if (followAction === 'consume-revision') {
      lastAppliedRevisionRef.current = presence.projection.revision
      return
    }
    if (!applyViewport({
      currentCardId: decoded.currentCardId,
      visualIndex: decoded.visualIndex,
      viewingCompleteSlot: decoded.viewingCompleteSlot,
      roundId: decoded.roundId,
      planVersion: decoded.planVersion,
    })) {
      if (!decoded.roundId || decoded.roundId === roundId) applyRemoteRating()
      pendingRemoteRevisionRef.current = presence.projection.revision
      skipUntilCardIdRef.current = decoded.currentCardId
      return
    }
    pendingRemoteRevisionRef.current = null
    lastAppliedRevisionRef.current = presence.projection.revision
    lastSentRef.current = viewJson
    const viewportChanged = decoded.currentCardId !== currentCardId
      || decoded.visualIndex !== visualIndex
      || decoded.viewingCompleteSlot !== viewingCompleteSlot
      || decoded.roundId !== roundId
      || decoded.planVersion !== planVersion
    const detailsChanged = Boolean(
      decoded.questionState
      || (decoded.revealMap && !isWeakerRevealMap(decoded.revealMap, revealMap))
      || (decoded.rating && isWeakerLiveRating(rating, decoded.rating)),
    )
    pendingApplyRef.current = viewportChanged || detailsChanged
    skipUntilCardIdRef.current = decoded.currentCardId
    applyRemoteDetails()
  }, [
    applyQuestionState,
    applyRating,
    applyRevealMap,
    currentCardId,
    presence,
    queueCardIds,
    rating,
    planVersion,
    visualIndex,
    viewingCompleteSlot,
    revealMap,
    applyViewport,
    isActive,
    route,
    roundId,
    requestRoundSync,
  ])

  useEffect(() => {
    if (!presence) return
    if (pendingRemoteRevisionRef.current === presence.projection.revision) return
    if (skipUntilCardIdRef.current && currentCardId !== skipUntilCardIdRef.current) return
    skipUntilCardIdRef.current = null
    const view: FreestyleLiveView = {
      palaceId,
      currentCardId,
      currentIndex,
      visualIndex,
      viewingCompleteSlot,
      queueCardIds,
      questionState: questionId != null && questionState
        ? { questionId, state: questionState }
        : null,
      revealMap,
      roundComplete,
      rating,
      roundId,
      planVersion,
    }
    const serialized = serializeFreestyleLiveView(view)
    const isFollower = isPassiveLiveStudyFollower({
      isController: presence.isController,
      controllerClientId: presence.projection.controllerClientId,
      remoteSurface: presence.projection.surface,
      localSurface: 'freestyle',
    })
    const previous = lastSentRef.current
      ? decodeFreestyleLiveView(JSON.parse(lastSentRef.current) as unknown)
      : null
    const interactionUnchanged = Boolean(
      previous
      && previous.currentCardId === view.currentCardId
      && previous.roundComplete === view.roundComplete
      && previous.visualIndex === view.visualIndex
      && previous.viewingCompleteSlot === view.viewingCompleteSlot
      && previous.roundId === view.roundId
      && previous.planVersion === view.planVersion
      && JSON.stringify(previous.questionState) === JSON.stringify(view.questionState)
      && JSON.stringify(previous.revealMap) === JSON.stringify(view.revealMap)
      && JSON.stringify(previous.rating) === JSON.stringify(view.rating),
    )
    const pendingApply = isPendingLiveStudyApply({
      applyCommitted: pendingApplyRef.current,
      serialized,
      lastSent: lastSentRef.current,
      interactionUnchanged,
    })
    if (!pendingApply) pendingApplyRef.current = false
    const remoteView = presence.projection.surface === 'freestyle'
      ? decodeFreestyleLiveView(presence.projection.view)
      : null
    if (!shouldPublishLiveStudyView({
      isActive,
      publishWhen: true,
      serialized,
      lastSent: lastSentRef.current,
      isFollower,
      interactionUnchanged,
      pendingApply,
      hydrated: presence.connected,
      weakerThanRemote: isWeakerRevealMap(view.revealMap, remoteView?.revealMap)
        || isWeakerLiveRating(view.rating, remoteView?.rating),
    })) return
    lastSentRef.current = serialized
    presence.publish({
      takeControl: false,
      surface: 'freestyle',
      route,
      view,
    })
  }, [
    currentCardId,
    currentIndex,
    isActive,
    palaceId,
    presence,
    questionId,
    questionState,
    queueCardIds,
    rating,
    revealMap,
    roundComplete,
    route,
    visualIndex,
    viewingCompleteSlot,
    roundId,
    planVersion,
  ])
}
