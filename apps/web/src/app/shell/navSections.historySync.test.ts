import { describe, expect, it } from 'vitest'
import { resolveNavigationSection } from '@/shared/page-history/navigationSection'
import { navSections } from './navSections'

/** Guard against drift between shell matchers and section-scoped history. */
const SAMPLE_PATHS = [
  '/freestyle',
  '/freestyle/session',
  '/palaces/12/practice',
  '/segments/3/practice',
  '/palaces',
  '/palaces/list',
  '/palaces/42',
  '/knowledge',
  '/knowledge/tree/1',
  '/english',
  '/english/reading',
  '/english-reading/1',
  '/palaces/new',
  '/palaces/42/edit',
  '/palaces/42/quiz',
  '/batch-generation',
  '/',
  '/dashboard',
  '/review',
  '/review/session/9',
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
})
