import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { getFreestyleRoundApi } from '@/modules/practice/ui/freestyle/api'
import type { FreestyleOverlayQuizState } from '@/shared/api/contracts'
import { APP_EVENT_NAMES, onAppEvent } from '@/shared/events/appEvents'
import { overlayFromRound } from './overlayQuizHydrate'

/**
 * A rating changed anywhere (e.g. the 评分视图): re-read this round's question
 * ratings so the 「本轮最低」 chip on the current question follows without a reopen.
 *
 * Only the rating fields are patched. The rest of the overlay (questions, progress,
 * palace skips) stays under the dialog's own persistence loop.
 */
export function useOverlayRatingRefresh({
  open,
  roundId,
  roundIdRef,
  setOverlay,
}: {
  open: boolean
  roundId: string | null | undefined
  roundIdRef: MutableRefObject<string | null | undefined>
  setOverlay: Dispatch<SetStateAction<FreestyleOverlayQuizState | null>>
}) {
  useEffect(() => {
    if (!open || !roundId) return
    return onAppEvent(APP_EVENT_NAMES.reviewStateChanged, () => {
      const requestedRoundId = roundId
      void getFreestyleRoundApi(requestedRoundId)
        .then((round) => {
          // Only the round still on screen may update: a late reply for an
          // earlier round must not repaint this one.
          if (roundIdRef.current !== requestedRoundId) return
          const next = overlayFromRound(round)
          if (!next) return
          setOverlay((prev) => (prev
            ? {
              ...prev,
              question_node_ratings: next.question_node_ratings,
              question_pending_ids: next.question_pending_ids,
            }
            : prev))
        })
        .catch(() => {
          // Keep the chip as it was; a failed re-read is not a rating change.
        })
    })
  }, [open, roundId, roundIdRef, setOverlay])
}
