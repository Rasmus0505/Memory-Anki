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

  it('walks create and review levels', () => {
    expect(resolveSectionHierarchicalParent('/palaces/12/edit')).toBe('/palaces/new')
    expect(resolveSectionHierarchicalParent('/palaces/12/quiz')).toBe('/palaces/12/edit')
    expect(resolveSectionHierarchicalParent('/review/session/5')).toBe('/review')
    expect(resolveSectionHierarchicalParent('/review')).toBe('/dashboard')
    expect(getSectionHierarchyChain('/review/session/5')).toEqual([
      '/dashboard',
      '/review',
      '/review/session/5',
    ])
  })

  it('walks freestyle practice back to freestyle home', () => {
    expect(resolveSectionHierarchicalParent('/palaces/3/practice')).toBe('/freestyle')
    expect(resolveSectionHierarchicalParent('/segments/8/practice')).toBe('/freestyle')
  })
})
