import { useSyncExternalStore } from 'react'
import { getUnitReviewPreviewApi, type UnitReviewSessionDto } from '@/modules/practice/public'
import type { FreestyleCard } from '@/shared/api/contracts'
import { createVersionedCache } from '@/shared/persistence/versionedCacheStore'

/**
 * Read-only unit previews so a feed card can draw its real map while it slides in,
 * before the encounter is opened on activation. Keyed by unit revision: a map edited
 * on the other device (Syncthing) bumps the revision and is never shown stale.
 */
const cache = createVersionedCache<UnitReviewSessionDto>('freestyle-unit-preview')
const inFlight = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()
let version = 0
let hydrated: Promise<void> | null = null

function notify() {
  version += 1
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function readUnitPreview(unitId: string | null | undefined, revision: number | null | undefined) {
  if (!unitId || revision == null) return null
  return cache.getSync(unitId, revision)
}

/** Re-renders when any preview lands; the lookup itself is synchronous. */
export function useUnitPreview(unitId: string | null | undefined, revision: number | null | undefined) {
  useSyncExternalStore(subscribe, () => version, () => version)
  return readUnitPreview(unitId, revision)
}

/** Copies persisted previews into memory once, so a reload paints maps from disk. */
export function hydrateUnitPreviews() {
  hydrated ??= cache.hydrate().then(notify)
  return hydrated
}

export function prefetchUnitPreview(unitId: string, revision: number): Promise<void> {
  if (cache.getSync(unitId, revision)) return Promise.resolve()
  const key = `${unitId}:${revision}`
  const pending = inFlight.get(key)
  if (pending) return pending
  const promise = getUnitReviewPreviewApi(unitId)
    .then((preview) => {
      const unit = preview.units.find((item) => item.id === unitId)
      if (!unit) return
      // Store under the revision the server actually returned; a newer revision than
      // the card knows about is still valid for that newer card after a rebuild.
      cache.put(unitId, unit.revision, preview)
      notify()
    })
    .catch(() => undefined)
    .finally(() => inFlight.delete(key))
  inFlight.set(key, promise)
  return promise
}

function previewTargets(cards: readonly FreestyleCard[], centerIndex: number) {
  const targets: Array<{ unitId: string; revision: number; distance: number }> = []
  cards.forEach((card, index) => {
    const unitId = 'unit_id' in card ? card.unit_id : null
    const revision = 'unit_revision' in card ? card.unit_revision : null
    if (card.type !== 'mindmap_branch' || !unitId || revision == null) return
    targets.push({ unitId, revision, distance: Math.abs(index - centerIndex) })
  })
  return targets.sort((a, b) => a.distance - b.distance)
}

/**
 * Background preload of the whole round, nearest cards first, two at a time so it
 * never competes with the active card's own session request.
 */
export async function prefetchRoundPreviews(
  cards: readonly FreestyleCard[],
  centerIndex: number,
  { signal, concurrency = 2 }: { signal?: AbortSignal; concurrency?: number } = {},
) {
  await hydrateUnitPreviews()
  const queue = previewTargets(cards, centerIndex).filter(
    (target) => !cache.getSync(target.unitId, target.revision),
  )
  const worker = async () => {
    while (queue.length && !signal?.aborted) {
      const next = queue.shift()!
      await prefetchUnitPreview(next.unitId, next.revision)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker))
}
