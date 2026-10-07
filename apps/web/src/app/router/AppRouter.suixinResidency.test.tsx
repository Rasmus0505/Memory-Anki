import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppRouter, isAlwaysResidentRoute } from '@/app/router/AppRouter'

const GO_PREFIX = 'go:'
/** The single navigation target the mocked shell drives to. */
let navigateTo = '/freestyle'

vi.mock('@/app/router/appRoutes', async () => {
  const residency = await vi.importActual<typeof import('@/shared/routing/RouteResidency')>(
    '@/shared/routing/RouteResidency',
  )

  return {
    preloadPracticeRoutes: vi.fn(),
    preloadEnglishWorkspacePage: vi.fn(),
    preloadFreestylePage: vi.fn(),
    preloadFreestyleSecondaryPage: vi.fn(),
    preloadKnowledgePage: vi.fn(),
    preloadPalaceEditPage: vi.fn(),
    preloadProfilePage: vi.fn(),
    preloadDashboardPage: vi.fn(),
    preloadPalaceListPage: vi.fn(),
    preloadPalaceShelfPage: vi.fn(),
    AppRoutes({ location }: { location?: { pathname: string; search?: string } }) {
      const { isActive, pathname } = residency.useRouteResidency()
      const navigate = useNavigate()
      const live = useLocation()
      const id = location?.pathname ?? pathname
      // Counts real mounts only. A remount means the queue was thrown away.
      const mounts = React.useRef(0)
      React.useEffect(() => {
        mounts.current += 1
      }, [])

      return (
        <section data-testid={`page:${id}`} data-active={String(isActive)}>
          <span data-testid={`mounts:${id}`}>{mounts.current}</span>
          <span data-testid={`live:${id}`}>{live.pathname}</span>
          {isActive ? (
            <button
              type="button"
              data-testid="navigator"
              onClick={() => navigate(navigateTo)}
            >
              {`${GO_PREFIX}${navigateTo}`}
            </button>
          ) : null}
        </section>
      )
    },
  }
})

vi.mock('@/shared/page-history/usePageHistoryAdapter', () => ({
  usePageHistoryAdapter: vi.fn(),
}))

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AppRouter />
    </MemoryRouter>,
  )
}

async function expectActive(id: string) {
  await waitFor(() => {
    expect(screen.getByTestId(`page:${id}`).getAttribute('data-active')).toBe('true')
  })
}

/** Point the active page's navigator at `id`, click it, and wait for arrival. */
async function clickGo(id: string) {
  navigateTo = id
  fireEvent.click(screen.getByTestId('navigator'))
  await expectActive(id)
}

describe('随心 workspace residency', () => {
  it('pins /freestyle and /freestyle-2 as always-resident routes', () => {
    expect(isAlwaysResidentRoute('/freestyle')).toBe(true)
    expect(isAlwaysResidentRoute('/freestyle-2')).toBe(true)
    // Ordinary pages stay evictable.
    expect(isAlwaysResidentRoute('/palaces')).toBe(false)
    expect(isAlwaysResidentRoute('/dashboard')).toBe(false)
    expect(isAlwaysResidentRoute('/palaces/30/edit')).toBe(false)
    // Must not match nested paths that merely start with the name.
    expect(isAlwaysResidentRoute('/freestyle-3')).toBe(false)
  })

  it('keeps both 随心 workspaces mounted when switching between them', async () => {
    renderAt('/freestyle')
    await expectActive('/freestyle')

    await clickGo('/freestyle-2')

    // Both stay mounted: switching is a visibility flip, not a reload.
    expect(screen.getByTestId('mounts:/freestyle').textContent).toBe('1')
    expect(screen.getByTestId('mounts:/freestyle-2').textContent).toBe('1')
    expect(screen.getByTestId('page:/freestyle').getAttribute('data-active')).toBe('false')

    // ...and switching back does not remount either.
    await clickGo('/freestyle')
    expect(screen.getByTestId('mounts:/freestyle').textContent).toBe('1')
    expect(screen.getByTestId('mounts:/freestyle-2').textContent).toBe('1')
  })

  it('never evicts the 随心 workspace, even after many unrelated navigations', async () => {
    renderAt('/freestyle')
    await expectActive('/freestyle')

    for (const route of ['/dashboard', '/palaces', '/knowledge', '/progress', '/exam', '/growth']) {
      await clickGo(route)
      // The 随心 queue must survive every single navigation.
      expect(screen.getByTestId('page:/freestyle')).toBeTruthy()
      expect(screen.getByTestId('mounts:/freestyle').textContent).toBe('1')
      expect(screen.getByTestId('page:/freestyle').getAttribute('data-active')).toBe('false')
    }
  })

  it('still evicts ordinary pages once the resident budget is exceeded', async () => {
    renderAt('/dashboard')
    await expectActive('/dashboard')

    for (const route of ['/palaces', '/knowledge', '/progress', '/exam', '/growth']) {
      await clickGo(route)
    }

    // Ordinary pages are pruned; the newest ones plus the budget survive.
    await waitFor(() => {
      expect(screen.queryByTestId('page:/dashboard')).toBeNull()
    })
    expect(screen.getByTestId('page:/growth')).toBeTruthy()
  })
})
