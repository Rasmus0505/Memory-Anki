import { useCallback, useMemo, useState } from 'react'
import { withShuffledQuizOptions, type QuizOptionOrderState } from '../model/quizOptionShuffle'
import { useQuizOptionShuffleSettings } from './useQuizOptionShuffleSettings'

type Option = { id: string; text: string }
const emptyOrder: QuizOptionOrderState = { currentOrder: [], shuffled: false }

export function useQuizOptionShuffle({
  questionId,
  questionType,
  options,
}: {
  questionId: number | null
  questionType: string
  options: readonly Option[]
}) {
  const { settings } = useQuizOptionShuffleSettings()
  const optionSignature = useMemo(() => JSON.stringify(options.map(({ id, text }) => [id, text])), [options])
  const [savedOrders, setSavedOrders] = useState<Record<string, QuizOptionOrderState>>({})
  const key = `${questionId ?? 'draft'}:${optionSignature}`
  const order = savedOrders[key] ?? emptyOrder
  const displayedOptions = order.currentOrder.length
    ? order.currentOrder.map((id) => options.find((option) => option.id === id)).filter((option): option is Option => Boolean(option))
    : [...options]
  const canShuffle = questionType === 'multiple_choice' && displayedOptions.length > 1

  /** Reorder the current display immediately after an answer is completed. */
  const shuffleNow = useCallback(() => {
    if (!settings.enabled || !canShuffle) return
    setSavedOrders((current) => ({
      ...current,
      [key]: withShuffledQuizOptions(
        options,
        current[key] ?? emptyOrder,
        (option) => option.id,
      ),
    }))
  }, [canShuffle, key, options, settings.enabled])

  return { order, displayedOptions, shuffleNow }
}
