import { useCallback, useRef, useState, type ReactNode } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import {
  useEnglishDictionaryLookup,
  useEnglishSentenceSelectionActions,
} from '@/modules/english/public'
import { useAiRunConfigDialog } from '@/modules/settings/public'
import type { TimedSessionController } from '@/shared/hooks/useTimedSession'
import { MindMapEnglishModeChrome } from './MindMapEnglishModeChrome'

/** English reading hooks require a timer; mind-map English mode only needs activity no-ops. */
const ENGLISH_MODE_NOOP_TIMER = {
  registerActivity: () => undefined,
} as unknown as TimedSessionController

/**
 * Host-side English interaction mode for flip-card mind maps:
 * word lookup + long-press sentence selection / AI translation.
 */
export function useMindMapEnglishMode() {
  const [englishModeActive, setEnglishModeActive] = useState(false)
  const { promptForAiOptions, aiRunConfigDialog } = useAiRunConfigDialog()
  const dictionary = useEnglishDictionaryLookup({
    isActive: englishModeActive,
    timer: ENGLISH_MODE_NOOP_TIMER,
  })
  const sentenceTranslation = useEnglishSentenceSelectionActions({
    isActive: englishModeActive,
    timer: ENGLISH_MODE_NOOP_TIMER,
    promptForAiOptions,
    dictionaryPanelRef: dictionary.dictionaryPanelRef,
  })

  const handleLookupWordRef = useRef(dictionary.handleLookupWord)
  handleLookupWordRef.current = dictionary.handleLookupWord
  const resetDictionaryRef = useRef(dictionary.resetDictionaryInteractions)
  resetDictionaryRef.current = dictionary.resetDictionaryInteractions
  const resetSentenceTranslationRef = useRef(
    sentenceTranslation.resetSentenceTranslationInteractions,
  )
  resetSentenceTranslationRef.current =
    sentenceTranslation.resetSentenceTranslationInteractions

  const handleEnglishWordClick = useCallback(
    (word: string, event: ReactMouseEvent<HTMLElement>) => {
      void handleLookupWordRef.current(word, event)
    },
    [],
  )

  const handleToggleEnglishMode = useCallback(() => {
    setEnglishModeActive((current) => {
      const next = !current
      if (!next) {
        resetDictionaryRef.current()
        resetSentenceTranslationRef.current()
      }
      return next
    })
  }, [])

  const englishChrome: ReactNode = englishModeActive ? (
    <MindMapEnglishModeChrome
      sentenceTranslationTrigger={sentenceTranslation.sentenceTranslationTrigger}
      sentenceTranslationTriggerRef={sentenceTranslation.sentenceTranslationTriggerRef}
      onConfirmSentenceTranslation={sentenceTranslation.handleConfirmSentenceTranslation}
      dictionaryPanel={dictionary.dictionaryPanel}
      dictionaryPanelRef={dictionary.dictionaryPanelRef}
      onCloseDictionaryPanel={() => dictionary.setDictionaryPanel(null)}
      onDictionaryHeaderPointerDown={dictionary.handleDictionaryHeaderPointerDown}
      onDictionaryHeaderMouseDown={dictionary.handleDictionaryHeaderMouseDown}
      onToggleDictionaryPin={dictionary.handleToggleDictionaryPin}
      playDictionaryPronunciation={dictionary.playDictionaryPronunciation}
      supportsSpeechSynthesis={dictionary.supportsSpeechSynthesis}
      sentenceTranslationPanel={sentenceTranslation.sentenceTranslationPanel}
      sentenceTranslationPanelRef={sentenceTranslation.sentenceTranslationPanelRef}
      onCloseSentenceTranslationPanel={() => sentenceTranslation.setSentenceTranslationPanel(null)}
      onSentenceTranslationHeaderPointerDown={
        sentenceTranslation.handleSentenceTranslationHeaderPointerDown
      }
      onSentenceTranslationHeaderMouseDown={
        sentenceTranslation.handleSentenceTranslationHeaderMouseDown
      }
      onToggleSentenceTranslationPin={sentenceTranslation.handleToggleSentenceTranslationPin}
      onLookupWord={handleEnglishWordClick}
    />
  ) : null

  return {
    englishModeActive,
    handleToggleEnglishMode,
    handleEnglishWordClick,
    readingContentRef: sentenceTranslation.readingContentRef,
    handleReadingContentPointerDown: sentenceTranslation.handleReadingContentPointerDown,
    englishChrome,
    aiRunConfigDialog,
  }
}
