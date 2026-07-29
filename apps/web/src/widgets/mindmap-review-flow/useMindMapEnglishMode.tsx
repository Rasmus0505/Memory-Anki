import { useCallback, useRef, useState, type ReactNode } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import {
  EnglishLookupPanel,
  LookupAnchor,
  useEnglishLookup,
} from '@/modules/english-lookup/public'
import { createEnglishReadingVocabularyNoteApi } from '@/modules/english-reading/public'
import { toast } from '@/shared/feedback/toast'

/**
 * Host-side English interaction mode for flip-card mind maps:
 * Saladict-style dual dictionary lookup (no sentence LLM translation).
 */
export function useMindMapEnglishMode() {
  const [englishModeActive, setEnglishModeActive] = useState(false)
  const readingContentRef = useRef<HTMLDivElement | null>(null)
  const lookup = useEnglishLookup({
    isActive: englishModeActive,
    onActivity: () => undefined,
  })

  const handleLookupWordRef = useRef(lookup.handleTokenClick)
  handleLookupWordRef.current = lookup.handleTokenClick
  const resetRef = useRef(lookup.reset)
  resetRef.current = lookup.reset

  const handleEnglishWordClick = useCallback(
    (word: string, event: ReactMouseEvent<HTMLElement>) => {
      handleLookupWordRef.current(word, event)
    },
    [],
  )

  const handleToggleEnglishMode = useCallback(() => {
    setEnglishModeActive((current) => {
      const next = !current
      if (!next) resetRef.current()
      return next
    })
  }, [])

  const handleFavorite = useCallback(async (query: string, summary: string) => {
    try {
      await createEnglishReadingVocabularyNoteApi({
        word: query,
        definitionZh: summary || undefined,
        note: '',
      })
      toast.success('已收藏生词')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '收藏失败')
    }
  }, [])

  const englishChrome: ReactNode = englishModeActive ? (
    <>
      <LookupAnchor anchor={lookup.anchor} onClick={lookup.handleAnchorClick} />
      <EnglishLookupPanel lookup={lookup} onFavorite={handleFavorite} />
    </>
  ) : null

  return {
    englishModeActive,
    handleToggleEnglishMode,
    handleEnglishWordClick,
    readingContentRef,
    handleReadingContentPointerDown: undefined as
      | ((event: React.PointerEvent<HTMLElement>) => void)
      | undefined,
    englishChrome,
    aiRunConfigDialog: null as ReactNode,
  }
}
