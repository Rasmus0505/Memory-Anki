import { useEffect, useRef, useState, type RefObject } from 'react'
import { isQuizShortcutRecording, resolveQuizShortcutAction } from '@/modules/quiz/domain/quiz-entity/model/quizShortcuts'
import {
  QUIZ_SHORTCUTS_UPDATED_EVENT,
  readQuizShortcuts,
} from '@/modules/quiz/domain/quiz-entity/model/quizShortcutSettings'
import { sanitizeQuizShortcutMap } from '@/modules/quiz/domain/quiz-entity/model/quizShortcuts'

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement
    && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  )
}

function focusedOptionIndex(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return null
  const focused = target.closest<HTMLElement>('[data-quiz-option-index]')
  if (focused?.dataset.quizOptionIndex == null) return null
  const index = Number(focused.dataset.quizOptionIndex)
  return Number.isFinite(index) ? index : null
}

function enterOnUnrelatedControl(event: KeyboardEvent) {
  if (event.key !== 'Enter') return false
  const target = event.target
  if (!(target instanceof HTMLElement)) return false
  if (focusedOptionIndex(target) != null) return false
  return Boolean(target.closest('button, [role="button"], a'))
}

export function useQuizAnsweringShortcuts({
  enabled,
  questionCount,
  optionCount,
  choiceShortcutsActive,
  attemptClosed,
  keyboardOptionIndex,
  setKeyboardOptionIndex,
  interactionRootRef,
  onPreviousQuestion,
  onNextQuestion,
  onSelectOption,
  onToggleMark,
}: {
  enabled: boolean
  questionCount: number
  optionCount: number
  choiceShortcutsActive: boolean
  attemptClosed: boolean
  keyboardOptionIndex: number
  setKeyboardOptionIndex: (index: number) => void
  interactionRootRef: RefObject<HTMLElement | null>
  onPreviousQuestion: () => void
  onNextQuestion: () => void
  onSelectOption: (optionIndex: number) => void
  onToggleMark: () => void
}) {
  const [shortcuts, setShortcuts] = useState(readQuizShortcuts)
  const shortcutsRef = useRef(shortcuts)
  shortcutsRef.current = shortcuts
  const latestRef = useRef({
    questionCount,
    optionCount,
    choiceShortcutsActive,
    attemptClosed,
    keyboardOptionIndex,
    setKeyboardOptionIndex,
    interactionRootRef,
    onPreviousQuestion,
    onNextQuestion,
    onSelectOption,
    onToggleMark,
  })
  latestRef.current = {
    questionCount,
    optionCount,
    choiceShortcutsActive,
    attemptClosed,
    keyboardOptionIndex,
    setKeyboardOptionIndex,
    interactionRootRef,
    onPreviousQuestion,
    onNextQuestion,
    onSelectOption,
    onToggleMark,
  }

  useEffect(() => {
    const handleUpdate = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null
      setShortcuts(sanitizeQuizShortcutMap(detail ?? readQuizShortcuts()))
    }
    window.addEventListener(QUIZ_SHORTCUTS_UPDATED_EVENT, handleUpdate)
    return () => window.removeEventListener(QUIZ_SHORTCUTS_UPDATED_EVENT, handleUpdate)
  }, [])

  useEffect(() => {
    if (!enabled) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && target.closest('[data-quiz-shortcut-settings]')) return
      const current = latestRef.current
      const editable = isEditableTarget(target)
      const recording = isQuizShortcutRecording()
      const match = resolveQuizShortcutAction(event, shortcutsRef.current, {
        questionCount: current.questionCount,
        optionCount: current.optionCount,
        choiceShortcutsActive: current.choiceShortcutsActive,
        attemptClosed: current.attemptClosed,
        repeat: event.repeat,
        editable,
        recording,
        enterOnUnrelatedControl: enterOnUnrelatedControl(event),
      })
      // ↑/↓ also snap the freestyle feed behind this dialog.
      const verticalFeedKey = event.key === 'ArrowUp' || event.key === 'ArrowDown'
      if (!match) {
        if (verticalFeedKey && !editable && !recording) {
          event.preventDefault()
          event.stopPropagation()
        }
        return
      }
      event.preventDefault()
      event.stopPropagation()
      if (!match.run) return
      if (match.id === 'previous_question') {
        current.onPreviousQuestion()
        return
      }
      if (match.id === 'next_question') {
        current.onNextQuestion()
        return
      }
      if (match.id === 'toggle_mark') {
        current.onToggleMark()
        return
      }
      if (match.id === 'previous_option' || match.id === 'next_option') {
        if (current.optionCount <= 0) return
        const delta = match.id === 'next_option' ? 1 : -1
        const nextIndex = (current.keyboardOptionIndex + delta + current.optionCount) % current.optionCount
        current.setKeyboardOptionIndex(nextIndex)
        current.interactionRootRef.current
          ?.querySelector<HTMLButtonElement>(`[data-quiz-option-index="${nextIndex}"]`)
          ?.focus()
        return
      }
      const optionIndex = match.id === 'submit_choice'
        ? (focusedOptionIndex(target) ?? current.keyboardOptionIndex)
        : match.optionIndex
      if (optionIndex == null || optionIndex < 0 || optionIndex >= current.optionCount) return
      current.onSelectOption(optionIndex)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [enabled])
}
