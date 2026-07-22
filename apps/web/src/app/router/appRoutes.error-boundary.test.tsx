import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { AppRoutes } from './appRoutes'

vi.mock('@/pages/insights/InsightsPage', () => ({
  default: (): never => {
    throw new Error('dashboard boom')
  },
}))
vi.mock('@/modules/content/ui/palace-catalog/PalaceListPage', () => ({ default: () => <div /> }))
vi.mock('@/modules/content/ui/palace-catalog/PalaceShelfPage', () => ({ default: () => <div /> }))
vi.mock('@/app/router/PalacePracticePage', () => ({ default: () => <div /> }))
vi.mock('@/app/router/PalaceFocusPracticePage', () => ({ default: () => <div /> }))
vi.mock('@/app/router/SegmentPracticePage', () => ({ default: () => <div /> }))
vi.mock('@/app/router/MiniPalacePracticePage', () => ({ default: () => <div /> }))
vi.mock('@/app/router/review/ReviewOverview', () => ({ default: () => <div /> }))

function AppRoutesHarness() {
  const location = useLocation()
  return (
    <div>
      <aside>shell chrome</aside>
      <AppRoutes location={location} />
    </div>
  )
}

describe('AppRoutes route error boundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('contains route render failures inside the route content area', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AppRoutesHarness />
      </MemoryRouter>,
    )

    expect(screen.getByText('shell chrome')).toBeTruthy()
    expect(screen.getByText('这个页面出了点问题')).toBeTruthy()
    expect(screen.getByText(/dashboard boom/)).toBeTruthy()
  })
})
