import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import {
  InsightsSectionNav,
  resolveInsightsSectionTab,
} from '@/pages/insights/InsightsSectionNav'

describe('InsightsSectionNav', () => {
  it('resolves dashboard vs review hubs', () => {
    expect(resolveInsightsSectionTab('/dashboard')).toBe('dashboard')
    expect(resolveInsightsSectionTab('/')).toBe('dashboard')
    expect(resolveInsightsSectionTab('/review')).toBe('review')
    expect(resolveInsightsSectionTab('/review/session/3')).toBe('review')
  })

  it('renders switcher links with current page marked', () => {
    render(
      <MemoryRouter initialEntries={['/review']}>
        <InsightsSectionNav />
      </MemoryRouter>,
    )

    const nav = screen.getByRole('navigation', { name: '洞察子导航' })
    expect(nav).toBeTruthy()

    const dashboard = screen.getByRole('link', { name: '仪表盘' })
    const review = screen.getByRole('link', { name: '今日复习' })
    expect(dashboard.getAttribute('href')).toBe('/dashboard')
    expect(review.getAttribute('href')).toBe('/review')
    expect(review.getAttribute('aria-current')).toBe('page')
    expect(dashboard.getAttribute('aria-current')).toBeNull()
  })
})
