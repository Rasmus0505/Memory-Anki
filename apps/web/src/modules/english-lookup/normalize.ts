const TOKEN_RE = /[A-Za-z]+(?:[-'][A-Za-z]+)*/g
const MAX_LOOKUP_CHARS = 1000

/** Preserve sentence punctuation for translation while normalizing whitespace. */
export function normalizeLookupQuery(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/’/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
}

export function countLookupWords(normalized: string): number {
  if (!normalized) return 0
  return normalized.match(TOKEN_RE)?.length ?? 0
}

export function isValidLookupQuery(normalized: string): boolean {
  return normalized.length > 0 && normalized.length <= MAX_LOOKUP_CHARS && countLookupWords(normalized) > 0
}

export function preferredAudioUrl(audio: {
  us?: string | null
  uk?: string | null
} | null | undefined): string | null {
  if (!audio) return null
  return audio.us || audio.uk || null
}
