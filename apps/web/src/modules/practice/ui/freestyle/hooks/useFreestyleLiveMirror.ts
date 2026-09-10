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
  isWeakerLiveRating,
  serializeFreestyleLiveView,
  type FreestyleAnkiFlipLiveState,
  type FreestyleLiveRating,
  type FreestyleLiveView,
} from '@/modules/practice/ui/freestyle/model/freestyleLiveView'

export function useFreestyleLiveMirror({
  route,
  palaceId,
  currentCardId,
  currentIndex,
  queueCardIds,
  roundComplete,
  questionId,
  questionState,
  ankiFlip,
  revealMap,
  rating,
  seekCardId,
  applyQuestionState,
  applyAnkiFlip,
  applyRevealMap,
  applyRating,
  isActive = true,
}: {
  route: string
  palaceId: number | null
  currentCardId: string | null
  currentIndex: number
  queueCardIds: string[]
  roundComplete: boolean
  questionId: number | null
  questionState: QuizRuntimeState | undefined
  ankiFlip: FreestyleAnkiFlipLiveState | null
  revealMap: Record<string, string> | null
  rating: FreestyleLiveRating | null
  seekCardId: (cardId: string) => void
  applyQuestionState: (questionId: number, state: QuizRuntimeState) => void
  applyAnkiFlip: (flip: FreestyleAnkiFlipLiveState | null) => void
  applyRevealMap: (revealMap: Record<string, string> | null) => void
  applyRating: (rating: FreestyleLiveRating) => void
  isActive?: boolean
}) {
  const presence = useLiveStudyPresence()
  const skipUntilCardIdRef = useRef<string | null>(null)
  const lastSentRef = useRef('')
  const lastAppliedRevisionRef = useRef(-1)
  const pendingApplyRef = useRef(false)
  useEffect(() => {
    if (!presence || presence.isController) return
    if (presence.projection.surface !== 'freestyle') return
    const decoded = decodeFreestyleLiveView(presence.projection.view)
    if (!decoded) return
    const viewJson = serializeFreestyleLiveView(decoded)
    const applyDecision = shouldApplyLiveStudyView({
      revision: presence.projection.revision,
      lastAppliedRevision: lastAppliedRevisionRef.current,
      viewJson,
      lastAppliedViewJson: lastSentRef.current,
    })
    const followAction = resolveFreestyleLiveFollowAction({
      applyDecision,
      remoteCardId: decoded.currentCardId,
      localCardId: currentCardId,
      queueCardIds,
    })
    if (followAction === 'skip') return
    if (followAction === 'wait-queue') {
      skipUntilCardIdRef.current = decoded.currentCardId
      return
    }
    if (followAction === 'seek' && decoded.currentCardId) {
      skipUntilCardIdRef.current = decoded.currentCardId
      seekCardId(decoded.currentCardId)
      return
    }
    if (followAction === 'abandon') {
      lastAppliedRevisionRef.current = presence.projection.revision
      skipUntilCardIdRef.current = null
      return
    }
    lastAppliedRevisionRef.current = presence.projection.revision
    if (followAction === 'consume-revision') return
    lastSentRef.current = viewJson
    pendingApplyRef.current = true
    skipUntilCardIdRef.current = decoded.currentCardId
    if (decoded.questionState) {
      applyQuestionState(decoded.questionState.questionId, decoded.questionState.state)
    }
    applyAnkiFlip(decoded.flip)
    if (decoded.revealMap && !isWeakerRevealMap(decoded.revealMap, revealMap)) {
      applyRevealMap(decoded.revealMap)
    }
    if (decoded.rating && !isWeakerLiveRating(decoded.rating, rating)) {
      applyRating(decoded.rating)
    }
  }, [
    applyAnkiFlip,
    applyQuestionState,
    applyRating,
    applyRevealMap,
    currentCardId,
    presence,
    queueCardIds,
    rating,
    revealMap,
    seekCardId,
  ])

  useEffect(() => {
    if (!presence) return
    if (skipUntilCardIdRef.current && currentCardId !== skipUntilCardIdRef.current) return
    skipUntilCardIdRef.current = null
    const view: FreestyleLiveView = {
      palaceId,
      currentCardId,
      currentIndex,
      queueCardIds,
      flip: ankiFlip,
      questionState: questionId != null && questionState
        ? { questionId, state: questionState }
        : null,
      revealMap,
      roundComplete,
      rating,
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
      && JSON.stringify(previous.flip) === JSON.stringify(view.flip)
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
    ankiFlip,
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
  ])
}
