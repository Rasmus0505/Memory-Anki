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

export function lookupVoiceUrl(query: string, accent: 'us' | 'uk' = 'us'): string {
  return `/api/v1/english-lookup/voice?q=${encodeURIComponent(query)}&accent=${accent}`
}

export function lookupVoicePair(query: string): { us: string; uk: string } {
  return { us: lookupVoiceUrl(query, 'us'), uk: lookupVoiceUrl(query, 'uk') }
}

export function proxiedLookupAudioUrl(src: string | null | undefined): string | null {
  if (!src) return null
  const trimmed = src.trim()
  if (!trimmed) return null
  if (
    trimmed.startsWith('/api/v1/english-lookup/audio') ||
    trimmed.startsWith('/api/v1/english-lookup/voice') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('data:')
  ) {
    return trimmed
  }
  return `/api/v1/english-lookup/audio?url=${encodeURIComponent(trimmed)}`
}

export function mergeLookupAudio(
  current: { us: string | null; uk: string | null } | null | undefined,
  next?: { us: string | null; uk: string | null } | null,
): { us: string | null; uk: string | null } {
  return {
    us: current?.us || next?.us || null,
    uk: current?.uk || next?.uk || null,
  }
}
