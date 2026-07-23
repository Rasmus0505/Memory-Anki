import { describe, expect, it } from 'vitest'
import { resolveNavigationSection } from './navigationSection'

describe('resolveNavigationSection', () => {
  it('maps freestyle and practice routes to freestyle', () => {
    expect(resolveNavigationSection('/freestyle')).toBe('freestyle')
    expect(resolveNavigationSection('/freestyle/session')).toBe('freestyle')
    expect(resolveNavigationSection('/palaces/12/practice')).toBe('freestyle')
    expect(resolveNavigationSection('/segments/3/practice')).toBe('freestyle')
  })

  it('maps library and knowledge-tree routes to palaces (知识)', () => {
    expect(resolveNavigationSection('/palaces')).toBe('palaces')
    expect(resolveNavigationSection('/palaces/list')).toBe('palaces')
    expect(resolveNavigationSection('/palaces/42')).toBe('palaces')
    expect(resolveNavigationSection('/knowledge')).toBe('palaces')
    expect(resolveNavigationSection('/knowledge/tree/1')).toBe('palaces')
  })

  it('maps create/edit/quiz routes to knowledge (创建)', () => {
    expect(resolveNavigationSection('/palaces/new')).toBe('knowledge')
    expect(resolveNavigationSection('/palaces/42/edit')).toBe('knowledge')
    expect(resolveNavigationSection('/palaces/42/quiz')).toBe('knowledge')
    expect(resolveNavigationSection('/batch-generation')).toBe('knowledge')
  })

  it('maps english and review/insight hubs', () => {
    expect(resolveNavigationSection('/english')).toBe('english')
    expect(resolveNavigationSection('/english/reading')).toBe('english')
    expect(resolveNavigationSection('/english-reading/1')).toBe('english')
    expect(resolveNavigationSection('/dashboard')).toBe('review')
    expect(resolveNavigationSection('/review')).toBe('review')
    expect(resolveNavigationSection('/review/session/9')).toBe('review')
  })

  it('returns null outside primary nav sections', () => {
    expect(resolveNavigationSection('/profile')).toBeNull()
    expect(resolveNavigationSection('/profile/backups')).toBeNull()
  })
})
