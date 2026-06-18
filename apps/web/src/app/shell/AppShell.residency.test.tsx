import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRouter } from '@/app/router/AppRouter'
import { AppShell, resetNavSectionHistoryForTest } from '@/app/shell/AppShell'

const getRuntimeInfoApi = vi.fn()

vi.mock('@/entities/runtime/api/runtimeApi', () => ({
  getRuntimeInfoApi: () => getRuntimeInfoApi(),
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

  it('returns to the last palace child route and keeps the cached page instance alive', async () => {
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

    fireEvent.click(screen.getAllByRole('link', { name: '英语听力' })[0]!)
    await waitFor(() => {
      expect(screen.getByTestId('page:/palaces/30/edit').getAttribute('data-active')).toBe('false')
      expect(screen.getByTestId('page:/english').getAttribute('data-active')).toBe('true')
    })

    fireEvent.change(screen.getByLabelText('input:/english'), {
      target: { value: 'persisted english state' },
    })

    fireEvent.click(screen.getAllByRole('link', { name: '记忆宫殿' })[0]!)
    await waitFor(() => {
      expect(screen.getByText('/palaces/30/edit?miniPalaceId=5&miniPalaceMode=edit')).toBeTruthy()
      expect(screen.getByTestId('page:/palaces/30/edit').getAttribute('data-active')).toBe('true')
    })

    expect((screen.getByLabelText('input:/palaces/30/edit') as HTMLInputElement).value).toBe(
      'persisted palace state',
    )
    expect((screen.getByLabelText('input:/english') as HTMLInputElement).value).toBe(
      'persisted english state',
    )
  })
})
