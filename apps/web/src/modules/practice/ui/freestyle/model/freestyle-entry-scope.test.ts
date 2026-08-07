import { describe, expect, it } from 'vitest'
import { DEFAULT_FREESTYLE_FEED_CONFIG } from '@/modules/practice/domain/feedConfig'
import {
  applyFreestyleEntryScope,
  applyFreestyleEntryScopeUnlessSaved,
  parseFreestyleEntryPalaceId,
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
    }
    const scoped = applyFreestyleEntryScope(config, 42)

    expect(scoped).toMatchObject({
      queue_length: 37,
      mix_mode: 'random',
      specific_palace_ids: [42],
      subject_scope: 'all',
    })
    expect(scoped.content).toEqual(config.content)
    expect(scoped.weights).toEqual(config.weights)
  })

  it('does not change the config without an entry palace', () => {
    const config = DEFAULT_FREESTYLE_FEED_CONFIG
    expect(applyFreestyleEntryScope(config, null)).toBe(config)
  })

  it('keeps a saved palace selection when a restored URL still has an entry palace', () => {
    const config = {
      ...DEFAULT_FREESTYLE_FEED_CONFIG,
      specific_palace_ids: [7, 8],
    }
    expect(applyFreestyleEntryScopeUnlessSaved(config, 42)).toBe(config)
  })

  it('uses the entry palace when no palace scope has been saved', () => {
    const scoped = applyFreestyleEntryScopeUnlessSaved(DEFAULT_FREESTYLE_FEED_CONFIG, 42)
    expect(scoped.specific_palace_ids).toEqual([42])
  })

  it('unlocks an entry palace when the picker changes the palace scope', () => {
    const current = { subject_scope: 'all' as const, specific_palace_ids: [42] }
    expect(shouldUseFreestyleSelectionScope(current, current, 42, null)).toBe(false)
    expect(shouldUseFreestyleSelectionScope(current, { subject_scope: 'all', specific_palace_ids: [42, 43] }, 42, null)).toBe(true)
    expect(shouldUseFreestyleSelectionScope(current, current, 42, 42)).toBe(true)
  })
})
