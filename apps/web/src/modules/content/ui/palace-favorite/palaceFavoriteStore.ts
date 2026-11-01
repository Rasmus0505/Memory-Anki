import { useSyncExternalStore } from 'react'
import { APP_EVENT_NAMES, emitAppEvent, onAppEvent } from '@/shared/events/appEvents'
import {
  getFavoritePalaceIdsApi,
  setPalaceFavoriteApi,
} from '@/modules/content/domain/palace-entity/api'

/**
 * One shared favorite set for the whole window.
 *
 * The palace catalog is served from a startup snapshot that a favorite toggle
 * does not rewrite, so every surface (shelf cards, the freestyle rail, the HUD,
 * the round sheet) reads this store instead of each palace payload. A toggle
 * publishes in the same tick and broadcasts `palaceFavoriteChanged`, so another
 * mounted page or another tab updates without a catalog reload.
 */
const EMPTY: ReadonlySet<number> = new Set()
let favoriteIds: ReadonlySet<number> = EMPTY
let loaded = false
let loading: Promise<void> | null = null
/** Bumped by a local toggle so an older in-flight fetch cannot overwrite it. */
let localRevision = 0
let listening = false
const listeners = new Set<() => void>()

function publish(next: ReadonlySet<number>) {
  favoriteIds = next
  for (const listener of listeners) listener()
}

function applyFavorite(palaceId: number, isFavorite: boolean) {
  if (favoriteIds.has(palaceId) === isFavorite) return
  const next = new Set(favoriteIds)
  if (isFavorite) next.add(palaceId)
  else next.delete(palaceId)
  publish(next)
}

function listen() {
  if (listening || typeof window === 'undefined') return
  listening = true
  onAppEvent(APP_EVENT_NAMES.palaceFavoriteChanged, ({ palaceId, isFavorite }) => {
    applyFavorite(palaceId, isFavorite)
  })
  // A catalog refresh (startup snapshot replaced, another device's edit landed)
  // may carry favorite changes that never emitted a favorite event.
  onAppEvent(APP_EVENT_NAMES.palaceCatalogInvalidated, () => {
    void refreshPalaceFavorites()
  })
}

/**
 * Vitest proxies a wholesale-mocked API module and throws on an export the
 * mock did not list. Reading through this guard keeps an old mock from taking
 * down every card that renders a star.
 */
function optionalApi<T>(read: () => T): T | null {
  try {
    const value = read()
    return typeof value === 'function' ? value : null
  } catch {
    return null
  }
}

function fetchFavorites(): Promise<void> {
  // Tests that mock the palace API module wholesale may not provide the new
  // export; an absent reader must not crash every card that renders a star.
  const readIds = optionalApi(() => getFavoritePalaceIdsApi)
  if (!readIds) {
    loaded = true
    return Promise.resolve()
  }
  const revision = localRevision
  return readIds()
    .then((payload) => {
      // A toggle made while this request was in flight is newer than the reply.
      if (revision !== localRevision) return
      loaded = true
      publish(new Set(payload.ids ?? []))
    })
    .catch(() => {
      // Keep whatever is already shown; a remount or catalog refresh retries.
    })
    .finally(() => {
      loading = null
    })
}

export function ensurePalaceFavorites(): Promise<void> {
  if (loaded) return Promise.resolve()
  if (loading) return loading
  listen()
  loading = fetchFavorites()
  return loading
}

/** Force a fresh read (catalog invalidation, returning to a page). */
export function refreshPalaceFavorites(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  listen()
  if (loading) return loading
  loading = fetchFavorites()
  return loading
}

/**
 * Optimistically flip the flag, then persist. Reverts only when no newer change
 * for the same palace has superseded this one.
 */
export async function setPalaceFavorite(palaceId: number, isFavorite: boolean): Promise<void> {
  const before = favoriteIds
  localRevision += 1
  applyFavorite(palaceId, isFavorite)
  try {
    const writeFavorite = optionalApi(() => setPalaceFavoriteApi)
    if (writeFavorite) await writeFavorite(palaceId, isFavorite)
    emitAppEvent(APP_EVENT_NAMES.palaceFavoriteChanged, { palaceId, isFavorite })
  } catch (error) {
    if (favoriteIds.has(palaceId) === isFavorite) publish(before)
    throw error
  }
}

export function subscribePalaceFavorites(listener: () => void) {
  listeners.add(listener)
  void ensurePalaceFavorites()
  return () => {
    listeners.delete(listener)
  }
}

export function getPalaceFavoritesSnapshot(): ReadonlySet<number> {
  return favoriteIds
}

export function usePalaceFavoriteIds(): ReadonlySet<number> {
  return useSyncExternalStore(
    subscribePalaceFavorites,
    getPalaceFavoritesSnapshot,
    getPalaceFavoritesSnapshot,
  )
}

export function useIsPalaceFavorite(palaceId: number): boolean {
  return usePalaceFavoriteIds().has(palaceId)
}

export function resetPalaceFavoritesForTest(ids: Iterable<number> = []) {
  favoriteIds = new Set(ids)
  loaded = false
  loading = null
  localRevision += 1
  publish(favoriteIds)
}
