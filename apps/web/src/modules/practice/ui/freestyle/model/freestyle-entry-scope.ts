import type { FreestyleFeedConfig } from '@/shared/api/contracts'

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
