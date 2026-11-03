import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import {
  markQuizOptionAutoShufflePending,
  shouldAutoShuffleQuizOptions,
  takeQuizOptionAutoShufflePending,
  withRestoredQuizOptions,
  withShuffledQuizOptions,
  type QuizOptionOrderState,
  type QuizOptionShuffleActions,
} from '../model/quizOptionShuffle'
import { useQuizOptionShuffleSettings } from './useQuizOptionShuffleSettings'

type Option = { id: string; text: string }
const emptyOrder: QuizOptionOrderState = { originalOrder: [], currentOrder: [], shuffled: false }

export function useQuizOptionShuffle({
  questionId,
  questionType,
  options,
  getDurationMs,
  actionsRef,
  onAvailabilityChange,
}: {
  questionId: number | null
  questionType: string
  options: readonly Option[]
  getDurationMs?: (questionId: number) => number | null
  actionsRef?: RefObject<QuizOptionShuffleActions | null>
  onAvailabilityChange?: (canRestore: boolean) => void
}) {
  const { settings } = useQuizOptionShuffleSettings()
  const optionSignature = useMemo(() => JSON.stringify(options.map(({ id, text }) => [id, text])), [options])
  const [savedOrder, setSavedOrder] = useState<{ key: string; value: QuizOptionOrderState } | null>(null)
  const key = `${questionId ?? 'draft'}:${optionSignature}`
  const order = savedOrder?.key === key ? savedOrder.value : emptyOrder
  const displayedOptions = order.currentOrder.length
    ? order.currentOrder.map((id) => options.find((option) => option.id === id)).filter((option): option is Option => Boolean(option))
    : [...options]
  const canShuffle = questionType === 'multiple_choice' && displayedOptions.length > 1

  useEffect(() => {
    onAvailabilityChange?.(order.shuffled)
  }, [onAvailabilityChange, order.shuffled])

  const updateOrder = useCallback((next: QuizOptionOrderState) => {
    setSavedOrder({ key, value: next })
  }, [key])
  const shuffle = useCallback(() => {
    if (!canShuffle) return
    updateOrder(withShuffledQuizOptions(options, order, (option) => option.id))
  }, [canShuffle, options, order, updateOrder])
  const restore = useCallback(() => updateOrder(withRestoredQuizOptions(order)), [order, updateOrder])
  useImperativeHandle(actionsRef, () => ({
    shuffle,
    restore,
    canShuffle,
    canRestore: order.shuffled,
  }), [canShuffle, order.shuffled, restore, shuffle])
  /**
   * 自动打乱 applies to the next look, not the answer on screen. A fast answer
   * only leaves a marker; the shuffle lands when this question is shown again.
   */
  const markAutoShuffleForNextVisit = useCallback(() => {
    if (!canShuffle || questionId == null) return
    if (!shouldAutoShuffleQuizOptions(getDurationMs?.(questionId) ?? null, settings)) return
    markQuizOptionAutoShufflePending(questionId)
  }, [canShuffle, getDurationMs, questionId, settings])

  // The question is being shown: apply a pending auto-shuffle before paint, so
  // the learner never sees the original order flash and then jump.
  const appliedPendingKeyRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (questionId == null || !canShuffle) return
    if (appliedPendingKeyRef.current === key) return
    if (!takeQuizOptionAutoShufflePending(questionId)) return
    appliedPendingKeyRef.current = key
    setSavedOrder({
      key,
      value: withShuffledQuizOptions(options, emptyOrder, (option) => option.id),
    })
    // Only a new question/option set re-checks the pending marker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionId, key, canShuffle])

  return { order, displayedOptions, markAutoShuffleForNextVisit }
}
