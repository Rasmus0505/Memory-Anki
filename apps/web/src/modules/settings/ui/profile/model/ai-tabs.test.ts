import { describe, expect, it } from 'vitest'
import { normalizeAiSearchParams, resolveAiTab } from './ai-tabs'

describe('ai-tabs', () => {
  it.each([
    ['tab=prompts', 'scenes'],
    ['tab=config&aiTab=models', 'models'],
    ['tab=config&aiTab=quality', 'observability'],
    ['aiTab=scenes', 'scenes'],
  ])('normalizes legacy params %s', (query, expected) => {
    expect(resolveAiTab(new URLSearchParams(query))).toBe(expected)
  })

  it('preserves unrelated params while normalizing', () => {
    const next = normalizeAiSearchParams(new URLSearchParams('tab=config&aiTab=scenes&from=review'), 'scenes')
    expect(next.get('tab')).toBe('scenes')
    expect(next.get('from')).toBe('review')
    expect(next.has('aiTab')).toBe(false)
  })
})