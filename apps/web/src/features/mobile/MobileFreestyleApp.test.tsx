import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import MobileFreestyleApp from '@/features/mobile/MobileFreestyleApp'

vi.mock('@/features/freestyle/FreestylePage', () => ({
  default: () => <div>mobile freestyle page</div>,
}))

describe('MobileFreestyleApp', () => {
  it('renders the freestyle-only mobile entry at /m', () => {
    render(
      <MemoryRouter initialEntries={['/m']}>
        <MobileFreestyleApp />
      </MemoryRouter>,
    )

    expect(screen.getByText('mobile freestyle page')).toBeTruthy()
  })

  it('redirects unsupported mobile paths back to /m', async () => {
    render(
      <MemoryRouter initialEntries={['/palaces/new']}>
        <MobileFreestyleApp />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('mobile freestyle page')).toBeTruthy())
  })
})
