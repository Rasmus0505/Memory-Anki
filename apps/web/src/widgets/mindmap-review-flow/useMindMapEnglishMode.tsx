import { useCallback, useRef, useState, type ReactNode } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import {
  EnglishLookupPanel,
  LookupAnchor,
  useEnglishLookup,
} from '@/modules/english-lookup/public'

/**
 * Host-side English interaction mode for flip-card mind maps:
 * Saladict-style dual dictionary lookup (no sentence LLM translation).
 */
export function useMindMapEnglishMode() {
  const [englishModeActive, setEnglishModeActive] = useState(false)
  const readingContentRef = useRef<HTMLDivElement | null>(null)
  const lookup = useEnglishLookup({
    isActive: englishModeActive,
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

  const englishChrome: ReactNode = englishModeActive ? (
    <>
      <LookupAnchor anchor={lookup.anchor} onClick={lookup.handleAnchorClick} />
      <EnglishLookupPanel lookup={lookup} />
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
