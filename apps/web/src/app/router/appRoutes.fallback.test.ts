import { describe, expect, it } from 'vitest'
import { resolveRouteFallbackTarget } from '@/app/router/appRoutes'

describe('resolveRouteFallbackTarget', () => {
  it('normalizes trailing slashes back to registered routes', () => {
    expect(resolveRouteFallbackTarget('/knowledge/')).toBe('/knowledge')
    expect(resolveRouteFallbackTarget('/profile/ai/')).toBe('/profile/ai')
    expect(resolveRouteFallbackTarget('/palaces/42/edit/')).toBe('/palaces/42/edit')
  })

  it('falls back unknown knowledge subpaths to the knowledge root', () => {
    expect(resolveRouteFallbackTarget('/knowledge/chapter/9')).toBe('/knowledge')
    expect(resolveRouteFallbackTarget('/knowledge/anything/deeper')).toBe('/knowledge')
  })

  it('trims unknown palace detail descendants back to the palace root page', () => {
    expect(resolveRouteFallbackTarget('/palaces/42/unknown')).toBe('/palaces/42')
    expect(resolveRouteFallbackTarget('/palaces/42/edit/history')).toBe('/palaces/42')
  })

  it('falls back unknown section routes to their section entry page', () => {
    expect(resolveRouteFallbackTarget('/palaces/quiz')).toBe('/palaces')
    expect(resolveRouteFallbackTarget('/review/legacy-mode')).toBe('/review')
    expect(resolveRouteFallbackTarget('/freestyle/legacy-mode')).toBe('/freestyle')
    expect(resolveRouteFallbackTarget('/english/legacy')).toBe('/english')
    expect(resolveRouteFallbackTarget('/totally-unknown')).toBe('/freestyle')
  })

  it('falls back retired mobile PWA routes to the default entry', () => {
    expect(resolveRouteFallbackTarget('/m')).toBe('/freestyle')
    expect(resolveRouteFallbackTarget('/m/palaces')).toBe('/freestyle')
    expect(resolveRouteFallbackTarget('/mobile')).toBe('/freestyle')
    expect(resolveRouteFallbackTarget('/mobile/mindmap')).toBe('/freestyle')
  })

  it('keeps dev-only token routes out of the production fallback allowlist', () => {
    expect(resolveRouteFallbackTarget('/dev/tokens')).toBe('/freestyle')
  })
})
