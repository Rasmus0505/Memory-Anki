import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { InsightsPageLoading } from '@/pages/insights/InsightsPageLoading'

describe('InsightsPageLoading', () => {
  it('keeps the insights hub chrome visible while the dashboard chunk loads', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <InsightsPageLoading />
      </MemoryRouter>,
    )

    expect(screen.getByRole('navigation', { name: '洞察子导航' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '仪表盘' })).toBeTruthy()
    expect(screen.getByText('正在加载学习概览...')).toBeTruthy()
  })
})
