import { useCallback, useEffect, useRef } from 'react'
import { createOperationId } from '@/modules/practice/application/feedPersistence'
import { progressFreestyleOverlayQuizApi } from '@/modules/practice/ui/freestyle/api'
import { type QuizRuntimeState } from '@/modules/quiz/public'
import { toast } from '@/shared/feedback/toast'
import type {
  FreestyleOverlayQuizState,
  FreestyleRoundStatePayload,
} from '@/shared/api/contracts'
import { overlayFromRound } from './overlayQuizHydrate'

/**
 * Debounced overlay-quiz progress persistence.
 *
 * Extracted from `FreestyleScopeQuizDialog` because the dialog is one large
 * component and this is the one self-contained concern inside it: it owns a
 * debounce timer, a dirty flag, the retry-on-conflict loop, and the
 * pagehide/visibility flush. Everything else in the dialog is rendering and
 * question interaction, which have nothing to do with when a write happens.
 *
 * The refs it needs are passed in rather than duplicated, so the dialog keeps
 * owning "what is the current index / plan version / question state" and this
 * hook only decides when and how that gets written.
 */

const PROGRESS_DEBOUNCE_MS = 320

interface OverlayProgressPersistenceInput {
  /** Null until a round exists; no write happens without one. */
  roundIdRef: { current: string | null }
  planVersionRef: { current: number }
  indexRef: { current: number }
  questionStatesRef: { current: Record<number, QuizRuntimeState> }
  /** Mirrors the active dialog `open` prop; the flush listener follows it. */
  open: boolean
  onRoundSync: (round: FreestyleRoundStatePayload) => void
  setOverlay: (state: FreestyleOverlayQuizState | null) => void
}

export function useOverlayProgressPersistence({
  roundIdRef,
  planVersionRef,
  indexRef,
  questionStatesRef,
  open,
  onRoundSync,
  setOverlay,
}: OverlayProgressPersistenceInput) {
  const persistTimerRef = useRef<number | null>(null)
  /**
   * Set when the local state has moved ahead of the server. Guards the no-op
   * write so an idle dialog does not re-post unchanged progress.
   */
  const dirtyProgressRef = useRef(false)

  const writeProgressNow = useCallback(async (
    nextIndex: number,
    nextStates: Record<number, QuizRuntimeState>,
    { retryOnConflict = true }: { retryOnConflict?: boolean } = {},
  ) => {
    const activeRoundId = roundIdRef.current
    if (!activeRoundId || !dirtyProgressRef.current) return
    const completedIds = Object.entries(nextStates)
      .filter(([, state]) => state.resolved)
      .map(([id]) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0)
    const states: Record<string, Record<string, unknown>> = {}
    for (const [id, state] of Object.entries(nextStates)) {
      states[id] = { ...state }
    }
    const postProgress = async (allowRetry: boolean) => {
      const round = await progressFreestyleOverlayQuizApi(activeRoundId, {
        operation_id: createOperationId(),
        expected_version: planVersionRef.current,
        current_index: nextIndex,
        completed_ids: completedIds,
        states,
      })
      dirtyProgressRef.current = false
      onRoundSync(round)
      if (typeof round.plan_version === 'number' && round.plan_version > 0) {
        planVersionRef.current = round.plan_version
      } else if (typeof round.version === 'number' && round.version > 0) {
        planVersionRef.current = round.version
      }
      const next = overlayFromRound(round)
      if (next) setOverlay(next)
      // A server-side conflict means another device advanced the plan; re-post
      // once against the version we just adopted instead of dropping the write.
      if (round.conflict && allowRetry) {
        dirtyProgressRef.current = true
        await postProgress(false)
      }
    }
    try {
      await postProgress(retryOnConflict)
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存做题进度失败。'
      // The question was deleted elsewhere; there is nothing to save for it.
      // Every other failure is surfaced and swallowed rather than rethrown, so a
      // background write can never become an unhandled rejection.
      if (message.includes('题目不存在')) return
      toast.error(message)
    }
  }, [onRoundSync, planVersionRef, roundIdRef, setOverlay])

  const flushProgressNow = useCallback(() => {
    if (persistTimerRef.current != null) {
      window.clearTimeout(persistTimerRef.current)
      persistTimerRef.current = null
    }
    if (!dirtyProgressRef.current) return
    void writeProgressNow(indexRef.current, questionStatesRef.current)
  }, [indexRef, questionStatesRef, writeProgressNow])

  const persistProgress = useCallback((
    nextIndex: number,
    nextStates: Record<number, QuizRuntimeState>,
  ) => {
    if (!roundIdRef.current) return
    dirtyProgressRef.current = true
    indexRef.current = nextIndex
    questionStatesRef.current = nextStates
    if (persistTimerRef.current != null) window.clearTimeout(persistTimerRef.current)
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null
      void writeProgressNow(nextIndex, nextStates)
    }, PROGRESS_DEBOUNCE_MS)
  }, [indexRef, questionStatesRef, roundIdRef, writeProgressNow])

  useEffect(() => {
    if (!open) return
    const onPageHide = () => flushProgressNow()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushProgressNow()
    }
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      flushProgressNow()
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [flushProgressNow, open])

  return {
    persistProgress,
    flushProgressNow,
  }
}
