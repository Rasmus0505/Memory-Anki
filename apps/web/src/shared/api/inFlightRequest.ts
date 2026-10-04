/**
 * In-flight request sharing for read endpoints.
 *
 * Several independent components frequently request the same resource in the
 * same tick — e.g. a freestyle card mounts `useFreestyleUnitReviewNodeQuiz` and
 * `useFreestyleTextToMindMap`, which each open their own
 * `GET /palaces/{id}/quiz-node-bindings`. Every extra copy occupies a database
 * connection for its whole round trip, so on a burst-opened feed the fan-out
 * alone can saturate the pool and stall unrelated requests (2026-10-05: 8
 * identical bindings requests plus 4 ladder-progress requests landed in one
 * minute, the pool ran dry, and everything queued behind a 30s checkout
 * timeout).
 *
 * Unlike `promiseWarmupCache`, entries here are *shared*, not consumed: the same
 * resolved value is handed to every caller that joins while the request is in
 * flight. The moment it settles the entry is dropped, so this never serves
 * stale data — it only collapses concurrent duplicates into one request.
 *
 * Callers that mutate the resource must call `invalidateSharedRequest` so a
 * later read cannot join a response that predates the write.
 */

const inFlightRequests = new Map<string, Promise<unknown>>()

/**
 * Run `loader`, or join an identical request already in flight.
 *
 * The returned promise is shared between callers. Callers must treat the
 * resolved value as read-only, exactly as with a memoized fetch.
 */
export function shareInFlightRequest<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const existing = inFlightRequests.get(key)
  if (existing) return existing as Promise<T>

  const pending = loader()
  inFlightRequests.set(key, pending)
  // Drop the entry as soon as it settles, regardless of outcome: a rejected
  // request must not be replayed to callers who arrive later, and a resolved
  // one must not mask a subsequent mutation.
  const release = () => {
    if (inFlightRequests.get(key) === pending) {
      inFlightRequests.delete(key)
    }
  }
  void pending.then(release, release)
  return pending
}

/** Drop a shared entry so the next caller issues a fresh request. */
export function invalidateSharedRequest(key: string): void {
  inFlightRequests.delete(key)
}

/** Drop every shared entry whose key starts with `prefix`. */
export function invalidateSharedRequestsByPrefix(prefix: string): void {
  for (const key of inFlightRequests.keys()) {
    if (key.startsWith(prefix)) {
      inFlightRequests.delete(key)
    }
  }
}

export function clearSharedRequestsForTest(): void {
  inFlightRequests.clear()
}
