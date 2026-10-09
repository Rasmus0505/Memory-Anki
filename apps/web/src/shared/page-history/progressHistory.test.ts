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

  it('treats a refresh/deep link as an independent section root', () => {
    const path = '/progress?subjectId=3'
    const section = resolveNavigationSection('/progress')
    const state = createSectionNavigationHistoryState({ key: 'refresh', fullPath: path }, section)
    expect(section).toBe('progress')
    expect(getNavigationSectionLabel('progress')).toBe('进度')
    expect(describeNavigationPath(path)).toBe('进度')
    expect(getActiveSectionRootPath(state)).toBe('/progress')
    expect(resolveSectionHierarchicalParent(path)).toBeNull()
    expect(canSectionNavigateBack(state)).toBe(false)
    expect(peekSectionBackTarget(state)).toBeNull()
  })

  it('keeps insight history separate when entering progress', () => {
    const initial = createSectionNavigationHistoryState(
      { key: 'exam', fullPath: '/exam' }, 'review',
    )
    const state = applySectionNavigationTransition(
      initial, { key: 'progress', fullPath: '/progress' }, 'progress', 'PUSH',
    )
    expect(state.stacks.review).toEqual(initial.stacks.review)
    expect(state.stacks.progress?.entries.map((entry) => entry.fullPath)).toEqual(['/progress'])
    expect(peekSectionBackTarget(state)).toBeNull()
  })

  it('provides an in-section parent for an unknown deep descendant', () => {
    expect(resolveSectionHierarchicalParent('/progress/unknown')).toBe('/progress')
    expect(getSectionHierarchyChain('/progress/unknown')).toEqual(['/progress', '/progress/unknown'])
  })
})
