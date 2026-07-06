import { describe, expect, it } from 'vitest'

import { API_BASE, normalizeApiOrigin } from './http'

describe('API_BASE', () => {
  it('uses the same-origin API by default', () => {
    expect(API_BASE).toBe('/api/v1')
  })

  it('normalizes configured cloud API origins', () => {
    expect(normalizeApiOrigin('https://memory-anki-api.onrender.com/')).toBe(
      'https://memory-anki-api.onrender.com',
    )
  })
})
