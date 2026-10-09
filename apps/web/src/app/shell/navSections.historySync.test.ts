import { describe, expect, it } from 'vitest'
import {
  getNavigationSectionRoot,
  resolveNavigationSection,
} from '@/shared/page-history/navigationSection'
import { navSections } from './navSections'

/** Guard against drift between shell matchers and section-scoped history. */
const SAMPLE_PATHS = [
  '/freestyle',
  '/palaces',
  '/palaces/list',
  '/palaces/42',
  '/knowledge',
  '/knowledge/tree/1',
  '/english',
  '/english/listening',
  '/palaces/new',
  '/palaces/42/edit',
  '/palaces/42/quiz',
  '/',
  '/dashboard',
  '/progress',
  '/progress/unknown',
  '/freestyle?palaceId=9',
  '/profile',
  '/profile/backups',
]

describe('navSections ↔ navigationSection sync', () => {
  it('resolves the same section key for primary shell routes', () => {
    for (const pathname of SAMPLE_PATHS) {
      const fromShell = navSections.find((section) => section.matches(pathname))?.key ?? null
      expect(resolveNavigationSection(pathname)).toBe(fromShell)
    }
  })

  it('exposes progress separately from the insight section', () => {
    expect(navSections.find((section) => section.to === '/progress')).toMatchObject({
      key: 'progress', label: '进度', rememberLastVisited: true,
    })
    expect(navSections.filter((section) => section.matches('/progress')).map((section) => section.key))
      .toEqual(['progress'])
    expect(resolveNavigationSection('/dashboard')).toBe('review')
    expect(resolveNavigationSection('/growth')).toBeNull()
  })

  it('keeps section home paths aligned with navSections[].to', () => {
    for (const section of navSections) {
      expect(getNavigationSectionRoot(section.key)).toBe(section.to)
    }
  })
})
