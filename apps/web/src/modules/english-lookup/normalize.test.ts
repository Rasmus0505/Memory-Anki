import { describe, expect, it } from 'vitest'
import {
  countLookupWords,
  isValidLookupQuery,
  mergeLookupAudio,
  normalizeLookupQuery,
  preferredAudioUrl,
  lookupVoiceUrl,
  proxiedLookupAudioUrl,
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

  it('proxies third-party mp3s through the local audio route', () => {
    expect(proxiedLookupAudioUrl('https://cn.bing.com/dict/mediamp3?blob=x')).toBe(
      '/api/v1/english-lookup/audio?url=https%3A%2F%2Fcn.bing.com%2Fdict%2Fmediamp3%3Fblob%3Dx',
    )
    expect(proxiedLookupAudioUrl('/api/v1/english-lookup/audio?url=already')).toBe(
      '/api/v1/english-lookup/audio?url=already',
    )
    expect(lookupVoiceUrl('wrestle', 'us')).toBe('/api/v1/english-lookup/voice?q=wrestle&accent=us')
    expect(proxiedLookupAudioUrl('/api/v1/english-lookup/voice?q=wrestle&accent=us')).toBe(
      '/api/v1/english-lookup/voice?q=wrestle&accent=us',
    )
    expect(mergeLookupAudio({ us: null, uk: 'k' }, { us: 'u', uk: null })).toEqual({
      us: 'u',
      uk: 'k',
    })
  })
})
