import { useCallback, useEffect } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'
import {
  getShortcutLabel,
  isShortcutPressed,
  type EnglishPracticeSettings,
} from '@/features/english/englishPracticeSettings'
import { isEditableShortcutTarget } from '@/features/english/englishTypingHelpers'

interface UseEnglishCourseShortcutsOptions {
  settingsOpen: boolean
  typingEnabled: boolean
  typingInputRef: RefObject<HTMLInputElement | null>
  practiceSettingsRef: RefObject<EnglishPracticeSettings>
  sentenceResolvedRef: RefObject<boolean>
  handleBackspace: () => void
  handleCharacterInput: (value: string) => void
  replayCurrentSentence: (source?: string, nextTargetIndexOverride?: number | null) => boolean
  handleNavigateSentence: (delta: number) => void
  revealLetter: () => void
  revealWord: () => void
  toggleSingleSentenceLoop: () => void
  toggleAutoReplayOnPass: () => void
  toggleSound: () => void
}

export function useEnglishCourseShortcuts(options: UseEnglishCourseShortcutsOptions) {
  const {
    settingsOpen,
    typingEnabled,
    typingInputRef,
    practiceSettingsRef,
    sentenceResolvedRef,
    handleBackspace,
    handleCharacterInput,
    replayCurrentSentence,
    handleNavigateSentence,
    revealLetter,
    revealWord,
    toggleSingleSentenceLoop,
    toggleAutoReplayOnPass,
    toggleSound,
  } = options

  const handleShortcutCommand = useCallback(
    (event: KeyboardEvent | ReactKeyboardEvent<HTMLInputElement>) => {
      if (settingsOpen) return false
      const keyboardEvent = 'nativeEvent' in event ? event.nativeEvent : event
      const settings = practiceSettingsRef.current

      if (isShortcutPressed(keyboardEvent, settings.shortcuts.replay_sentence)) {
        event.preventDefault()
        event.stopPropagation()
        replayCurrentSentence(`shortcut_${getShortcutLabel(settings.shortcuts.replay_sentence)}`)
        return true
      }
      if (isShortcutPressed(keyboardEvent, settings.shortcuts.previous_sentence)) {
        event.preventDefault()
        event.stopPropagation()
        handleNavigateSentence(-1)
        return true
      }
      if (isShortcutPressed(keyboardEvent, settings.shortcuts.next_sentence)) {
        event.preventDefault()
        event.stopPropagation()
        handleNavigateSentence(1)
        return true
      }
      if (isShortcutPressed(keyboardEvent, settings.shortcuts.reveal_word)) {
        event.preventDefault()
        event.stopPropagation()
        if (!sentenceResolvedRef.current) revealWord()
        return true
      }
      if (isShortcutPressed(keyboardEvent, settings.shortcuts.reveal_letter)) {
        event.preventDefault()
        event.stopPropagation()
        if (!sentenceResolvedRef.current) revealLetter()
        return true
      }
      if (isShortcutPressed(keyboardEvent, settings.shortcuts.toggle_single_loop)) {
        event.preventDefault()
        event.stopPropagation()
        toggleSingleSentenceLoop()
        return true
      }
      if (isShortcutPressed(keyboardEvent, settings.shortcuts.toggle_auto_replay)) {
        event.preventDefault()
        event.stopPropagation()
        toggleAutoReplayOnPass()
        return true
      }
      if (isShortcutPressed(keyboardEvent, settings.shortcuts.toggle_sound)) {
        event.preventDefault()
        event.stopPropagation()
        toggleSound()
        return true
      }
      return false
    },
    [
      handleNavigateSentence,
      practiceSettingsRef,
      replayCurrentSentence,
      revealLetter,
      revealWord,
      sentenceResolvedRef,
      settingsOpen,
      toggleAutoReplayOnPass,
      toggleSingleSentenceLoop,
      toggleSound,
    ],
  )

  const handleTypingInputKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (handleShortcutCommand(event)) {
        return
      }
      if (!typingEnabled) return
      if (event.ctrlKey || event.metaKey || event.altKey) return

      if (event.key === 'Backspace') {
        event.preventDefault()
        handleBackspace()
        return
      }

      if (event.key.length !== 1) return

      event.preventDefault()
      handleCharacterInput(event.key)
    },
    [handleBackspace, handleCharacterInput, handleShortcutCommand, typingEnabled],
  )

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (settingsOpen) return
      if (event.target === typingInputRef.current) return
      if (isEditableShortcutTarget(event.target)) return
      handleShortcutCommand(event)
    }

    window.addEventListener('keydown', onWindowKeyDown)
    return () => {
      window.removeEventListener('keydown', onWindowKeyDown)
    }
  }, [handleShortcutCommand, settingsOpen, typingInputRef])

  return {
    handleShortcutCommand,
    handleTypingInputKeyDown,
  }
}
