import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppRouter } from '@/app/router/AppRouter'

vi.mock('@/app/router/appRoutes', async () => {
  const ReactModule = await import('react')
  const residency = await vi.importActual<typeof import('@/shared/routing/RouteResidency')>(
    '@/shared/routing/RouteResidency',
  )

  return {
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

function RouterHarness() {
  const navigate = useNavigate()

  return (
    <>
      <button type="button" onClick={() => navigate('/alpha')}>
        alpha
      </button>
      <button type="button" onClick={() => navigate('/beta')}>
        beta
      </button>
      <button type="button" onClick={() => navigate('/alpha?tab=2')}>
        alpha-query
      </button>
      <button type="button" onClick={() => navigate('/gamma')}>
        gamma
      </button>
      <button type="button" onClick={() => navigate('/delta')}>
        delta
      </button>
      <button type="button" onClick={() => navigate('/epsilon')}>
        epsilon
      </button>
      <AppRouter />
    </>
  )
}

describe('AppRouter residency', () => {
  it('keeps prior route instances alive across navigation and reuses the same pathname cache entry', () => {
    render(
      <MemoryRouter initialEntries={['/alpha']}>
        <RouterHarness />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('input:/alpha'), {
      target: { value: 'persisted alpha' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'beta' }))
    fireEvent.change(screen.getByLabelText('input:/beta'), {
      target: { value: 'persisted beta' },
    })

    expect(screen.getByTestId('page:/alpha').getAttribute('data-active')).toBe('false')
    expect(screen.getByDisplayValue('persisted alpha')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'alpha-query' }))

    expect(screen.getByTestId('page:/alpha').getAttribute('data-active')).toBe('true')
    expect((screen.getByLabelText('input:/alpha') as HTMLInputElement).value).toBe('persisted alpha')
    expect(screen.getByDisplayValue('persisted beta')).toBeTruthy()
    expect(screen.getAllByTestId(/page:\//)).toHaveLength(2)
  })

  it('evicts the least recently active resident route when the cache reaches its limit', () => {
    render(
      <MemoryRouter initialEntries={['/alpha']}>
        <RouterHarness />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('input:/alpha'), {
      target: { value: 'old alpha state' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'beta' }))
    fireEvent.click(screen.getByRole('button', { name: 'gamma' }))
    fireEvent.click(screen.getByRole('button', { name: 'delta' }))
    fireEvent.click(screen.getByRole('button', { name: 'epsilon' }))

    expect(screen.queryByTestId('page:/alpha')).toBeNull()
    expect(screen.getByTestId('page:/epsilon').getAttribute('data-active')).toBe('true')
    expect(screen.getAllByTestId(/page:\//)).toHaveLength(4)
  })
})
