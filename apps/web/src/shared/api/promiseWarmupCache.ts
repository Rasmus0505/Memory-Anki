const DEFAULT_WARMUP_TTL_MS = 30_000
const DEFAULT_MAX_WARMED_PROMISES = 24

interface WarmedPromiseEntry {
  promise: Promise<unknown>
  expiresAt: number
  timeoutId: number | null
}

const warmedPromises = new Map<string, WarmedPromiseEntry>()

function deleteEntry(cacheKey: string) {
  const entry = warmedPromises.get(cacheKey)
  if (entry?.timeoutId != null) {
    clearTimeout(entry.timeoutId)
  }
  warmedPromises.delete(cacheKey)
}

function pruneExpiredEntries(now = Date.now()) {
  for (const [cacheKey, entry] of warmedPromises) {
    if (entry.expiresAt <= now) {
      deleteEntry(cacheKey)
    }
  }
}

function pruneOldestEntries(maxEntries = DEFAULT_MAX_WARMED_PROMISES) {
  while (warmedPromises.size > maxEntries) {
    const oldestKey = warmedPromises.keys().next().value as string | undefined
    if (!oldestKey) return
    deleteEntry(oldestKey)
  }
}

export function prefetchPromise<T>(
  cacheKey: string,
  loader: () => Promise<T>,
  options?: { ttlMs?: number; maxEntries?: number },
) {
  pruneExpiredEntries()
  if (warmedPromises.has(cacheKey)) return
  const ttlMs = options?.ttlMs ?? DEFAULT_WARMUP_TTL_MS
  const pending = loader().catch((error) => {
    if (warmedPromises.get(cacheKey)?.promise === pending) {
      deleteEntry(cacheKey)
    }
    throw error
  })
  const timeoutId =
    typeof window === 'undefined'
      ? null
      : window.setTimeout(() => deleteEntry(cacheKey), ttlMs)
  warmedPromises.set(cacheKey, {
    promise: pending,
    expiresAt: Date.now() + ttlMs,
    timeoutId,
  })
  pruneOldestEntries(options?.maxEntries)
  void pending.catch(() => {})
}

export function consumePrefetchedPromise<T>(cacheKey: string, loader: () => Promise<T>) {
  pruneExpiredEntries()
  const warmed = warmedPromises.get(cacheKey)
  if (!warmed) return loader()
  deleteEntry(cacheKey)
  return warmed.promise as Promise<T>
}

export function peekPrefetchedPromise<T>(cacheKey: string) {
  pruneExpiredEntries()
  return warmedPromises.get(cacheKey)?.promise as Promise<T> | undefined
}

export function invalidatePrefetchedPromise(cacheKey: string) {
  deleteEntry(cacheKey)
}

export function clearPrefetchedPromisesByPrefix(prefix: string) {
  for (const cacheKey of warmedPromises.keys()) {
    if (cacheKey.startsWith(prefix)) {
      deleteEntry(cacheKey)
    }
  }
}

export function clearPromiseWarmupCacheForTest() {
  for (const cacheKey of warmedPromises.keys()) {
    deleteEntry(cacheKey)
  }
}
