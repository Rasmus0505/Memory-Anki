import { useEffect, useRef, useState } from 'react'
import { cardPalaceId } from '@/modules/practice/public'
import type { useImmersiveQueue } from '@/modules/practice/ui/freestyle/hooks/useImmersiveQueue'
import { useFreestyleFlowFeedback } from '@/modules/practice/ui/freestyle/hooks/useFreestyleFlowFeedback'
import {
  buildPalaceClearance,
  isPalaceRoundCleared,
  leftoverDueForPalace,
  type PalaceClearance,
} from '@/modules/practice/ui/freestyle/model/freestylePalaceClearance'

type ImmersiveQueue = ReturnType<typeof useImmersiveQueue>

/** Announces a palace chapter once per round, when every due card in it is settled. */
export function usePalaceClearanceWatch({
  cards,
  currentIndex,
  queueState,
  roundMeta,
  roundPlan,
  pendingRestudyCardIds,
  loading,
  error,
}: {
  cards: ImmersiveQueue['cards']
  currentIndex: number
  queueState: ImmersiveQueue['queueState']
  roundMeta: ImmersiveQueue['roundMeta']
  roundPlan: ImmersiveQueue['roundPlan']
  pendingRestudyCardIds: ImmersiveQueue['pendingRestudyCardIds']
  loading: boolean
  error: ImmersiveQueue['error']
}) {
  const [palaceClearance, setPalaceClearance] = useState<PalaceClearance | null>(null)
  const announcedPalaceClearanceRef = useRef<string | null>(null)
  const { signalPalaceCleared } = useFreestyleFlowFeedback()

  useEffect(() => {
    announcedPalaceClearanceRef.current = null
    setPalaceClearance(null)
  }, [queueState.roundId])

  useEffect(() => {
    if (loading || error || cards.length === 0) {
      setPalaceClearance(null)
      return
    }
    const card = cards[currentIndex]
    const palaceId = cardPalaceId(card)
    if (palaceId == null || !card) {
      setPalaceClearance(null)
      return
    }
    const key = `${queueState.roundId}:${palaceId}`
    const cleared = isPalaceRoundCleared({
      cards,
      palaceId,
      plan: roundPlan,
      encountersByCardId: queueState.unitEncountersByCardId,
      completedIds: queueState.completedIds,
      pendingRestudyIds: pendingRestudyCardIds,
      hiddenIds: queueState.hiddenIds,
    })
    if (!cleared) {
      setPalaceClearance(null)
      return
    }
    if (announcedPalaceClearanceRef.current === key) return
    announcedPalaceClearanceRef.current = key
    const clearance = buildPalaceClearance(
      cards,
      palaceId,
      leftoverDueForPalace(roundMeta.palace_leftover_due, palaceId),
    )
    setPalaceClearance(clearance)
    signalPalaceCleared()
  }, [
    cards,
    currentIndex,
    error,
    loading,
    pendingRestudyCardIds,
    queueState.completedIds,
    queueState.hiddenIds,
    queueState.roundId,
    queueState.unitEncountersByCardId,
    roundMeta.palace_leftover_due,
    roundPlan,
    signalPalaceCleared,
  ])

  return { palaceClearance, setPalaceClearance }
}
