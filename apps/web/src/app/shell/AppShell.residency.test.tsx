import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRouter } from '@/app/router/AppRouter'
import { AppShell, resetNavSectionHistoryForTest } from '@/app/shell/AppShell'

const getRuntimeInfoApi = vi.fn()

vi.mock('@/modules/settings/domain/runtime-entity/api', () => ({
  getRuntimeInfoApi: () => getRuntimeInfoApi(),
}))

vi.mock('@/app/router/appRoutes', async () => {
  const ReactModule = await import('react')
  const residency = await vi.importActual<typeof import('@/shared/routing/RouteResidency')>(
    '@/shared/routing/RouteResidency',
  )

  return {
    preloadPracticeRoutes: vi.fn(),
    preloadReviewRoutes: vi.fn(),
    preloadEnglishWorkspacePage: vi.fn(),
    preloadEnglishReadingPage: vi.fn(),
    preloadFreestylePage: vi.fn(),
    preloadFreestyleSessionPage: vi.fn(),
    preloadKnowledgePage: vi.fn(),
    preloadPalaceEditPage: vi.fn(),
    preloadProfilePage: vi.fn(),
    AppRoutes({
      location,
    }: {
      location?: { pathname: string; search?: string }
    }) {
      const { isActive, pathname } = residency.useRouteResidency()
      const [value, setValue] = ReactModule.useState('')
      const id = location?.pathname ?? pathname

      return (
        <section data-testid={`page:${id}`} data-active={String(isActive)}>
          <div>{`${pathname}${location?.search ?? ''}`}</div>
          <input
            aria-label={`input:${id}`}
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
          />
        </section>
      )
    },
  }
})

describe('AppShell residency navigation memory', () => {
  beforeEach(() => {
    getRuntimeInfoApi.mockReset()
    getRuntimeInfoApi.mockResolvedValue(null)
    resetNavSectionHistoryForTest()
  })

  afterEach(() => {
    resetNavSectionHistoryForTest()
    vi.restoreAllMocks()
  })

  it('keeps the create nav fixed on /palaces/new instead of reopening the last edited palace', async () => {
    render(
      <MemoryRouter initialEntries={['/palaces/30/edit?miniPalaceId=5&miniPalaceMode=edit']}>
        <AppShell>
          <AppRouter />
        </AppShell>
      </MemoryRouter>,
    )

    fireEvent.change(await screen.findByLabelText('input:/palaces/30/edit'), {
      target: { value: 'persisted palace state' },
    })

    fireEvent.click(screen.getAllByRole('link', { name: '随心' })[0]!)
    await waitFor(() => {
      expect(screen.getByTestId('page:/palaces/30/edit').getAttribute('data-active')).toBe('false')
      expect(screen.getByTestId('page:/freestyle').getAttribute('data-active')).toBe('true')
    })

    fireEvent.change(screen.getByLabelText('input:/freestyle'), {
      target: { value: 'persisted english state' },
    })

    fireEvent.click(screen.getAllByRole('link', { name: '创建' })[0]!)
    await waitFor(() => {
      expect(screen.getByTestId('page:/palaces/new').getAttribute('data-active')).toBe('true')
    })

    expect((screen.getByLabelText('input:/freestyle') as HTMLInputElement).value).toBe(
      'persisted english state',
    )
    expect(screen.getAllByRole('link', { name: '创建' })[0]?.getAttribute('href')).toBe('/palaces/new')
    expect(screen.getAllByRole('link', { name: '创建' })[1]?.getAttribute('href')).toBe('/palaces/new')
  })
})
