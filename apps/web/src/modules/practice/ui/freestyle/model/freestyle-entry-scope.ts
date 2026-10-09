import type { FreestyleFeedConfig, FreestyleStreamScope } from '@/shared/api/contracts'

type FreestylePalaceScopeConfig = Pick<FreestyleFeedConfig, 'specific_palace_ids' | 'subject_scope'> & {
  streams?: FreestyleFeedConfig['streams']
}

function copyStreamScope<T extends FreestyleStreamScope>(target: T, source: FreestyleStreamScope): T {
  return {
    ...target,
    specific_palace_ids: [...source.specific_palace_ids],
    subject_scope: source.subject_scope,
    subject_ids: [...source.subject_ids],
  }
}

function lockStreamScope<T extends FreestyleStreamScope>(
  target: T,
  palaceIds: readonly number[],
  subjectScope: T['subject_scope'],
): T {
  return copyStreamScope(target, {
    specific_palace_ids: [...palaceIds],
    subject_scope: subjectScope,
    subject_ids: [],
  })
}

export function normalizeFreestyleEntryPalaceIds(
  value: number | readonly number[] | null | undefined,
): number[] {
  if (value == null) return []
  const list = typeof value === 'number' ? [value] : value
  return [...new Set(list.filter((id) => Number.isInteger(id) && id > 0))].sort((left, right) => left - right)
}

export function freestyleEntryScopeKey(
  value: number | readonly number[] | string | null | undefined,
): string | null {
  if (typeof value === 'string') return value || null
  const ids = normalizeFreestyleEntryPalaceIds(value)
  return ids.length ? ids.join(',') : null
}

function palaceScopeKey(config: FreestylePalaceScopeConfig): string {
  if (config.streams) {
    const memory = config.streams.memory_palace
    const quiz = config.streams.quiz
    const english = config.streams.english
    return JSON.stringify({
      memory_palace: {
        specific_palace_ids: [...memory.specific_palace_ids].sort((left, right) => left - right),
        subject_scope: memory.subject_scope,
        subject_ids: [...memory.subject_ids].sort((left, right) => left - right),
      },
      quiz: {
        specific_palace_ids: [...quiz.specific_palace_ids].sort((left, right) => left - right),
        subject_scope: quiz.subject_scope,
        subject_ids: [...quiz.subject_ids].sort((left, right) => left - right),
      },
      english: {
        specific_palace_ids: [...english.specific_palace_ids].sort((left, right) => left - right),
        subject_scope: english.subject_scope,
        subject_ids: [...english.subject_ids].sort((left, right) => left - right),
      },
    })
  }
  return JSON.stringify({
    subject_scope: config.subject_scope,
    specific_palace_ids: [...config.specific_palace_ids].sort((left, right) => left - right),
  })
}

/** Read the optional palace lock carried by a shelf-to-freestyle entry. */
export function parseFreestyleEntryPalaceId(search: string): number | null {
  const ids = parseFreestyleEntryPalaceIds(search, 'palaceId')
  return ids.length === 1 ? ids[0] : null
}

/** Read a one-round stage lock. `palaceId` stays the single-palace path. */
export function parseFreestyleEntryPalaceIds(
  search: string,
  key: 'palaceId' | 'palaceIds' = 'palaceIds',
): number[] {
  const raw = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get(key)
  if (!raw) return []
  return normalizeFreestyleEntryPalaceIds(raw.split(',').map((part) => Number(part)))
}

/** Keep the user's freestyle settings while narrowing this round to these palaces. */
export function applyFreestyleEntryScope(
  config: FreestyleFeedConfig,
  palaceId: number | readonly number[] | null,
): FreestyleFeedConfig {
  const palaceIds = normalizeFreestyleEntryPalaceIds(palaceId)
  if (palaceIds.length === 0) return config
  return {
    ...config,
    specific_palace_ids: palaceIds,
    subject_scope: 'all',
    subject_ids: [],
    streams: {
      ...config.streams,
      memory_palace: lockStreamScope(config.streams.memory_palace, palaceIds, 'all'),
      quiz: lockStreamScope(config.streams.quiz, palaceIds, 'all'),
      english: lockStreamScope(config.streams.english, palaceIds, 'english'),
    },
  }
}

/**
 * Knowledge-page review is an explicit lock for this round.
 * A saved 随心 palace/subject selection must not keep showing every task.
 */
export function applyFreestyleEntryScopeUnlessSaved(
  config: FreestyleFeedConfig,
  palaceId: number | readonly number[] | null,
): FreestyleFeedConfig {
  return applyFreestyleEntryScope(config, palaceId)
}

/** Persist mix/content changes without writing the transient knowledge-page lock. */
export function persistFreestyleConfigWithoutEntryLock(
  sessionConfig: FreestyleFeedConfig,
  stored: FreestyleFeedConfig,
): FreestyleFeedConfig {
  return {
    ...sessionConfig,
    specific_palace_ids: [...stored.specific_palace_ids],
    subject_scope: stored.subject_scope,
    subject_ids: [...stored.subject_ids],
    streams: {
      ...sessionConfig.streams,
      memory_palace: copyStreamScope(sessionConfig.streams.memory_palace, stored.streams.memory_palace),
      quiz: copyStreamScope(sessionConfig.streams.quiz, stored.streams.quiz),
      english: copyStreamScope(sessionConfig.streams.english, stored.streams.english),
    },
  }
}

/**
 * An entry palace is the initial default only. An explicit picker change
 * unlocks the page so later saves and preference events keep that selection.
 */
export function shouldUseFreestyleSelectionScope(
  current: FreestylePalaceScopeConfig,
  requested: FreestylePalaceScopeConfig,
  entryPalaceId: number | readonly number[] | string | null,
  unlockedEntryPalaceId: number | readonly number[] | string | null,
) {
  const entryKey = freestyleEntryScopeKey(entryPalaceId)
  if (entryKey == null) return true
  if (freestyleEntryScopeKey(unlockedEntryPalaceId) === entryKey) return true
  return palaceScopeKey(current) !== palaceScopeKey(requested)
}
