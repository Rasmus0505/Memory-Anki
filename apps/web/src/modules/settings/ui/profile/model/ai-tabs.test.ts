import { describe, expect, it } from 'vitest'
import { normalizeAiSearchParams, resolveAiTab } from './ai-tabs'

describe('ai-tabs', () => {
  it.each([
    ['tab=access', 'access'],
    ['tab=models', 'models'],
    ['tab=scenes', 'scenes'],
    ['tab=blocks', 'blocks'],
    ['tab=observability', 'observability'],
    ['tab=prompts', 'access'],
    ['tab=config&aiTab=models', 'access'],
    ['aiTab=scenes', 'access'],
  ])('resolves canonical params %s', (query, expected) => {
    expect(resolveAiTab(new URLSearchParams(query))).toBe(expected)
  })

  it('preserves unrelated params while normalizing', () => {
    const next = normalizeAiSearchParams(new URLSearchParams('tab=config&aiTab=scenes&from=review'), 'scenes')
    expect(next.get('tab')).toBe('scenes')
    expect(next.get('from')).toBe('review')
    expect(next.has('aiTab')).toBe(false)
  })
})
