import { describe, expect, it } from 'vitest'
import {
  getSectionHierarchyChain,
  resolveSectionHierarchicalParent,
} from './sectionRouteHierarchy'

describe('sectionRouteHierarchy', () => {
  it('walks knowledge bookshelf levels', () => {
    expect(resolveSectionHierarchicalParent('/palaces')).toBeNull()
    expect(resolveSectionHierarchicalParent('/palaces/list?subjectId=3')).toBe('/palaces')
    expect(resolveSectionHierarchicalParent('/palaces/42?subjectId=3')).toBe(
      '/palaces/list?subjectId=3',
    )
    expect(resolveSectionHierarchicalParent('/knowledge?subjectId=1')).toBe('/palaces')
    expect(getSectionHierarchyChain('/palaces/list?subjectId=3')).toEqual([
      '/palaces',
      '/palaces/list?subjectId=3',
    ])
  })

  it('walks english listening and reading levels', () => {
    expect(resolveSectionHierarchicalParent('/english/listening')).toBe('/english')
    expect(resolveSectionHierarchicalParent('/english/listening/courses/7')).toBe(
      '/english/listening',
    )
    expect(resolveSectionHierarchicalParent('/english/reading/materials/9')).toBe(
      '/english/reading',
    )
    expect(getSectionHierarchyChain('/english/listening/courses/7')).toEqual([
      '/english',
      '/english/listening',
      '/english/listening/courses/7',
    ])
  })

  it('walks create and insight levels', () => {
    expect(resolveSectionHierarchicalParent('/palaces/12/edit')).toBe('/palaces/new')
    expect(resolveSectionHierarchicalParent('/palaces/12/quiz')).toBe('/palaces/12/edit')
    expect(resolveSectionHierarchicalParent('/today')).toBe('/dashboard')
    expect(resolveSectionHierarchicalParent('/review')).toBeNull()
    expect(getSectionHierarchyChain('/today')).toEqual([
      '/dashboard',
      '/today',
    ])
  })

})
