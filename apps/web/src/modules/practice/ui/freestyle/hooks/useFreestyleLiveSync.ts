import { useCallback, useMemo, useRef, useState } from 'react'
import type { useImmersiveQueue } from '@/modules/practice/ui/freestyle/hooks/useImmersiveQueue'
import type { useFreestyleQuizFlow } from '@/modules/practice/ui/freestyle/hooks/useFreestyleQuizFlow'
import { useFreestyleLiveMirror } from '@/modules/practice/ui/freestyle/hooks/useFreestyleLiveMirror'
import type { FreestyleLiveRating, FreestyleLiveView } from '@/modules/practice/ui/freestyle/model/freestyleLiveView'
import {
  readFreestyleRevealMap,
  writeFreestyleRevealMap,
} from '@/modules/practice/ui/freestyle/model/freestyleRevealCache'
import { isQuizCard } from '@/modules/practice/ui/freestyle/model/freestyle-cards'
import type { QuizRuntimeState } from '@/modules/quiz/public'

type ImmersiveQueue = ReturnType<typeof useImmersiveQueue>
type QuizFlow = ReturnType<typeof useFreestyleQuizFlow>

/** Node uid → reveal state. Small maps, so a key walk beats serialising both sides. */
function sameRevealMap(
  left: Record<string, string> | null,
  right: Record<string, string> | null,
) {
  if (left === right) return true
  if (!left || !right) return !left && !right
  const leftKeys = Object.keys(left)
  if (leftKeys.length !== Object.keys(right).length) return false
  return leftKeys.every((key) => left[key] === right[key])
}

/** Shares rating evidence while routes, card positions, and reveal UI stay local. */
export function useFreestyleLiveSync({
  fullPath,
  entryPalaceId,
  isActive,
  cards,
  currentIndex,
  currentCard,
  roundComplete,
  visualIndex,
  viewingCompleteSlot,
  planVersion,
  queueState,
  navigateToIndex,
  progress,
  updateQuestionState,
  adoptRoundVersion,
  updateUnitEncounter,
  completeCardBatch,
  hydrateLiveRound,
}: {
  fullPath: string
  entryPalaceId: number | null
  isActive: boolean
  cards: ImmersiveQueue['cards']
  currentIndex: number
  currentCard: ImmersiveQueue['cards'][number] | null
  roundComplete: boolean
  visualIndex: number
  viewingCompleteSlot: boolean
  planVersion: number
  queueState: ImmersiveQueue['queueState']
  navigateToIndex: (index: number, options?: { reorderRestudy?: boolean }) => void
  progress: QuizFlow['progress']
  updateQuestionState: QuizFlow['updateQuestionState']
  adoptRoundVersion: ImmersiveQueue['adoptRoundVersion']
  updateUnitEncounter: ImmersiveQueue['updateUnitEncounter']
  completeCardBatch: ImmersiveQueue['completeCardBatch']
  hydrateLiveRound: ImmersiveQueue['hydrateLiveRound']
}) {
  const queueStateRef = useRef(queueState)
  queueStateRef.current = queueState

  const currentCardId = currentCard?.id ?? null
  const revealCacheKey = currentCardId
  /**
   * The reveal map for the card under the viewport.
   *
   * This used to be seeded by calling setState *during render*, which makes React
   * throw away the in-progress render and immediately re-run the whole freestyle
   * page on every card change — the visible hitch when flipping.
   *
   * `liveRevealMap` is now only an override written by a peer device. The value
   * shown is derived, so a flip costs no extra render pass.
   */
  const memoizedRevealMap = useMemo(
    () => (revealCacheKey ? readFreestyleRevealMap(revealCacheKey) : null),
    [revealCacheKey],
  )
  const [remoteRevealMap, setRemoteRevealMap] = useState<{
    cardId: string
    map: Record<string, string> | null
  } | null>(null)
  const liveRevealMap = remoteRevealMap?.cardId === revealCacheKey
    ? remoteRevealMap.map
    : memoizedRevealMap

  const applyLiveViewport = useCallback((viewport: {
    currentCardId: string | null
    visualIndex: number
    viewingCompleteSlot: boolean
    roundId: string
    planVersion: number
  }) => {
    const localRound = queueStateRef.current
    if (viewport.roundId && viewport.roundId !== localRound.roundId) return false
    if (viewport.planVersion > 0 && planVersion > 0 && viewport.planVersion > planVersion) return false
    if (viewport.viewingCompleteSlot) {
      if (!roundComplete) return false
      navigateToIndex(cards.length, { reorderRestudy: false })
      return true
    }
    if (viewport.currentCardId) {
      const index = cards.findIndex((card) => card.id === viewport.currentCardId)
      if (index >= 0) {
        navigateToIndex(index, { reorderRestudy: false })
        return true
      }
      return false
    }
    if (Number.isFinite(viewport.visualIndex)) {
      const index = Math.max(0, Math.min(cards.length - 1, Math.trunc(viewport.visualIndex)))
      if (cards[index]) {
        navigateToIndex(index, { reorderRestudy: false })
        return true
      }
    }
    return false
  }, [cards, navigateToIndex, planVersion, roundComplete])
  const applyLiveQuestionState = useCallback((questionId: number, state: QuizRuntimeState) => {
    updateQuestionState(questionId, (current) => (
      JSON.stringify(current) === JSON.stringify(state) ? current : state
    ))
  }, [updateQuestionState])
  const applyLiveRevealMap = useCallback((map: Record<string, string> | null) => {
    if (!revealCacheKey) return
    if (map) writeFreestyleRevealMap(revealCacheKey, map)
    setRemoteRevealMap((current) => {
      if (current?.cardId === revealCacheKey && sameRevealMap(current.map, map)) return current
      return { cardId: revealCacheKey, map }
    })
  }, [revealCacheKey])
  const liveRating = useMemo<FreestyleLiveRating | null>(() => {
    const settled = Object.entries(queueState.unitEncountersByCardId).flatMap(([cardId, encounter]) => {
      if (encounter.selectedRating == null) return []
      return [{
        cardId,
        rating: encounter.selectedRating,
        passed: encounter.passed === true,
        restudy: encounter.passed === false,
        retryAfterCards: encounter.retryAfterCards ?? 0,
      }]
    })
    const currentId = currentCard?.id ?? null
    const current = currentId ? queueState.unitEncountersByCardId[currentId] : undefined
    if (current?.selectedRating == null && settled.length === 0) return null
    return {
      planVersion,
      currentCardId: currentId,
      selectedRating: current?.selectedRating ?? settled[0]?.rating ?? 0,
      passed: current?.passed === true,
      settled,
    }
  }, [currentCard?.id, planVersion, queueState.unitEncountersByCardId])
  const applyLiveRating = useCallback((rating: FreestyleLiveRating) => {
    if (rating.planVersion > 0) {
      adoptRoundVersion({ plan_version: rating.planVersion })
    }
    const entries = rating.settled.flatMap((settle) => {
      const current = queueStateRef.current.unitEncountersByCardId[settle.cardId]
      if (
        current?.selectedRating === settle.rating
        && current.passed === settle.passed
        && current.retryAfterCards === settle.retryAfterCards
      ) {
        return []
      }
      updateUnitEncounter(settle.cardId, {
        encounterId: current?.encounterId ?? settle.cardId,
        roundId: current?.roundId,
        unitRevision: current?.unitRevision ?? 0,
        status: current?.status ?? 'open',
        sessionId: current?.sessionId ?? null,
        selectedRating: settle.rating,
        passed: settle.passed,
        retryAfterCards: settle.retryAfterCards,
      })
      return [{
        cardId: settle.cardId,
        restudy: settle.restudy,
        rating: settle.rating,
        retryAfterCards: settle.retryAfterCards,
      }]
    })
    if (entries.length > 0) {
      completeCardBatch(entries, queueStateRef.current.currentCardId ?? undefined)
    }
  }, [adoptRoundVersion, completeCardBatch, updateUnitEncounter])
  const queueCardIds = useMemo(() => cards.map((card) => card.id), [cards])
  const requestRoundSync = useCallback((view: FreestyleLiveView) => {
    if (!view.roundId) return
    void hydrateLiveRound({
      roundId: view.roundId,
      planVersion: view.planVersion,
      queueCardIds: view.queueCardIds,
    })
  }, [hydrateLiveRound])
  useFreestyleLiveMirror({
    route: fullPath,
    palaceId: entryPalaceId,
    currentCardId: currentCard?.id ?? null,
    currentIndex,
    visualIndex,
    viewingCompleteSlot,
    queueCardIds,
    roundComplete,
    roundId: queueState.roundId,
    planVersion,
    questionId: currentCard && isQuizCard(currentCard) ? currentCard.question.id : null,
    questionState: currentCard && isQuizCard(currentCard)
      ? progress.questionStates[currentCard.question.id]
      : undefined,
    revealMap: liveRevealMap,
    rating: liveRating,
    applyViewport: applyLiveViewport,
    requestRoundSync,
    applyQuestionState: applyLiveQuestionState,
    applyRevealMap: applyLiveRevealMap,
    applyRating: applyLiveRating,
    isActive,
  })

  return { liveRevealMap, applyLiveRevealMap }
}
