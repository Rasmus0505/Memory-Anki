import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppRouter } from '@/app/router/AppRouter'

vi.mock('@/app/router/appRoutes', async () => {
  const ReactModule = await import('react')
  const residency = await vi.importActual<typeof import('@/app/router/RouteResidency')>(
    '@/app/router/RouteResidency',
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
})
