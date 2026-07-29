import { describe, expect, it } from 'vitest'
import {
  countLookupWords,
  isValidLookupQuery,
  normalizeLookupQuery,
  preferredAudioUrl,
} from './normalize'

describe('english-lookup normalize', () => {
  it('counts hyphen compounds as one word', () => {
    expect(normalizeLookupQuery('  mother-in-law  ')).toBe('mother-in-law')
    expect(countLookupWords('mother-in-law')).toBe(1)
    expect(isValidLookupQuery('mother-in-law')).toBe(true)
  })

  it('preserves sentence punctuation for translation', () => {
    expect(isValidLookupQuery(normalizeLookupQuery('look up to the sky'))).toBe(true)
    expect(normalizeLookupQuery('  How are you?  ')).toBe('How are you?')
    expect(isValidLookupQuery(normalizeLookupQuery('one two three four five six'))).toBe(true)
  })

  it('prefers US audio', () => {
    expect(preferredAudioUrl({ us: 'u', uk: 'k' })).toBe('u')
    expect(preferredAudioUrl({ us: null, uk: 'k' })).toBe('k')
    expect(preferredAudioUrl({})).toBe(null)
  })
})
