import { describe, expect, it } from 'vitest'
import { DEFAULT_FREESTYLE_FEED_CONFIG } from '@/modules/practice/domain/feedConfig'
import {
  applyFreestyleEntryScope,
  applyFreestyleEntryScopeUnlessSaved,
  parseFreestyleEntryPalaceId,
  persistFreestyleConfigWithoutEntryLock,
  shouldUseFreestyleSelectionScope,
} from './freestyle-entry-scope'

describe('freestyle entry palace scope', () => {
  it('parses a positive palace id from the query string', () => {
    expect(parseFreestyleEntryPalaceId('?palaceId=42')).toBe(42)
    expect(parseFreestyleEntryPalaceId('palaceId=42&from=shelf')).toBe(42)
  })

  it.each(['', '?palaceId=0', '?palaceId=-2', '?palaceId=1.5', '?palaceId=abc'])('rejects invalid palace ids: %s', (search) => {
    expect(parseFreestyleEntryPalaceId(search)).toBeNull()
  })

  it('only overrides the palace scope and preserves freestyle settings', () => {
    const config = {
      ...DEFAULT_FREESTYLE_FEED_CONFIG,
      queue_length: 37,
      mix_mode: 'random' as const,
      specific_palace_ids: [7, 8],
      streams: {
        ...DEFAULT_FREESTYLE_FEED_CONFIG.streams,
        memory_palace: {
          ...DEFAULT_FREESTYLE_FEED_CONFIG.streams.memory_palace,
          specific_palace_ids: [7, 8],
          subject_ids: [2],
        },
        quiz: {
          ...DEFAULT_FREESTYLE_FEED_CONFIG.streams.quiz,
          specific_palace_ids: [7],
        },
      },
    }
    const scoped = applyFreestyleEntryScope(config, 42)

    expect(scoped).toMatchObject({
      queue_length: 37,
      mix_mode: 'random',
      specific_palace_ids: [42],
      subject_scope: 'all',
      subject_ids: [],
    })
    expect(scoped.streams.memory_palace.specific_palace_ids).toEqual([42])
    expect(scoped.streams.memory_palace.subject_ids).toEqual([])
    expect(scoped.streams.quiz.specific_palace_ids).toEqual([42])
    expect(scoped.streams.english.specific_palace_ids).toEqual([42])
    expect(scoped.content).toEqual(config.content)
    expect(scoped.weights).toEqual(config.weights)
  })

  it('does not change the config without an entry palace', () => {
    const config = DEFAULT_FREESTYLE_FEED_CONFIG
    expect(applyFreestyleEntryScope(config, null)).toBe(config)
  })

  it('overrides a saved palace selection for knowledge-page review', () => {
    const config = {
      ...DEFAULT_FREESTYLE_FEED_CONFIG,
      specific_palace_ids: [7, 8],
      streams: {
        ...DEFAULT_FREESTYLE_FEED_CONFIG.streams,
        memory_palace: {
          ...DEFAULT_FREESTYLE_FEED_CONFIG.streams.memory_palace,
          specific_palace_ids: [7, 8],
        },
      },
    }
    const scoped = applyFreestyleEntryScopeUnlessSaved(config, 42)
    expect(scoped.specific_palace_ids).toEqual([42])
    expect(scoped.streams.memory_palace.specific_palace_ids).toEqual([42])
  })

  it('uses the entry palace when no palace scope has been saved', () => {
    const scoped = applyFreestyleEntryScopeUnlessSaved(DEFAULT_FREESTYLE_FEED_CONFIG, 42)
    expect(scoped.specific_palace_ids).toEqual([42])
    expect(scoped.streams.memory_palace.specific_palace_ids).toEqual([42])
    expect(scoped.streams.quiz.specific_palace_ids).toEqual([42])
  })

  it('keeps stored palace streams when persisting other settings', () => {
    const stored = {
      ...DEFAULT_FREESTYLE_FEED_CONFIG,
      specific_palace_ids: [7, 8],
      streams: {
        ...DEFAULT_FREESTYLE_FEED_CONFIG.streams,
        memory_palace: {
          ...DEFAULT_FREESTYLE_FEED_CONFIG.streams.memory_palace,
          specific_palace_ids: [7, 8],
        },
      },
    }
    const session = applyFreestyleEntryScope({ ...stored, queue_length: 40 }, 42)
    const persisted = persistFreestyleConfigWithoutEntryLock(session, stored)
    expect(persisted.queue_length).toBe(40)
    expect(persisted.specific_palace_ids).toEqual([7, 8])
    expect(persisted.streams.memory_palace.specific_palace_ids).toEqual([7, 8])
    expect(persisted.streams.quiz.specific_palace_ids).toEqual([])
  })

  it('unlocks an entry palace when the picker changes the palace scope', () => {
    const current = { subject_scope: 'all' as const, specific_palace_ids: [42] }
    expect(shouldUseFreestyleSelectionScope(current, current, 42, null)).toBe(false)
    expect(shouldUseFreestyleSelectionScope(current, { subject_scope: 'all', specific_palace_ids: [42, 43] }, 42, null)).toBe(true)
    expect(shouldUseFreestyleSelectionScope(current, current, 42, 42)).toBe(true)
  })

  it('unlocks an entry palace when stream subject chips change', () => {
    const current = applyFreestyleEntryScope(DEFAULT_FREESTYLE_FEED_CONFIG, 42)
    const requested = {
      ...current,
      streams: {
        ...current.streams,
        memory_palace: {
          ...current.streams.memory_palace,
          subject_ids: [2],
        },
      },
    }
    expect(shouldUseFreestyleSelectionScope(current, requested, 42, null)).toBe(true)
  })
})
