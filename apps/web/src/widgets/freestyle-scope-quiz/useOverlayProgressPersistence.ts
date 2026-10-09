import { useCallback, useEffect, useRef } from 'react'
import { createOperationId } from '@/modules/practice/application/feedPersistence'
import { progressFreestyleOverlayQuizApi } from '@/modules/practice/ui/freestyle/api'
import { type QuizRuntimeState } from '@/modules/quiz/public'
import { isBusyResponseError } from '@/shared/api/busyRetry'
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
const NETWORK_RETRY_MS = [800, 2000, 5000, 12000]

function isBriefDisconnect(message: string) {
  const text = message.toLowerCase()
  return (
    text.includes('failed to fetch')
    || text.includes('load failed')
    || text.includes('networkerror')
    || text.includes('网络请求失败')
  )
}

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
  const retryTimerRef = useRef<number | null>(null)
  const retryAttemptRef = useRef(0)
  const toldDisconnectRef = useRef(false)
  const writeProgressNowRef = useRef<
    (nextIndex: number, nextStates: Record<number, QuizRuntimeState>) => Promise<void>
  >(async () => {})
  /**
   * Set when the local state has moved ahead of the server. Guards the no-op
   * write so an idle dialog does not re-post unchanged progress.
   */
  const dirtyProgressRef = useRef(false)

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current != null) {
      window.clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
  }, [])

  const scheduleNetworkRetry = useCallback(() => {
    if (retryTimerRef.current != null) return
    const attempt = retryAttemptRef.current
    if (attempt >= NETWORK_RETRY_MS.length) {
      if (!toldDisconnectRef.current) {
        toldDisconnectRef.current = true
        toast.error('做题进度还没存上，软件会自己再试。')
      }
      return
    }
    const delay = NETWORK_RETRY_MS[attempt] ?? 12000
    retryAttemptRef.current += 1
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null
      void writeProgressNowRef.current(indexRef.current, questionStatesRef.current)
    }, delay)
  }, [indexRef, questionStatesRef])

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
      retryAttemptRef.current = 0
      toldDisconnectRef.current = false
      clearRetryTimer()
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
      if (message.includes('题目不存在')) return
      // A brief local disconnect is not "please relaunch". Keep the write dirty
      // and retry. The long launcher essay must not pop in the corner.
      // A busy database is the same kind of pause as a brief disconnect: the
      // write is still dirty, and the software retries it. Surfacing the
      // server's "已自动重试" sentence here was a lie — this caller had not
      // retried — and it popped in the corner while the learner was answering.
      if (isBriefDisconnect(message) || isBusyResponseError(error) || message.includes('数据正在写入中')) {
        dirtyProgressRef.current = true
        scheduleNetworkRetry()
        return
      }
      toast.error(message)
    }
  }, [clearRetryTimer, onRoundSync, planVersionRef, roundIdRef, scheduleNetworkRetry, setOverlay])

  writeProgressNowRef.current = writeProgressNow

  const flushProgressNow = useCallback(() => {
    if (persistTimerRef.current != null) {
      window.clearTimeout(persistTimerRef.current)
      persistTimerRef.current = null
    }
    clearRetryTimer()
    if (!dirtyProgressRef.current) return
    void writeProgressNow(indexRef.current, questionStatesRef.current)
  }, [clearRetryTimer, indexRef, questionStatesRef, writeProgressNow])

  const persistProgress = useCallback((
    nextIndex: number,
    nextStates: Record<number, QuizRuntimeState>,
  ) => {
    if (!roundIdRef.current) return
    dirtyProgressRef.current = true
    clearRetryTimer()
    indexRef.current = nextIndex
    questionStatesRef.current = nextStates
    if (persistTimerRef.current != null) window.clearTimeout(persistTimerRef.current)
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null
      void writeProgressNow(nextIndex, nextStates)
    }, PROGRESS_DEBOUNCE_MS)
  }, [clearRetryTimer, indexRef, questionStatesRef, roundIdRef, writeProgressNow])

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
