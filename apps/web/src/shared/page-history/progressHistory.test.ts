import { describe, expect, it } from 'vitest'
import { resolveNavigationSection } from './navigationSection'
import {
  readLastPageHistoryWorkspacePath,
  readPageHistorySectionUrl,
  recordPageHistorySectionVisit,
  resetPageHistoryStoreForTest,
} from './pageHistoryStore'
import {
  describeNavigationPath,
  getNavigationSectionLabel,
  getSectionHierarchyChain,
  resolveSectionHierarchicalParent,
} from './sectionRouteHierarchy'
import {
  applySectionNavigationTransition,
  canSectionNavigateBack,
  createSectionNavigationHistoryState,
  getActiveSectionRootPath,
  peekSectionBackTarget,
} from './sectionNavigationHistory'

describe('progress navigation history', () => {
  it('persists every progress UI query parameter for startup and section restoration', () => {
    resetPageHistoryStoreForTest()
    const path = '/progress?scope=quiz&view=distribution&selected=unit%3A4&q=test&filter=due&sort=title'
    recordPageHistorySectionVisit('progress', path)
    expect(readPageHistorySectionUrl('progress')).toBe(path)
    expect(readLastPageHistoryWorkspacePath()).toBe(path)
    resetPageHistoryStoreForTest()
  })

  it('treats the today plan as the progress section root', () => {
    const section = resolveNavigationSection('/dashboard')
    const state = createSectionNavigationHistoryState(
      { key: 'refresh', fullPath: '/dashboard' }, section,
    )
    expect(section).toBe('progress')
    expect(getNavigationSectionLabel('progress')).toBe('进度')
    expect(describeNavigationPath('/dashboard')).toBe('今日学案')
    expect(getActiveSectionRootPath(state)).toBe('/dashboard')
    expect(resolveSectionHierarchicalParent('/dashboard')).toBeNull()
    expect(canSectionNavigateBack(state)).toBe(false)
    expect(peekSectionBackTarget(state)).toBeNull()
  })

  it('groups study progress and exam beneath today plan', () => {
    expect(resolveSectionHierarchicalParent('/progress?scope=quiz')).toBe('/dashboard')
    expect(resolveSectionHierarchicalParent('/exam')).toBe('/dashboard')
    expect(getSectionHierarchyChain('/progress?scope=quiz')).toEqual([
      '/dashboard', '/progress?scope=quiz',
    ])
    expect(getSectionHierarchyChain('/exam')).toEqual(['/dashboard', '/exam'])
  })

  it('provides an in-section parent for an unknown deep descendant', () => {
    expect(resolveSectionHierarchicalParent('/progress/unknown')).toBe('/dashboard')
    expect(getSectionHierarchyChain('/progress/unknown')).toEqual([
      '/dashboard', '/progress/unknown',
    ])
  })
})
