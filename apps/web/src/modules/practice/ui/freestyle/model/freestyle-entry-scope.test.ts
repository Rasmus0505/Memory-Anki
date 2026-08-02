import { describe, expect, it } from 'vitest'
import { DEFAULT_FREESTYLE_FEED_CONFIG } from '@/modules/practice/domain/feedConfig'
import {
  applyFreestyleEntryScope,
  parseFreestyleEntryPalaceId,
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
})
