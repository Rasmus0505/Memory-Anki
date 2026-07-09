import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRouter } from '@/app/router/AppRouter'

const residencySubscriptionState = vi.hoisted(() => ({
  active: new Set<string>(),
  starts: [] as string[],
  stops: [] as string[],
}))

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
      ReactModule.useEffect(() => {
        if (!isActive) return undefined
        residencySubscriptionState.active.add(pathname)
        residencySubscriptionState.starts.push(pathname)
        return () => {
          residencySubscriptionState.active.delete(pathname)
          residencySubscriptionState.stops.push(pathname)
        }
      }, [isActive, pathname])
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
  beforeEach(() => {
    residencySubscriptionState.active.clear()
    residencySubscriptionState.starts.length = 0
    residencySubscriptionState.stops.length = 0
  })

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

  it('marks inactive residents inert and pauses active-route subscriptions without changing isActive semantics', () => {
    render(
      <MemoryRouter initialEntries={['/alpha']}>
        <RouterHarness />
      </MemoryRouter>,
    )

    expect([...residencySubscriptionState.active]).toEqual(['/alpha'])
    expect(screen.getByTestId('page:/alpha').getAttribute('data-active')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'beta' }))

    const alphaContainer = screen.getByTestId('page:/alpha').parentElement
    const betaContainer = screen.getByTestId('page:/beta').parentElement

    expect(screen.getByTestId('page:/alpha').getAttribute('data-active')).toBe('false')
    expect(screen.getByTestId('page:/beta').getAttribute('data-active')).toBe('true')
    expect(alphaContainer?.getAttribute('aria-hidden')).toBe('true')
    expect(alphaContainer?.hasAttribute('inert')).toBe(true)
    expect(betaContainer?.getAttribute('aria-hidden')).toBe('false')
    expect(betaContainer?.hasAttribute('inert')).toBe(false)
    expect([...residencySubscriptionState.active]).toEqual(['/beta'])
    expect(residencySubscriptionState.stops).toContain('/alpha')
    expect(residencySubscriptionState.starts).toContain('/beta')
  })
})
