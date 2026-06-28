const warmedPromises = new Map<string, Promise<unknown>>()

export function prefetchPromise<T>(cacheKey: string, loader: () => Promise<T>) {
  if (warmedPromises.has(cacheKey)) return
  const pending = loader().catch((error) => {
    if (warmedPromises.get(cacheKey) === pending) {
      warmedPromises.delete(cacheKey)
    }
    throw error
  })
  warmedPromises.set(cacheKey, pending)
  void pending.catch(() => {})
}

export function consumePrefetchedPromise<T>(cacheKey: string, loader: () => Promise<T>) {
  const warmed = warmedPromises.get(cacheKey) as Promise<T> | undefined
  if (!warmed) return loader()
  warmedPromises.delete(cacheKey)
  return warmed
}

export function peekPrefetchedPromise<T>(cacheKey: string) {
  return warmedPromises.get(cacheKey) as Promise<T> | undefined
}

export function clearPromiseWarmupCacheForTest() {
  warmedPromises.clear()
}
