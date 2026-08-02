import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import {
  InsightsSectionNav,
  resolveInsightsSectionTab,
} from '@/pages/insights/InsightsSectionNav'

describe('InsightsSectionNav', () => {
  it('resolves the dashboard and today workspace tabs', () => {
    expect(resolveInsightsSectionTab('/dashboard')).toBe('dashboard')
    expect(resolveInsightsSectionTab('/')).toBe('dashboard')
    expect(resolveInsightsSectionTab('/freestyle')).toBe('dashboard')
    expect(resolveInsightsSectionTab('/today')).toBe('today')
  })

  it('renders switcher links with current page marked', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <InsightsSectionNav />
      </MemoryRouter>,
    )

    const nav = screen.getByRole('navigation', { name: '洞察子导航' })
    expect(nav).toBeTruthy()

    const dashboard = screen.getByRole('link', { name: '仪表盘' })
    expect(dashboard.getAttribute('href')).toBe('/dashboard')
    expect(dashboard.getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: '今日工作台' }).getAttribute('href')).toBe('/today')
  })
})
