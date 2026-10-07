import { describe, expect, it } from 'vitest'
import { withActiveResidentRoute, isAlwaysResidentRoute } from './AppRouter'
import type { Location } from 'react-router-dom'

function loc(pathname: string): Location {
  return { pathname, search: '', hash: '', state: null, key: pathname }
}

describe('resident route entry identity', () => {
  it('preserves the identity of routes that did not change', () => {
    const first = withActiveResidentRoute({}, loc('/freestyle'), 1, 1000)
    const freestyleEntry = first['/freestyle']

    // Navigate to another route. The freestyle entry must be the SAME object,
    // so a memoised subtree for it is not invalidated.
    const second = withActiveResidentRoute(first, loc('/dashboard'), 2, 2000)
    expect(second['/freestyle']).toBe(freestyleEntry)
  })

  it('returns the same map when the exact same location is re-applied', () => {
    const same = loc('/freestyle')
    const routes = withActiveResidentRoute({}, same, 1, 1000)
    const again = withActiveResidentRoute(routes, same, 1, 1000)
    expect(again).toBe(routes)
  })

  it('recognises the pinned freestyle workspaces', () => {
    expect(isAlwaysResidentRoute('/freestyle')).toBe(true)
    expect(isAlwaysResidentRoute('/freestyle-2')).toBe(true)
  })
})
