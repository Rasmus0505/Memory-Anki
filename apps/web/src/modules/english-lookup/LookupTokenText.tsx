import type { MouseEvent as ReactMouseEvent } from 'react'

const LOOKUP_WORD_RE = /[A-Za-z]+(?:[-'][A-Za-z]+)*/g

function buildLookupTextParts(text: string) {
  const parts: Array<{ kind: 'text' | 'word'; value: string }> = []
  let cursor = 0
  for (const match of text.matchAll(LOOKUP_WORD_RE)) {
    const start = match.index ?? 0
    const value = match[0] ?? ''
    if (start > cursor) {
      parts.push({ kind: 'text', value: text.slice(cursor, start) })
    }
    parts.push({ kind: 'word', value })
    cursor = start + value.length
  }
  if (cursor < text.length) {
    parts.push({ kind: 'text', value: text.slice(cursor) })
  }
  return parts.length > 0 ? parts : [{ kind: 'text' as const, value: text }]
}

/** Clickable English tokens that open Saladict lookup. */
export function LookupTokenText({
  text,
  onLookupWord,
}: {
  text: string
  onLookupWord: (word: string, event: ReactMouseEvent<HTMLElement>) => void
}) {
  const parts = buildLookupTextParts(text)
  return (
    <>
      {parts.map((part, index) =>
        part.kind === 'word' ? (
          <span
            key={`${part.value}-${index}`}
            role="button"
            tabIndex={0}
            data-reading-word="true"
            data-lookup-token="true"
            className="cursor-pointer rounded-md px-0.5 text-inherit transition-colors hover:bg-info/10 hover:text-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/30"
            onClick={(event) => onLookupWord(part.value, event)}
          >
            {part.value}
          </span>
        ) : (
          <span key={`text-${index}`}>{part.value}</span>
        ),
      )}
    </>
  )
}
