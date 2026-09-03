import { useEffect, useRef } from 'react'
import {
  isPendingLiveStudyApply,
  shouldApplyLiveStudyView,
  shouldPublishLiveStudyView,
  useLiveStudyPresence,
} from '@/modules/session/public'
import type { QuizRuntimeState } from '@/modules/quiz/public'
import {
  decodeFreestyleLiveView,
  serializeFreestyleLiveView,
  type FreestyleAnkiFlipLiveState,
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
  seekCardId,
  applyQuestionState,
  applyAnkiFlip,
  applyRevealMap,
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
  seekCardId: (cardId: string) => void
  applyQuestionState: (questionId: number, state: QuizRuntimeState) => void
  applyAnkiFlip: (flip: FreestyleAnkiFlipLiveState | null) => void
  applyRevealMap: (revealMap: Record<string, string> | null) => void
  isActive?: boolean
}) {
  const presence = useLiveStudyPresence()
  const skipUntilCardIdRef = useRef<string | null>(null)
  const lastSentRef = useRef('')
  const lastAppliedRevisionRef = useRef(-1)
  const pendingApplyRef = useRef(false)
  const currentCardIdRef = useRef(currentCardId)
  currentCardIdRef.current = currentCardId
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
    if (applyDecision === 'skip') return
    lastAppliedRevisionRef.current = presence.projection.revision
    if (applyDecision === 'consume-revision') return
    lastSentRef.current = viewJson
    pendingApplyRef.current = true
    skipUntilCardIdRef.current = decoded.currentCardId
    if (decoded.currentCardId && decoded.currentCardId !== currentCardIdRef.current) {
      seekCardId(decoded.currentCardId)
    }
    if (decoded.questionState) {
      applyQuestionState(decoded.questionState.questionId, decoded.questionState.state)
    }
    applyAnkiFlip(decoded.flip)
    applyRevealMap(decoded.revealMap)
  }, [applyAnkiFlip, applyQuestionState, applyRevealMap, presence, seekCardId])

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
    }
    const serialized = serializeFreestyleLiveView(view)
    const isFollower = Boolean(presence.projection.controllerClientId && !presence.isController)
    const previous = lastSentRef.current
      ? decodeFreestyleLiveView(JSON.parse(lastSentRef.current) as unknown)
      : null
    const interactionUnchanged = Boolean(
      previous
      && previous.currentCardId === view.currentCardId
      && previous.roundComplete === view.roundComplete
      && JSON.stringify(previous.flip) === JSON.stringify(view.flip)
      && JSON.stringify(previous.questionState) === JSON.stringify(view.questionState)
      && JSON.stringify(previous.revealMap) === JSON.stringify(view.revealMap),
    )
    const pendingApply = isPendingLiveStudyApply({
      applyCommitted: pendingApplyRef.current,
      serialized,
      lastSent: lastSentRef.current,
      interactionUnchanged,
    })
    if (!pendingApply) pendingApplyRef.current = false
    if (!shouldPublishLiveStudyView({
      isActive,
      publishWhen: true,
      serialized,
      lastSent: lastSentRef.current,
      isFollower,
      interactionUnchanged,
      pendingApply,
    })) return
    lastSentRef.current = serialized
    presence.publish({
      takeControl: true,
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
    revealMap,
    roundComplete,
    route,
  ])
}
