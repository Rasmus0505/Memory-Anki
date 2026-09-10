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
  palaceId: number,
  subjectScope: T['subject_scope'],
): T {
  return copyStreamScope(target, {
    specific_palace_ids: [palaceId],
    subject_scope: subjectScope,
    subject_ids: [],
  })
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
    subject_ids: [],
    streams: {
      ...config.streams,
      memory_palace: lockStreamScope(config.streams.memory_palace, palaceId, 'all'),
      quiz: lockStreamScope(config.streams.quiz, palaceId, 'all'),
      english: lockStreamScope(config.streams.english, palaceId, 'english'),
    },
  }
}

/**
 * Knowledge-page review is an explicit lock for this round.
 * A saved 随心 palace/subject selection must not keep showing every task.
 */
export function applyFreestyleEntryScopeUnlessSaved(
  config: FreestyleFeedConfig,
  palaceId: number | null,
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
  entryPalaceId: number | null,
  unlockedEntryPalaceId: number | null,
) {
  if (entryPalaceId == null) return true
  if (unlockedEntryPalaceId === entryPalaceId) return true
  return palaceScopeKey(current) !== palaceScopeKey(requested)
}
