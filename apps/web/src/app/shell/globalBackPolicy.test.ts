import { describe, expect, it } from 'vitest'
import { resolveGlobalBackPolicy } from './globalBackPolicy'

describe('resolveGlobalBackPolicy', () => {
  it.each(['/', '/dashboard', '/freestyle', '/palaces', '/palaces/new', '/knowledge', '/english', '/english/listening', '/english/reading', '/english-reading', '/review', '/profile'])(
    'hides on main route %s',
    (pathname) => expect(resolveGlobalBackPolicy(pathname)).toBeNull(),
  )

  it.each([
    ['/freestyle/session', '/freestyle'],
    ['/palaces/list', '/palaces'],
    ['/batch-generation', '/palaces/new'],
    ['/english/courses/12', '/english/listening'],
    ['/english/listening/courses/12', '/english/listening'],
    ['/english/reading/materials/9', '/english/reading'],
    ['/review/session/4', '/review'],
    ['/review/feedback-preview', '/review'],
    ['/profile/timer', '/profile'],
    ['/profile/feedback', '/profile'],
    ['/profile/ai', '/profile'],
    ['/profile/backups', '/profile'],
    ['/palaces/12', '/palaces'],
    ['/palaces/12/edit', '/palaces/12'],
    ['/palaces/12/practice', '/palaces/12'],
    ['/palaces/12/quiz', '/palaces/12'],
    ['/segments/7/practice', '/palaces'],  ])('maps %s to %s', (pathname, fallbackTo) => {
    expect(resolveGlobalBackPolicy(pathname)?.fallbackTo).toBe(fallbackTo)
  })

  it('ignores unknown routes', () => {
    expect(resolveGlobalBackPolicy('/unknown')).toBeNull()
  })
})
