import { useCallback, type MouseEvent as ReactMouseEvent } from 'react'
import {
  EnglishLookupPanel,
  useEnglishLookup,
} from '@/modules/english-lookup/public'
import { createEnglishReadingVocabularyNoteApi } from '@/modules/english-reading/public'
import { toast } from '@/shared/feedback/toast'
import { cn } from '@/shared/lib/utils'

const WORD_SPLIT = /(\b[A-Za-z][A-Za-z'-]*\b)/g

/**
 * Renders plain text with clickable English words via Saladict-style dual lookup.
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
  const lookup = useEnglishLookup({ isActive: enableInteraction })

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
                data-lookup-token="true"
                className="rounded px-0.5 text-inherit underline decoration-dotted decoration-zinc-500/60 underline-offset-2 transition hover:bg-white/10 hover:decoration-sky-300"
                onClick={(event: ReactMouseEvent<HTMLElement>) => {
                  lookup.handleTokenClick(part, event)
                }}
              >
                {part}
              </button>
            )
          }
          return <span key={`t-${index}`}>{part}</span>
        })}
      </span>
      <EnglishLookupPanel lookup={lookup} onFavorite={handleFavorite} />
    </>
  )
}
