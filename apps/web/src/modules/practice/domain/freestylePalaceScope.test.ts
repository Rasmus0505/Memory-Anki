import { describe, expect, it } from 'vitest'
import { freestylePalaceScopeSignature, sanitizeFreestyleFeedConfig } from './feedConfig'

describe('freestyle palace scope', () => {
  it('ignores selected palace ordering', () => {
    const first = sanitizeFreestyleFeedConfig({ specific_palace_ids: [40, 41] })
    const second = sanitizeFreestyleFeedConfig({ specific_palace_ids: [41, 40] })

    expect(freestylePalaceScopeSignature(first)).toBe(freestylePalaceScopeSignature(second))
  })

  it('changes when selected palaces or subject scope changes', () => {
    const first = sanitizeFreestyleFeedConfig({ specific_palace_ids: [40] })
    const differentPalace = sanitizeFreestyleFeedConfig({ specific_palace_ids: [41] })
    const differentSubject = sanitizeFreestyleFeedConfig({ subject_scope: 'non_english' })

    expect(freestylePalaceScopeSignature(first)).not.toBe(
      freestylePalaceScopeSignature(differentPalace),
    )
    expect(freestylePalaceScopeSignature(first)).not.toBe(
      freestylePalaceScopeSignature(differentSubject),
    )
  })
})
