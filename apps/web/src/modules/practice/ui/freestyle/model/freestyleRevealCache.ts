const STORAGE_KEY = 'memory-anki.freestyle.reveal-map.v1'
const MAX_CARDS = 40

/**
 * Parsed form of the whole reveal-map blob.
 *
 * Every card change reads one card's entry, and `readAll()` parses the full
 * record for up to MAX_CARDS cards. That is far too much work to repeat on a
 * flip, so the parse is memoised by the raw string and invalidated on write.
 */
let cacheRaw: string | null = null
let cacheParsed: Record<string, Record<string, string>> = {}
let cacheValid = false

function readAll(): Record<string, Record<string, string>> {
  if (typeof window === 'undefined') return {}
  const raw = (() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY)
    } catch {
      return null
    }
  })()
  if (cacheValid && raw === cacheRaw) return cacheParsed
  cacheRaw = raw
  cacheValid = true
  if (!raw) {
    cacheParsed = {}
    return cacheParsed
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      cacheParsed = {}
      return cacheParsed
    }
    const out: Record<string, Record<string, string>> = {}
    Object.entries(parsed as Record<string, unknown>).forEach(([cardId, map]) => {
      if (!cardId || !map || typeof map !== 'object' || Array.isArray(map)) return
      const cleaned = Object.fromEntries(
        Object.entries(map as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      )
      if (Object.keys(cleaned).length) out[cardId] = cleaned
    })
    cacheParsed = out
    return cacheParsed
  } catch {
    cacheParsed = {}
    return cacheParsed
  }
}

export function readFreestyleRevealMap(cardId: string | null | undefined) {
  const id = String(cardId || '').trim()
  if (!id) return null
  return readAll()[id] ?? null
}

export function writeFreestyleRevealMap(cardId: string | null | undefined, map: Record<string, string> | null) {
  const id = String(cardId || '').trim()
  if (!id || typeof window === 'undefined') return
  const all = readAll()
  if (!map || Object.keys(map).length === 0) {
    delete all[id]
  } else {
    all[id] = map
  }
  const keys = Object.keys(all)
  if (keys.length > MAX_CARDS) {
    keys.slice(0, keys.length - MAX_CARDS).forEach((stale) => {
      delete all[stale]
    })
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
    // Keep the memo in step with what we just wrote instead of re-reading it.
    cacheRaw = window.localStorage.getItem(STORAGE_KEY)
    cacheParsed = all
    cacheValid = true
  } catch {
    // Ignore quota / private-mode failures. The memo may now be stale, so drop it.
    cacheValid = false
  }
}
