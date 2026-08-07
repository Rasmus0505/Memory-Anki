import type { FreestyleFeedConfig } from '@/shared/api/contracts'

type FreestylePalaceScopeConfig = Pick<FreestyleFeedConfig, 'specific_palace_ids' | 'subject_scope'>

/** Read the optional palace lock carried by a shelf-to-freestyle entry. */
export function parseFreestyleEntryPalaceId(search: string): number | null {
  const raw = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('palaceId')
  if (!raw || !/^\d+$/.test(raw)) return null
  const palaceId = Number(raw)
  return Number.isSafeInteger(palaceId) && palaceId > 0 ? palaceId : null
}

/** Keep the user's freestyle settings while narrowing this round to one palace. */
export function applyFreestyleEntryScope(
  config: FreestyleFeedConfig,
  palaceId: number | null,
): FreestyleFeedConfig {
  if (palaceId == null) return config
  return {
    ...config,
    specific_palace_ids: [palaceId],
    subject_scope: 'all',
  }
}

/**
 * A shelf link is a one-time narrowing hint. Once freestyle has a saved
 * palace/subject scope, that durable selection wins over a stale query string
 * left in a browser refresh or restored workspace URL.
 */
export function applyFreestyleEntryScopeUnlessSaved(
  config: FreestyleFeedConfig,
  palaceId: number | null,
): FreestyleFeedConfig {
  if (palaceId == null) return config
  if (config.subject_scope !== 'all' || config.specific_palace_ids.length > 0) return config
  return applyFreestyleEntryScope(config, palaceId)
}

/**
 * An entry palace is the initial default only. An explicit picker change
 * unlocks the page so later saves and preference events keep that selection.
 */
export function shouldUseFreestyleSelectionScope(
  current: FreestylePalaceScopeConfig,
  requested: FreestylePalaceScopeConfig,
  entryPalaceId: number | null,
  unlockedEntryPalaceId: number | null,
) {
  if (entryPalaceId == null) return true
  if (unlockedEntryPalaceId === entryPalaceId) return true
  const currentIds = [...current.specific_palace_ids].sort((left, right) => left - right)
  const requestedIds = [...requested.specific_palace_ids].sort((left, right) => left - right)
  return current.subject_scope !== requested.subject_scope
    || currentIds.length !== requestedIds.length
    || currentIds.some((id, index) => id !== requestedIds[index])
}
