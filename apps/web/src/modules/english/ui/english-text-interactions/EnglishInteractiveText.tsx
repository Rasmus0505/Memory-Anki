import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { EnglishDictionaryFloat } from '@/modules/english/ui/english-text-interactions/EnglishDictionaryFloat'
import {
  canUseSpeechSynthesis,
  getEnglishReadingDictionaryApi,
  normalizeLookupWord,
  resolveDictionaryPanelLeft,
  resolveDictionaryPanelMaxHeight,
  resolveDictionaryPanelTop,
  type DictionaryPanelState,
} from '@/modules/english-reading/public'
import type { ReadingDictionaryEntry } from '@/shared/api/contracts'
import { cn } from '@/shared/lib/utils'

const WORD_SPLIT = /(\b[A-Za-z][A-Za-z'-]*\b)/g

function speakWord(word: string) {
  if (!canUseSpeechSynthesis()) return
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(word)
  utterance.lang = 'en-US'
  window.speechSynthesis.speak(utterance)
}

/**
 * Renders plain text with clickable English words: auto-pronounce + dictionary + vocab save.
 * Used on Anki cards and other English surfaces.
 */
export function EnglishInteractiveText({
  text,
  className,
  enableInteraction = true,
}: {
  text: string
  className?: string
  enableInteraction?: boolean
}) {
  const [dictionaryPanel, setDictionaryPanel] = useState<DictionaryPanelState | null>(null)
  const dictionaryPanelRef = useRef<HTMLDivElement | null>(null)
  const cacheRef = useRef<Map<string, ReadingDictionaryEntry>>(new Map())
  const tokenRef = useRef(0)

  const handleWordClick = useCallback(
    async (event: ReactMouseEvent<HTMLButtonElement>, rawWord: string) => {
      if (!enableInteraction) return
      event.preventDefault()
      event.stopPropagation()
      const word = normalizeLookupWord(rawWord)
      if (!word) return
      speakWord(word)
      const left = resolveDictionaryPanelLeft(event.clientX - 140)
      const top = resolveDictionaryPanelTop(event.clientY + 12)
      const maxHeight = resolveDictionaryPanelMaxHeight(top)
      const token = ++tokenRef.current
      setDictionaryPanel({
        queryWord: word,
        left,
        top,
        maxHeight,
        loading: true,
        error: null,
        entry: null,
        pinned: false,
        dragging: false,
      })
      try {
        const cached = cacheRef.current.get(word.toLowerCase())
        const entry = cached ?? (await getEnglishReadingDictionaryApi(word))
        if (!cached) cacheRef.current.set(word.toLowerCase(), entry)
        if (token !== tokenRef.current) return
        setDictionaryPanel((current) =>
          current
            ? {
                ...current,
                loading: false,
                entry,
                error: null,
              }
            : current,
        )
        if (entry.word || entry.lemma) speakWord(entry.word || entry.lemma)
      } catch (error) {
        if (token !== tokenRef.current) return
        setDictionaryPanel((current) =>
          current
            ? {
                ...current,
                loading: false,
                error: error instanceof Error ? error.message : '词典查询失败',
              }
            : current,
        )
      }
    },
    [enableInteraction],
  )

  if (!enableInteraction) {
    return <span className={className}>{text}</span>
  }

  const parts = String(text || '').split(WORD_SPLIT)

  return (
    <>
      <span className={cn('leading-inherit', className)}>
        {parts.map((part, index) => {
          if (!part) return null
          if (/^[A-Za-z][A-Za-z'-]*$/.test(part)) {
            return (
              <button
                key={`${part}-${index}`}
                type="button"
                data-reading-word="true"
                className="rounded px-0.5 text-inherit underline decoration-dotted decoration-zinc-500/60 underline-offset-2 transition hover:bg-white/10 hover:decoration-sky-300"
                onClick={(event) => void handleWordClick(event, part)}
              >
                {part}
              </button>
            )
          }
          return <span key={`t-${index}`}>{part}</span>
        })}
      </span>
      <EnglishDictionaryFloat
        dictionaryPanel={dictionaryPanel}
        dictionaryPanelRef={dictionaryPanelRef}
        onClose={() => setDictionaryPanel(null)}
        onHeaderPointerDown={() => undefined}
        onHeaderMouseDown={() => undefined}
        onTogglePin={() =>
          setDictionaryPanel((current) =>
            current ? { ...current, pinned: !current.pinned } : current,
          )
        }
        playDictionaryPronunciation={async (entry) => {
          speakWord(entry.word || entry.lemma || dictionaryPanel?.queryWord || '')
        }}
      />
    </>
  )
}
