const STORAGE_KEY = 'memory-anki.freestyle.reveal-map.v1'
const MAX_CARDS = 40

function readAll(): Record<string, Record<string, string>> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, Record<string, string>> = {}
    Object.entries(parsed as Record<string, unknown>).forEach(([cardId, map]) => {
      if (!cardId || !map || typeof map !== 'object' || Array.isArray(map)) return
      const cleaned = Object.fromEntries(
        Object.entries(map as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      )
      if (Object.keys(cleaned).length) out[cardId] = cleaned
    })
    return out
  } catch {
    return {}
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
  } catch {
    // Ignore quota / private-mode failures.
  }
}
