import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildSentenceInputText,
  clearActiveWordInState,
  cloneWordState,
  completeActiveWordInState,
  countTokenInputErrors,
  createWordState,
  normalizeComparableToken,
  revealLetterInState,
  type EnglishWordState,
} from '@/features/english/englishTypingHelpers'

interface UseEnglishWordTypingOptions {
  tokens: string[]
  onActivitySignal?: () => void
  onTypingDone?: (sentenceInputText: string) => void
  playKeySound?: () => void
  playWrongSound?: () => void
  playCorrectSound?: () => void
}

const WRONG_FLASH_MS = 220

export function useEnglishWordTyping({
  tokens,
  onActivitySignal,
  onTypingDone,
  playKeySound,
  playWrongSound,
  playCorrectSound,
}: UseEnglishWordTypingOptions) {
  const [typingState, setTypingState] = useState<EnglishWordState>(() => createWordState(tokens))
  const [wordRevealComparableIndices, setWordRevealComparableIndices] = useState<number[][]>([])
  const typingStateRef = useRef(typingState)
  const wrongFlashTimerRef = useRef<number | null>(null)

  const clearWrongFlashTimer = useCallback(() => {
    if (wrongFlashTimerRef.current != null) {
      window.clearTimeout(wrongFlashTimerRef.current)
      wrongFlashTimerRef.current = null
    }
  }, [])

  const applyTypingState = useCallback((nextState: EnglishWordState) => {
    typingStateRef.current = nextState
    setTypingState(nextState)
  }, [])

  const resetTypingState = useCallback(() => {
    clearWrongFlashTimer()
    const nextState = createWordState(tokens)
    applyTypingState(nextState)
    setWordRevealComparableIndices(Array.from({ length: tokens.length }, () => []))
  }, [applyTypingState, clearWrongFlashTimer, tokens])

  useEffect(() => {
    resetTypingState()
  }, [resetTypingState])

  useEffect(() => {
    return () => {
      clearWrongFlashTimer()
    }
  }, [clearWrongFlashTimer])

  const handleTypingCompleted = useCallback(
    (completedState: EnglishWordState) => {
      onTypingDone?.(buildSentenceInputText(completedState.wordInputs))
    },
    [onTypingDone],
  )

  const flashWrongAndClear = useCallback(() => {
    clearWrongFlashTimer()
    const beforeWrong = cloneWordState(typingStateRef.current)
    if (beforeWrong.activeWordIndex >= beforeWrong.wordStatuses.length) return
    beforeWrong.wordStatuses[beforeWrong.activeWordIndex] = 'wrong'
    applyTypingState(beforeWrong)
    wrongFlashTimerRef.current = window.setTimeout(() => {
      wrongFlashTimerRef.current = null
      applyTypingState(clearActiveWordInState(typingStateRef.current))
    }, WRONG_FLASH_MS)
  }, [applyTypingState, clearWrongFlashTimer])

  const handleBackspace = useCallback(() => {
    clearWrongFlashTimer()
    const currentState = cloneWordState(typingStateRef.current)
    if (currentState.activeWordIndex >= currentState.wordInputs.length) return
    onActivitySignal?.()
    playKeySound?.()
    const nextInput = currentState.currentWordInput.slice(0, -1)
    currentState.currentWordInput = nextInput
    currentState.wordInputs[currentState.activeWordIndex] = nextInput
    currentState.wordStatuses[currentState.activeWordIndex] = 'active'
    applyTypingState(currentState)
  }, [applyTypingState, clearWrongFlashTimer, onActivitySignal, playKeySound])

  const handleCharacterInput = useCallback(
    (key: string) => {
      clearWrongFlashTimer()
      const currentState = cloneWordState(typingStateRef.current)
      const activeWordIndex = currentState.activeWordIndex
      if (activeWordIndex >= tokens.length) return
      const expectedToken = tokens[activeWordIndex] || ''
      if (!expectedToken) return

      onActivitySignal?.()
      playKeySound?.()

      const nextInput = `${currentState.currentWordInput}${key}`
      currentState.currentWordInput = nextInput
      currentState.wordInputs[activeWordIndex] = nextInput
      currentState.wordStatuses[activeWordIndex] = 'active'
      applyTypingState(currentState)

      const errorCount = countTokenInputErrors(nextInput, expectedToken)
      if (errorCount > 2) {
        playWrongSound?.()
        flashWrongAndClear()
        return
      }

      const normalizedExpected = normalizeComparableToken(expectedToken)
      const normalizedInput = normalizeComparableToken(nextInput)
      if (normalizedInput.length < normalizedExpected.length) return

      if (normalizedInput === normalizedExpected) {
        playCorrectSound?.()
        const completed = completeActiveWordInState(currentState, tokens)
        applyTypingState(completed.state)
        if (completed.completedSentence) {
          handleTypingCompleted(completed.state)
        }
        return
      }

      playWrongSound?.()
      flashWrongAndClear()
    },
    [
      applyTypingState,
      clearWrongFlashTimer,
      flashWrongAndClear,
      handleTypingCompleted,
      onActivitySignal,
      playCorrectSound,
      playKeySound,
      playWrongSound,
      tokens,
    ],
  )

  const revealLetter = useCallback(() => {
    clearWrongFlashTimer()
    const revealed = revealLetterInState(typingStateRef.current, tokens, wordRevealComparableIndices)
    applyTypingState(revealed.state)
    setWordRevealComparableIndices(revealed.revealComparableIndices)
    if (revealed.completedSentence) {
      playCorrectSound?.()
      handleTypingCompleted(revealed.state)
      return
    }
    playKeySound?.()
  }, [
    applyTypingState,
    clearWrongFlashTimer,
    handleTypingCompleted,
    playCorrectSound,
    playKeySound,
    tokens,
    wordRevealComparableIndices,
  ])

  const revealWord = useCallback(() => {
    clearWrongFlashTimer()
    const currentState = cloneWordState(typingStateRef.current)
    const activeWordIndex = currentState.activeWordIndex
    if (activeWordIndex >= tokens.length) return
    const completed = completeActiveWordInState(currentState, tokens)
    const nextRevealComparableIndices = wordRevealComparableIndices.map((item) => [...item])
    const revealLength = normalizeComparableToken(tokens[activeWordIndex] || '').length
    nextRevealComparableIndices[activeWordIndex] = Array.from({ length: revealLength }, (_, index) => index)
    setWordRevealComparableIndices(nextRevealComparableIndices)
    applyTypingState(completed.state)
    playCorrectSound?.()
    if (completed.completedSentence) {
      handleTypingCompleted(completed.state)
    }
  }, [
    applyTypingState,
    clearWrongFlashTimer,
    handleTypingCompleted,
    playCorrectSound,
    tokens,
    wordRevealComparableIndices,
  ])

  const resetCurrentWord = useCallback(() => {
    clearWrongFlashTimer()
    applyTypingState(clearActiveWordInState(typingStateRef.current))
  }, [applyTypingState, clearWrongFlashTimer])

  const sentenceInputText = useMemo(
    () => buildSentenceInputText(typingState.wordInputs),
    [typingState.wordInputs],
  )

  const isSentenceLocallyComplete = typingState.activeWordIndex >= tokens.length

  return {
    typingState,
    wordRevealComparableIndices,
    sentenceInputText,
    isSentenceLocallyComplete,
    resetTypingState,
    resetCurrentWord,
    handleBackspace,
    handleCharacterInput,
    revealLetter,
    revealWord,
  }
}
